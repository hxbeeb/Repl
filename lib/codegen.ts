import type { GeneratedApp } from "@/lib/types";

export const CODEGEN_SYSTEM_PROMPT = `You are an expert full-stack developer. Generate a complete working app based on the user's request.

Rules:
- Always generate a FastAPI backend (main.py) on port 8000
- Always generate a React frontend (index.html single file with CDN React) on port 3000
- Backend start commands must bind to 0.0.0.0, for example: uvicorn main:app --host 0.0.0.0 --port 8000
- Frontend start commands must bind to 0.0.0.0 on port 3000, for example: python3 -m http.server 3000 --bind 0.0.0.0
- Frontend must call backend using a JavaScript constant declared exactly like: const BACKEND_URL = "BACKEND_URL";
- If the app uses WebSockets, declare exactly: const WS_BACKEND_URL = "WS_BACKEND_URL";
- Use fetch(\`\${BACKEND_URL}/path\`) and new WebSocket(\`\${WS_BACKEND_URL}/path\`) for backend calls
- Never hardcode localhost, 127.0.0.1, ws://localhost, or http://localhost in frontend code
- Use React 18 createRoot from ReactDOM.createRoot; do not use ReactDOM.render
- The generated index.html must include polished, responsive CSS in a <style> tag
- Do not return bare unstyled HTML; include layout, spacing, typography, buttons, forms, loading, empty, and error states where relevant
- Return ONLY a JSON object with this exact structure, no markdown, no explanation:
{
  files: {
    filename: content (string)
  },
  install_commands: [array of shell commands to install deps],
  start_commands: [array of shell commands to start servers]
}
Example files: main.py, index.html, requirements.txt`;

function stripCodeFence(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function parseGeneratedApp(text: string): GeneratedApp {
  let parsed: unknown;

  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("The model did not return a JSON object.");
    }
    parsed = JSON.parse(match[0]);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Generated app response was not an object.");
  }

  const candidate = parsed as Partial<GeneratedApp>;
  if (!candidate.files || typeof candidate.files !== "object") {
    throw new Error("Generated app response is missing files.");
  }

  const files = Object.fromEntries(
    Object.entries(candidate.files).map(([name, content]) => {
      if (typeof content !== "string") {
        throw new Error(`Generated file ${name} did not contain string content.`);
      }
      return [name, content];
    })
  );

  if (!Array.isArray(candidate.install_commands)) {
    throw new Error("Generated app response is missing install_commands.");
  }

  if (!Array.isArray(candidate.start_commands)) {
    throw new Error("Generated app response is missing start_commands.");
  }

  return {
    files,
    install_commands: candidate.install_commands.map(String),
    start_commands: candidate.start_commands.map(String)
  };
}
