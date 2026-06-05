import { Sandbox } from "e2b";
import { NextResponse } from "next/server";
import type { GeneratedApp } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

const TEN_MINUTES_MS = 10 * 60 * 1000;
const WORKDIR = "/home/user/app";

const FORCED_VITE_CONFIG = `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 3000, allowedHosts: true, hmr: { clientPort: 443 } },
});
`;

function isGeneratedApp(value: unknown): value is GeneratedApp {
  if (!value || typeof value !== "object") return false;
  const c = value as Partial<GeneratedApp>;
  return (
    !!c.files && typeof c.files === "object" &&
    Array.isArray(c.install_commands) &&
    Array.isArray(c.start_commands)
  );
}

function normalizePublicUrl(host: string) {
  return host.startsWith("http") ? host : `https://${host}`;
}

function toWebsocketUrl(url: string) {
  return url.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
}

function patchContent(content: string, backendUrl: string) {
  const wsUrl = toWebsocketUrl(backendUrl);
  const httpPatterns = [
    "BACKEND_URL", "http://BACKEND_URL", "https://BACKEND_URL",
    "http://localhost:8000", "https://localhost:8000", "localhost:8000",
    "http://127.0.0.1:8000", "https://127.0.0.1:8000", "127.0.0.1:8000",
  ];
  const wsPatterns = [
    "WS_BACKEND_URL", "ws://WS_BACKEND_URL", "wss://WS_BACKEND_URL",
    "ws://BACKEND_URL", "wss://BACKEND_URL",
    "ws://localhost:8000", "wss://localhost:8000",
    "ws://127.0.0.1:8000", "wss://127.0.0.1:8000",
  ];
  let out = content;
  for (const p of httpPatterns)
    for (const q of ['"', "'", "`"])
      out = out.split(`${q}${p}${q}`).join(`${q}${backendUrl}${q}`);
  for (const p of wsPatterns)
    for (const q of ['"', "'", "`"])
      out = out.split(`${q}${p}${q}`).join(`${q}${wsUrl}${q}`);
  out = out
    .replace(/https?:\/\/localhost:8000/g, backendUrl)
    .replace(/https?:\/\/127\.0\.0\.1:8000/g, backendUrl)
    .replace(/wss?:\/\/localhost:8000/g, wsUrl)
    .replace(/wss?:\/\/127\.0\.0\.1:8000/g, wsUrl);
  return out;
}

function normalizeStartCmd(cmd: string) {
  let out = cmd
    .replaceAll("127.0.0.1", "0.0.0.0")
    .replaceAll("localhost", "0.0.0.0")
    .replace(/uvicorn\s+(\S+)(?![^&\n]*--host)/g, "uvicorn $1 --host 0.0.0.0")
    .replace(/python3?\s+-m\s+http\.server\s+(\d+)(?![^&\n]*--bind)/g,
      "python3 -m http.server $1 --bind 0.0.0.0")
    .replace(/\s*&\s*$/, "")
    .trim();

  return out;
}

async function run(sandbox: Sandbox, cmd: string, opts: { cwd?: string; timeoutMs?: number } = {}): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await sandbox.commands
    .run(cmd, { cwd: opts.cwd ?? WORKDIR, timeoutMs: opts.timeoutMs ?? 0 })
    .catch((e: unknown) => ({ exitCode: 1, stdout: "", stderr: String(e) }));
  return result as { exitCode: number; stdout: string; stderr: string };
}

async function isPortOpen(sandbox: Sandbox, port: number): Promise<boolean> {
  const r = await run(sandbox,
    `python3 -c "import socket,sys; s=socket.socket(); s.settimeout(0.5); s.connect(('127.0.0.1',${port})); s.close()"`
  );
  return r.exitCode === 0;
}

async function waitForPort(sandbox: Sandbox, port: number, timeoutMs = 60_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortOpen(sandbox, port)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;
    if (!isGeneratedApp(body))
      return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
    if (!process.env.E2B_API_KEY)
      return NextResponse.json({ error: "Missing E2B_API_KEY." }, { status: 500 });

    const sandbox = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
      timeoutMs: TEN_MINUTES_MS,
    });

    const backendUrl = normalizePublicUrl(sandbox.getHost(8000));
    const frontendUrl = normalizePublicUrl(sandbox.getHost(3000));

    await sandbox.files.makeDir(WORKDIR);

    // Write all files
    let hasViteConfig = false;
    for (const [filename, content] of Object.entries(body.files)) {
      const safeName = filename.replace(/^\/+/, "");
      let patched = patchContent(String(typeof content === "object" ? JSON.stringify(content, null, 2) : content), backendUrl);
      if (safeName === "vite.config.js" || safeName === "vite.config.ts") {
        patched = FORCED_VITE_CONFIG;
        hasViteConfig = true;
      }
      // Ensure nested dirs exist
      const dir = safeName.includes("/") ? safeName.split("/").slice(0, -1).join("/") : "";
      if (dir) await sandbox.files.makeDir(`${WORKDIR}/${dir}`);
      await sandbox.files.write(`${WORKDIR}/${safeName}`, patched);
    }
    if (!hasViteConfig && (body.files["src/main.jsx"] || body.files["src/main.tsx"])) {
      await sandbox.files.write(`${WORKDIR}/vite.config.js`, FORCED_VITE_CONFIG);
    }

    // Install
    for (const cmd of body.install_commands) {
      const fastCmd = cmd.replace(/\bpip3?\s+install\b/g, "pip install --cache-dir /tmp/pip-cache -q");
      console.log("[run] install:", fastCmd);
      const result = await run(sandbox, fastCmd);
      if (result.exitCode !== 0) {
        const detail = (result.stderr || result.stdout).slice(-1500);
        await sandbox.kill().catch(() => {});
        return NextResponse.json(
          {
            error: `Install failed: ${cmd}`,
            logs: `--- INSTALL ERROR ---\n${detail}`,
            fixable: true,
          },
          { status: 422 }
        );
      }
    }

    // Start all processes — capture logs to files so we can read errors on failure
    const cmds = body.start_commands.map((cmd: string) => normalizeStartCmd(cmd));
    const hasFrontendCmd = cmds.some((c: string) => /vite|http\.server|3000/.test(c));
    if (!hasFrontendCmd && body.files["index.html"] && !body.files["src/main.jsx"]) {
      cmds.push("python3 -m http.server 3000 --bind 0.0.0.0");
    }

    console.log("[run] starting commands:", cmds);

    for (const cmd of cmds) {
      const isFrontend = /\bvite\b/.test(cmd);
      const finalCmd = isFrontend
        ? `npx vite --config ${WORKDIR}/vite.config.js --host 0.0.0.0 --port 3000`
        : cmd;
      const logFile = isFrontend ? `${WORKDIR}/.frontend.log` : `${WORKDIR}/.backend.log`;
      // Wrap in a login shell so stdout/stderr are captured to a log file
      console.log("[run] starting:", finalCmd);
      await sandbox.commands.run(
        `bash -lc "cd ${WORKDIR} && ${finalCmd} > ${logFile} 2>&1"`,
        { cwd: WORKDIR, background: true, timeoutMs: 0 }
      );
    }

    // Give processes a moment to boot / fail
    await new Promise((r) => setTimeout(r, 3000));

    const frontendReady = await waitForPort(sandbox, 3000, 60_000);

    if (!frontendReady) {
      // Gather diagnostics to feed the auto-fixer
      const feLog = (await run(sandbox, `tail -n 60 ${WORKDIR}/.frontend.log 2>/dev/null || true`)).stdout;
      const beLog = (await run(sandbox, `tail -n 60 ${WORKDIR}/.backend.log 2>/dev/null || true`)).stdout;
      const logs = [
        feLog.trim() && `--- FRONTEND LOG ---\n${feLog.trim()}`,
        beLog.trim() && `--- BACKEND LOG ---\n${beLog.trim()}`,
      ].filter(Boolean).join("\n\n");

      await sandbox.kill().catch(() => {});

      return NextResponse.json(
        {
          error: "Frontend did not start on port 3000.",
          logs: logs || "(no logs captured)",
          fixable: true,
        },
        { status: 422 }
      );
    }

    const backendReady = await waitForPort(sandbox, 8000, 10_000);

    return NextResponse.json({
      frontend_url: frontendUrl,
      backend_url: backendUrl,
      sandbox_id: sandbox.sandboxId,
      backend_ready: backendReady,
    });
  } catch (error) {
    console.error("Run API failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to run sandbox." },
      { status: 500 }
    );
  }
}
