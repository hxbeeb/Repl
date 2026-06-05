import { GoogleGenAI } from "@google/genai";
import { NextResponse } from "next/server";
import type { GeneratedApp } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const EDIT_SYSTEM_PROMPT = `You are an expert full-stack developer editing an existing React + Vite + Express app.

You will receive the current files and an instruction. Apply the change and return ONLY the files you actually create, modify, or need to delete — NOT the whole codebase.

RULES:
- Keep the same stack: React + Vite (port 3000), Express (port 8000), react-router-dom for routing.
- Frontend talks to backend via the BACKEND_URL constant; never hardcode localhost.
- If you ADD a npm package, you MUST also return the updated package.json with it in "dependencies".
- If you ADD a new page/component, return that new file AND any file that imports it (e.g. App.jsx routes, Navbar.jsx links).
- Return files in full (complete content), not diffs or partial snippets.
- To delete a file, include its name in the "deleted" array.

OUTPUT FORMAT — return ONLY valid JSON, no markdown fences, no commentary:
{
  "changed_files": { "path/to/file.jsx": "full new content", ... },
  "deleted": ["path/to/removed.jsx"],
  "install_commands": ["npm install"],
  "start_commands": ["node server.js", "npx vite --host 0.0.0.0 --port 3000"]
}

Keep changed_files MINIMAL — only what the instruction actually touches. Ensure the JSON is complete and valid: close every string and bracket, never stop mid-file.`;

function stripFence(t: string) {
  return t.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

type EditResult = {
  changed_files: Record<string, string>;
  deleted?: string[];
  install_commands?: string[];
  start_commands?: string[];
};

function parseEdit(text: string): EditResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFence(text));
  } catch {
    const m = stripFence(text).match(/\{[\s\S]*\}/);
    if (!m) throw new Error("The model did not return a valid JSON object. The response may have been truncated.");
    parsed = JSON.parse(m[0]);
  }
  const c = parsed as Partial<EditResult>;
  if (!c.changed_files || typeof c.changed_files !== "object") {
    throw new Error("Edit response missing changed_files.");
  }
  const changed: Record<string, string> = {};
  for (const [name, content] of Object.entries(c.changed_files)) {
    changed[name] = typeof content === "string" ? content : JSON.stringify(content, null, 2);
  }
  return {
    changed_files: changed,
    deleted: Array.isArray(c.deleted) ? c.deleted.map(String) : [],
    install_commands: Array.isArray(c.install_commands) ? c.install_commands.map(String) : undefined,
    start_commands: Array.isArray(c.start_commands) ? c.start_commands.map(String) : undefined,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      instruction?: string;
      current?: GeneratedApp;
      model?: string;
    };
    const { instruction, current, model } = body;

    if (!instruction?.trim())
      return NextResponse.json({ error: "instruction is required" }, { status: 400 });
    if (!current?.files)
      return NextResponse.json({ error: "current app files are required" }, { status: 400 });
    if (!process.env.GEMINI_API_KEY)
      return NextResponse.json({ error: "Missing GEMINI_API_KEY" }, { status: 500 });

    const filesBlock = Object.entries(current.files)
      .map(([name, content]) => `### ${name}\n\`\`\`\n${content}\n\`\`\``)
      .join("\n\n");

    const prompt = `Current files:\n\n${filesBlock}\n\nInstruction: ${instruction.trim()}\n\nReturn ONLY the changed/new files (and any file that must change to support them).`;

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const allowedModels = ["gemini-2.5-flash", "gemini-2.5-pro"];
    const selectedModel = allowedModels.includes(model ?? "") ? model! : "gemini-2.5-flash";

    const response = await ai.models.generateContent({
      model: selectedModel,
      contents: prompt,
      config: {
        systemInstruction: EDIT_SYSTEM_PROMPT,
        temperature: 0.3,
        maxOutputTokens: selectedModel === "gemini-2.5-pro" ? 65536 : 65000,
        ...(selectedModel === "gemini-2.5-pro"
          ? { thinkingConfig: { thinkingBudget: 6000 } }
          : {}),
      },
    });

    const text = response.text?.trim();
    if (!text) throw new Error("Gemini did not return any text.");

    const edit = parseEdit(text);

    // Merge changed files into the existing set
    const mergedFiles: Record<string, string> = { ...current.files, ...edit.changed_files };
    for (const del of edit.deleted ?? []) {
      delete mergedFiles[del];
    }

    const result: GeneratedApp = {
      files: mergedFiles,
      install_commands: edit.install_commands ?? current.install_commands,
      start_commands: edit.start_commands ?? current.start_commands,
    };

    return NextResponse.json(result);
  } catch (error) {
    console.error("Improve API failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to improve code." },
      { status: 500 }
    );
  }
}
