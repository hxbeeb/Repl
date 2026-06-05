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

const FE_LOG = `${WORKDIR}/.frontend.log`;
const BE_LOG = `${WORKDIR}/.backend.log`;

// Error signatures that indicate the app is broken even though the port is open.
const FE_ERROR_SIGNATURES = [
  "Failed to resolve import",
  "Internal server error",
  "[vite] Internal server error",
  "Pre-transform error",
  "Could not resolve",
  "is not exported by",
  "Unexpected token",
  "Unexpected reserved word",
  "Transform failed",
  "esbuild",
  "SyntaxError",
  "Cannot find module",
  "does not provide an export named",
];

// Node crash signatures — kept specific so legitimate "Error:" log lines don't trigger false positives.
const BE_ERROR_SIGNATURES = [
  "ReferenceError:",
  "TypeError:",
  "SyntaxError:",
  "RangeError:",
  "Cannot find module",
  "ERR_MODULE_NOT_FOUND",
  "ERR_REQUIRE_ESM",
  "EADDRINUSE",
  "UnhandledPromiseRejection",
  "node:internal",
];

async function readLog(sandbox: Sandbox, path: string): Promise<string> {
  return (await run(sandbox, `tail -n 80 ${path} 2>/dev/null || true`)).stdout;
}

function findErrors(log: string, signatures: string[]): string | null {
  if (!log.trim()) return null;
  const lines = log.split("\n");
  const hits = lines.filter((l) => signatures.some((s) => l.includes(s)));
  return hits.length ? hits.slice(-20).join("\n") : null;
}

// Is a node process running server.js still alive?
async function isBackendAlive(sandbox: Sandbox): Promise<boolean> {
  const r = await run(sandbox, `pgrep -f "node .*server.js" > /dev/null && echo alive || echo dead`);
  return r.stdout.includes("alive");
}

// Fetch a module the dev server must transform (the React entry) and detect a Vite compile error.
// Vite returns HTTP 500 with the error embedded when transformation fails — so we hit a .jsx URL,
// not "/", because "/" is just static index.html and always 200s even when the app is broken.
async function frontendHtmlError(sandbox: Sandbox): Promise<string | null> {
  // Python is guaranteed available in the sandbox; curl may not be.
  const probe = `python3 - <<'PY'
import urllib.request
for path in ["/src/main.jsx", "/src/App.jsx", "/"]:
    try:
        req = urllib.request.Request("http://127.0.0.1:3000" + path)
        with urllib.request.urlopen(req, timeout=6) as r:
            body = r.read().decode("utf-8", "replace")
            print("STATUS 200")
            print(body[:1800])
            break
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        print("STATUS", e.code)
        print(body[:1800])
        break
    except Exception:
        continue
PY`;
  const r = await run(sandbox, probe);
  const out = r.stdout;
  if (!out.trim()) return null;

  const is500 = /^STATUS 5\d\d/m.test(out);
  const hasOverlay = /vite-error-overlay|Internal server error|Failed to resolve import|Pre-transform error|does not provide an export/i.test(out);

  if (is500 || hasOverlay) {
    return out.slice(0, 1800);
  }
  return null;
}

// After the port is open, give the dev server time to compile, then scan for real errors.
async function detectRuntimeErrors(sandbox: Sandbox, hasBackend: boolean): Promise<string | null> {
  // Vite opens the port before compiling; poll for a few seconds to let errors surface.
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 2000));

    const feLog = await readLog(sandbox, FE_LOG);
    const beLog = await readLog(sandbox, BE_LOG);

    const feErr = findErrors(feLog, FE_ERROR_SIGNATURES);
    const beErr = findErrors(beLog, BE_ERROR_SIGNATURES);
    const htmlErr = await frontendHtmlError(sandbox);

    // Only flag backend death if the app actually has a backend (server.js).
    const beDead = hasBackend && !(await isBackendAlive(sandbox));

    if (feErr || beErr || htmlErr || beDead) {
      const parts: string[] = [];
      if (feErr || htmlErr) {
        parts.push(`--- FRONTEND ERROR ---\n${[feErr, htmlErr].filter(Boolean).join("\n")}`);
      }
      if (beErr || beDead) {
        parts.push(
          `--- BACKEND ERROR ---\n${beDead ? "Backend process crashed and is no longer running.\n" : ""}${beErr ?? beLog.slice(-800)}`
        );
      }
      return parts.join("\n\n");
    }
  }
  return null;
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
      const logFile = isFrontend ? FE_LOG : BE_LOG;
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
      const feLog = await readLog(sandbox, FE_LOG);
      const beLog = await readLog(sandbox, BE_LOG);
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

    // Port is open — now check whether the app actually compiled / runs without errors.
    const hasBackend = !!body.files["server.js"];
    const runtimeError = await detectRuntimeErrors(sandbox, hasBackend);
    if (runtimeError) {
      console.log("[run] runtime error detected:\n", runtimeError);
      await sandbox.kill().catch(() => {});
      return NextResponse.json(
        {
          error: "App started but has errors.",
          logs: runtimeError,
          fixable: true,
        },
        { status: 422 }
      );
    }

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
