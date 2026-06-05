import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import type { GeneratedApp } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const FIX_SYSTEM_PROMPT = `You are an expert debugger fixing a React + Vite + Express app that FAILED to start.

You will receive the current files, the error, and sandbox logs. Find the root cause and fix it.
Return ONLY the files you need to change — NOT the whole codebase.

Common causes:
- Missing dependency in package.json → add it to "dependencies" and return package.json
- Import of a file/export that doesn't exist, or wrong path/extension
- Syntax error in a .jsx/.js file
- Wrong React or react-router-dom API usage
- server.js crashes at startup (bad import, throw, port conflict)

RULES:
- Keep the stack: React + Vite (port 3000), Express (port 8000).
- Return each changed file IN FULL (complete content), not diffs.
- If you add a package, return the updated package.json.

OUTPUT FORMAT — return ONLY valid JSON, no markdown fences, no commentary:
{
  "changed_files": { "path/to/file": "full corrected content", ... },
  "install_commands": ["npm install"],
  "start_commands": ["node server.js", "npx vite --host 0.0.0.0 --port 3000"]
}

Keep changed_files MINIMAL — only the files needed to fix the error. Ensure the JSON is complete and valid: close every string and bracket, never stop mid-file.`;

function stripFence(t: string) {
  return t.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

type FixResult = {
  changed_files: Record<string, string>;
  install_commands?: string[];
  start_commands?: string[];
};

function parseFix(text: string): FixResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(text));
  } catch {
    const m = stripFence(text).match(/\{[\s\S]*\}/);
    if (!m) throw new Error("The model did not return a valid JSON object. The response may have been truncated.");
    parsed = JSON.parse(m[0]);
  }
  const c = parsed as Partial<FixResult>;
  if (!c.changed_files || typeof c.changed_files !== "object") {
    throw new Error("Fix response missing changed_files.");
  }
  const changed: Record<string, string> = {};
  for (const [name, content] of Object.entries(c.changed_files)) {
    changed[name] = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  }
  return {
    changed_files: changed,
    install_commands: Array.isArray(c.install_commands) ? c.install_commands.map(String) : undefined,
    start_commands: Array.isArray(c.start_commands) ? c.start_commands.map(String) : undefined,
  };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      current?: GeneratedApp;
      error?: string;
      logs?: string;
      model?: string;
    };
    const { current, error, logs, model } = body;

    if (!current?.files)
      return NextResponse.json({ error: "current app files are required" }, { status: 400 });
    if (!process.env.GEMINI_API_KEY)
      return NextResponse.json({ error: "Missing GEMINI_API_KEY" }, { status: 500 });

    const filesBlock = Object.entries(current.files)
      .map(([name, content]) => `### ${name}\n\`\`\`\n${content}\n\`\`\``)
      .join("\n\n");

    const prompt = `Current files:\n\n${filesBlock}\n\n═══ ERROR ═══\n${error ?? "Unknown error"}\n\n═══ SANDBOX LOGS ═══\n${(logs ?? "(no logs)").slice(-4000)}\n\nDiagnose the root cause and return ONLY the changed files to fix it.`;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const allowedModels = ["gemini-2.5-flash", "gemini-2.5-pro"];
    const selectedModel = allowedModels.includes(model ?? "") ? model! : "gemini-2.5-flash";

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction: FIX_SYSTEM_PROMPT,
        temperature: 0.2,
        maxOutputTokens: selectedModel === "gemini-2.5-pro" ? 65536 : 65000,
        ...(selectedModel === "gemini-2.5-pro"
          ? { thinkingConfig: { thinkingBudget: 6000 } }
          : {}),
      },
    });

    const text = response.text?.trim();
    if (!text) throw new Error("Gemini did not return any text.");

    const fix = parseFix(text);

    const mergedFiles: Record<string, string> = { ...current.files, ...fix.changed_files };

    const result: GeneratedApp = {
      files: mergedFiles,
      install_commands: fix.install_commands ?? current.install_commands,
      start_commands: fix.start_commands ?? current.start_commands,
    };

    return NextResponse.json(result);
  } catch (err) {
    console.error("Fix API failed", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fix code." },
      { status: 500 }
    );
  }
}
