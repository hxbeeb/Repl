import { Sandbox } from "e2b";
import { NextResponse } from "next/server";
import type { GeneratedApp } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

const TEN_MINUTES_MS = 10 * 60 * 1000;
const WORKDIR = "/home/user/app";
const FRONTEND_FALLBACK_COMMAND =
  "python3 -m http.server 3000 --bind 0.0.0.0";

function isGeneratedApp(value: unknown): value is GeneratedApp {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<GeneratedApp>;
  return (
    !!candidate.files &&
    typeof candidate.files === "object" &&
    Array.isArray(candidate.install_commands) &&
    Array.isArray(candidate.start_commands)
  );
}

function normalizePublicUrl(host: string) {
  return host.startsWith("http") ? host : `https://${host}`;
}

function toWebsocketUrl(url: string) {
  return url.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
}

function replaceQuotedPlaceholders(
  content: string,
  values: string[],
  replacement: string
) {
  let patched = content;

  for (const value of values) {
    for (const quote of ['"', "'", "`"]) {
      patched = patched.split(`${quote}${value}${quote}`).join(
        `${quote}${replacement}${quote}`
      );
    }
  }

  return patched;
}

function replaceUrlPrefixes(content: string, prefixes: string[], replacement: string) {
  let patched = content;

  for (const prefix of prefixes) {
    patched = patched.replaceAll(prefix, replacement);
  }

  return patched;
}

function patchBackendUrl(content: string, backendUrl: string) {
  const websocketUrl = toWebsocketUrl(backendUrl);
  let patched = replaceQuotedPlaceholders(
    content,
    [
      "BACKEND_URL",
      "http://BACKEND_URL",
      "https://BACKEND_URL",
      "localhost:8000",
      "http://localhost:8000",
      "https://localhost:8000"
    ],
    backendUrl
  );

  patched = replaceUrlPrefixes(
    patched,
    [
      "http://BACKEND_URL",
      "https://BACKEND_URL",
      "http://localhost:8000",
      "https://localhost:8000",
      "http://127.0.0.1:8000",
      "https://127.0.0.1:8000"
    ],
    backendUrl
  );

  patched = replaceQuotedPlaceholders(
    patched,
    [
      "WS_BACKEND_URL",
      "ws://WS_BACKEND_URL",
      "wss://WS_BACKEND_URL",
      "ws://localhost:8000",
      "wss://localhost:8000"
    ],
    websocketUrl
  );

  patched = replaceUrlPrefixes(
    patched,
    [
      "ws://WS_BACKEND_URL",
      "wss://WS_BACKEND_URL",
      "ws://BACKEND_URL",
      "wss://BACKEND_URL",
      "ws://localhost:8000",
      "wss://localhost:8000",
      "ws://127.0.0.1:8000",
      "wss://127.0.0.1:8000"
    ],
    websocketUrl
  );

  return patched;
}

function normalizeStartCommand(command: string) {
  return command
    .replaceAll("127.0.0.1", "0.0.0.0")
    .replaceAll("localhost", "0.0.0.0")
    .replace(/uvicorn\s+main:app(?![^&\n]*--host)/, "uvicorn main:app --host 0.0.0.0")
    .replace(/python3?\s+-m\s+http\.server\s+3000(?![^&\n]*--bind)/, FRONTEND_FALLBACK_COMMAND);
}

async function isPortOpen(sandbox: Sandbox, port: number) {
  const result = await sandbox.commands.run(
    `python3 - <<'PY'\nimport socket, sys\ns = socket.socket()\ns.settimeout(1)\ntry:\n    s.connect(('127.0.0.1', ${port}))\nexcept OSError:\n    sys.exit(1)\nfinally:\n    s.close()\nPY`,
    {
      cwd: WORKDIR,
      timeoutMs: 5000
    }
  ).catch(() => null);

  return !!result;
}

async function waitForPort(sandbox: Sandbox, port: number, timeoutMs = 12000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await isPortOpen(sandbox, port)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return false;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as unknown;

    if (!isGeneratedApp(body)) {
      return NextResponse.json(
        { error: "Request body must include files, install_commands, and start_commands." },
        { status: 400 }
      );
    }

    if (!process.env.E2B_API_KEY) {
      return NextResponse.json(
        { error: "Missing E2B_API_KEY in the server environment." },
        { status: 500 }
      );
    }

    const sandbox = await Sandbox.create({
      apiKey: process.env.E2B_API_KEY,
      timeoutMs: TEN_MINUTES_MS
    });

    const backendUrl = normalizePublicUrl(sandbox.getHost(8000));
    const frontendUrl = normalizePublicUrl(sandbox.getHost(3000));

    await sandbox.files.makeDir(WORKDIR);

    for (const [filename, content] of Object.entries(body.files)) {
      const safeName = filename.replace(/^\/+/, "");
      await sandbox.files.write(
        `${WORKDIR}/${safeName}`,
        patchBackendUrl(content, backendUrl)
      );
    }

    for (const command of body.install_commands) {
      await sandbox.commands.run(command, {
        cwd: WORKDIR,
        timeoutMs: 180000
      });
    }

    for (const command of body.start_commands) {
      await sandbox.commands.run(normalizeStartCommand(command), {
        cwd: WORKDIR,
        background: true
      });
    }

    if (!(await waitForPort(sandbox, 3000, 5000)) && body.files["index.html"]) {
      await sandbox.commands.run(FRONTEND_FALLBACK_COMMAND, {
        cwd: WORKDIR,
        background: true
      });
    }

    const frontendReady = await waitForPort(sandbox, 3000);
    const backendReady = await waitForPort(sandbox, 8000, 5000);

    if (!frontendReady) {
      throw new Error("Frontend server did not start on port 3000.");
    }

    return NextResponse.json({
      frontend_url: frontendUrl,
      backend_url: backendUrl,
      sandbox_id: sandbox.sandboxId,
      backend_ready: backendReady
    });
  } catch (error) {
    console.error("Run API failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create or run the sandbox."
      },
      { status: 500 }
    );
  }
}
