"use client";

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import hljs from "highlight.js";
import type { GeneratedApp, ProgressState, RunResult } from "@/lib/types";

/* ── helpers ──────────────────────────────────────────── */

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed.");
  return data as T;
}

type RunResponse =
  | { ok: true; data: RunResult }
  | { ok: false; status: number; error: string; logs?: string; fixable?: boolean };

async function postRun(body: unknown): Promise<RunResponse> {
  const res = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (res.ok) return { ok: true, data: data as RunResult };
  return { ok: false, status: res.status, error: data.error ?? "Run failed.", logs: data.logs, fixable: data.fixable };
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "py") return "🐍";
  if (ext === "html") return "🌐";
  if (ext === "css") return "🎨";
  if (ext === "js" || ext === "jsx") return "⚡";
  if (ext === "ts" || ext === "tsx") return "📘";
  if (ext === "json") return "{}";
  if (name.includes("requirements")) return "📦";
  return "📄";
}

function langFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    py: "python", html: "html", css: "css",
    js: "javascript", jsx: "javascript",
    ts: "typescript", tsx: "typescript",
    json: "json", txt: "plaintext",
  };
  return map[ext ?? ""] ?? "plaintext";
}

const PROGRESS_LABELS: Partial<Record<ProgressState, string>> = {
  generating: "Generating code…",
  sandbox: "Spinning up sandbox…",
  installing: "Installing dependencies…",
  starting: "Starting servers…",
  fixing: "Auto-fixing errors…",
};

/* ── inner component (needs Suspense for useSearchParams) */

function BuilderInner() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [prompt, setPrompt] = useState("");
  const [progress, setProgress] = useState<ProgressState>("idle");
  const [generated, setGenerated] = useState<GeneratedApp | null>(null);
  const [run, setRun] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projectName, setProjectName] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeFile, setActiveFile] = useState("");
  const [instruction, setInstruction] = useState("");
  const [improving, setImproving] = useState(false);
  const [model, setModel] = useState<"gemini-2.5-flash" | "gemini-2.5-pro">("gemini-2.5-flash");
  const [fixInfo, setFixInfo] = useState<{ attempt: number; message: string } | null>(null);
  const modelRef = useRef(model);
  modelRef.current = model;

  const isBusy = useMemo(
    () => ["generating", "sandbox", "installing", "starting", "fixing"].includes(progress),
    [progress]
  );
  const hasProject = !!generated;
  const filenames = useMemo(
    () => Object.keys(generated?.files ?? {}).sort(),
    [generated]
  );
  const currentFile = filenames.includes(activeFile) ? activeFile : (filenames[0] ?? "");
  const code = generated?.files[currentFile] ?? "";
  const highlighted = currentFile
    ? hljs.highlight(code, { language: langFor(currentFile), ignoreIllegals: true }).value
    : "";

  const instructionRef = useRef<HTMLTextAreaElement>(null);
  const loadingRef = useRef(false);

  /* load from ?project= param only — no localStorage restore */
  useEffect(() => {
    const pid = searchParams.get("project");
    if (!pid) return;

    loadingRef.current = true;
    fetch(`/api/projects/${pid}`)
      .then((r) => r.json())
      .then((proj) => {
        if (!proj?.files) return;
        const app: GeneratedApp = {
          files: proj.files as Record<string, string>,
          install_commands: proj.installCommands ?? [],
          start_commands: proj.startCommands ?? [],
        };
        setGenerated(app);
        setPrompt(proj.prompt ?? "");
        setProjectId(proj.id);
        setProjectName(proj.name ?? "");
        setProgress("idle");
        loadingRef.current = false;

        // If the project has a saved sandbox URL, check if it's still alive
        if (proj.frontendUrl) {
          fetch(`/api/sandbox-alive?url=${encodeURIComponent(proj.frontendUrl)}`)
            .then((r) => r.json())
            .then(({ alive }: { alive: boolean }) => {
              if (alive) {
                setRun({
                  frontend_url: proj.frontendUrl,
                  backend_url: proj.backendUrl ?? "",
                  sandbox_id: proj.sandboxId ?? "",
                  backend_ready: true,
                });
                setProgress("ready");
              } else {
                setRun(null);
                setProgress("idle");
              }
            })
            .catch(() => {
              setRun(null);
              setProgress("idle");
            });
        } else {
          setRun(null);
          setProgress("idle");
        }
      })
      .catch(console.error)
      .finally(() => { loadingRef.current = false; });
  }, [searchParams]);

  /* auto-save to DB — debounced 1.5s after any change */
  useEffect(() => {
    if (!generated || !session || loadingRef.current) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveStatus("idle");
    saveTimer.current = setTimeout(async () => {
      const name = projectName.trim() || prompt.trim().slice(0, 60) || "Untitled";
      setSaveStatus("saving");
      try {
        if (projectId) {
          await fetch(`/api/projects/${projectId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name, prompt,
              files: generated.files,
              installCommands: generated.install_commands,
              startCommands: generated.start_commands,
              sandboxId: run?.sandbox_id ?? null,
              frontendUrl: run?.frontend_url ?? null,
            }),
          });
        } else {
          const saved = await postJson<{ id: string }>("/api/projects", {
            name, prompt,
            files: generated.files,
            installCommands: generated.install_commands,
            startCommands: generated.start_commands,
            sandboxId: run?.sandbox_id ?? null,
            frontendUrl: run?.frontend_url ?? null,
          });
          setProjectId(saved.id);
        }
        if (projectName !== name) setProjectName(name);
        setSaveStatus("saved");
      } catch {
        setSaveStatus("idle");
      }
    }, 1500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generated, run, projectName, session]);

  function handleNew() {
    loadingRef.current = false;
    setGenerated(null);
    setRun(null);
    setProgress("idle");
    setError("");
    setProjectId(null);
    setProjectName("");
    setPrompt("");
    setInstruction("");
    setSaveStatus("idle");
    if (searchParams.get("project")) router.push("/");
  }

  const MAX_FIX_ATTEMPTS = 3;

  const launchSandbox = useCallback(async (app: GeneratedApp): Promise<RunResult | null> => {
    setError("");
    setRun(null);
    setFixInfo(null);

    let currentApp = app;

    for (let attempt = 0; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
      setProgress(attempt === 0 ? "sandbox" : "fixing");
      await new Promise((r) => setTimeout(r, 150));
      if (attempt === 0) setProgress("installing");
      await new Promise((r) => setTimeout(r, 150));
      setProgress(attempt === 0 ? "starting" : "fixing");

      const res = await postRun(currentApp);

      if (res.ok) {
        setRun(res.data);
        setProgress("ready");
        setFixInfo(null);
        return res.data;
      }

      // Not a fixable error, or out of attempts → give up
      if (!res.fixable || attempt >= MAX_FIX_ATTEMPTS) {
        setProgress("error");
        setError(
          attempt > 0
            ? `Couldn't auto-fix after ${attempt} ${attempt === 1 ? "attempt" : "attempts"}: ${res.error}`
            : res.error
        );
        return null;
      }

      // Attempt an AI fix
      setProgress("fixing");
      setFixInfo({ attempt: attempt + 1, message: "Detected an error — asking AI to fix it…" });
      try {
        const fixed = await postJson<GeneratedApp>("/api/fix", {
          current: currentApp,
          error: res.error,
          logs: res.logs,
          model: modelRef.current,
        });
        currentApp = fixed;
        setGenerated(fixed); // show the corrected code in the editor
      } catch (fixErr) {
        setProgress("error");
        setError(
          `Auto-fix failed: ${fixErr instanceof Error ? fixErr.message : "unknown error"}\n\nOriginal error:\n${res.error}`
        );
        return null;
      }
    }

    return null;
  }, []);

  async function handleBuild(e: FormEvent) {
    e.preventDefault();
    if (!prompt.trim() || isBusy) return;
    setError("");
    setGenerated(null);
    setRun(null);
    setProjectId(null);
    setProjectName("");
    setSaveStatus("idle");
    window.localStorage.removeItem("builder-session");

    try {
      setProgress("generating");
      const app = await postJson<GeneratedApp>("/api/generate", { prompt, model });
      setGenerated(app);
      setActiveFile(Object.keys(app.files).sort()[0] ?? "");
      await launchSandbox(app);
    } catch (e) {
      setProgress("error");
      setError(e instanceof Error ? e.message : "Something went wrong.");
    }
  }

  async function handleRestart() {
    if (!generated || isBusy) return;
    const result = await launchSandbox(generated);
    if (result && projectId) {
      fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sandboxId: result.sandbox_id, frontendUrl: result.frontend_url }),
      });
    }
  }

  async function handleImprove(e: FormEvent) {
    e.preventDefault();
    if (!instruction.trim() || !generated || improving || isBusy) return;
    setImproving(true);
    setError("");
    try {
      const improved = await postJson<GeneratedApp>("/api/improve", {
        instruction: instruction.trim(),
        current: generated,
        model,
      });
      setGenerated(improved);
      setActiveFile(Object.keys(improved.files).sort()[0] ?? "");
      setInstruction("");
      await launchSandbox(improved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to improve the app.");
    } finally {
      setImproving(false);
    }
  }


  /* ── Top bar ────────────────────────────────────────── */
  function Topbar() {
    return (
      <header className="topbar">
        <button className="topbar-brand" onClick={handleNew} style={{ background: "none", border: "none", cursor: "pointer" }}>
          <span className="topbar-brand-dot" />
          Builder
        </button>

        {hasProject && (
          <div className="topbar-project-name">
            <input
              value={projectName}
              onChange={(e) => { setProjectName(e.target.value); setSaveStatus("idle"); }}
              placeholder="Untitled project"
              spellCheck={false}
            />
          </div>
        )}

        <div className="topbar-actions">
          {hasProject && (
            <>
              {/* status pill */}
              {progress === "ready" && run && (
                <span className="status-pill status-pill-live">● Live</span>
              )}
              {isBusy && (
                <span className="status-pill status-pill-building">◌ Building</span>
              )}
              {progress === "error" && (
                <span className="status-pill status-pill-error">✕ Error</span>
              )}

              {/* restart */}
              {!run && !isBusy && (
                <button className="btn btn-secondary" onClick={handleRestart}>
                  ▶ Run
                </button>
              )}

              {/* open external */}
              {run && (
                <a className="btn btn-ghost" href={run.frontend_url} target="_blank" rel="noreferrer">
                  ↗ Open
                </a>
              )}

              <div className="topbar-sep" />

              {/* auto-save status */}
              {session ? (
                <span className="topbar-save-status">
                  {saveStatus === "saving" ? "Saving…" : saveStatus === "saved" ? "✓ Saved" : ""}
                </span>
              ) : (
                <button className="btn btn-secondary" onClick={() => signIn("google")}>
                  Sign in to save
                </button>
              )}
            </>
          )}

          <div className="topbar-sep" />
          <Link href="/projects" className="topbar-link">Projects</Link>

          {authStatus === "authenticated" && session ? (
            <div className="topbar-user">
              {session.user.image ? (
                <Image src={session.user.image} alt="" width={26} height={26} className="topbar-avatar" />
              ) : (
                <div className="topbar-avatar-fallback">
                  {session.user.name?.[0] ?? "?"}
                </div>
              )}
            </div>
          ) : authStatus !== "loading" ? (
            <button className="btn btn-primary" onClick={() => signIn("google")}>Sign in</button>
          ) : null}
        </div>
      </header>
    );
  }

  /* ── Landing (no project yet) ──────────────────────── */
  if (!hasProject) {
    return (
      <>
        <Topbar />
        <div className="landing">
          <div className="landing-hero">
            <h1>What do you want to build?</h1>
            <p>Describe an app and Gemini writes the code. E2B runs it live in seconds.</p>
          </div>
          <form className="landing-form" onSubmit={handleBuild}>
            <textarea
              className="landing-textarea"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="A real-time chat app with rooms and usernames…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleBuild(e);
              }}
            />
            <div className="landing-form-footer">
              <div className="model-toggle">
                <button
                  type="button"
                  className={`model-toggle-btn ${model === "gemini-2.5-flash" ? "active" : ""}`}
                  onClick={() => setModel("gemini-2.5-flash")}
                >
                  Flash <span className="model-badge">Fast</span>
                </button>
                <button
                  type="button"
                  className={`model-toggle-btn ${model === "gemini-2.5-pro" ? "active" : ""}`}
                  onClick={() => setModel("gemini-2.5-pro")}
                >
                  Pro <span className="model-badge">Smart</span>
                </button>
              </div>
              <button
                type="submit"
                className="btn btn-primary btn-lg"
                disabled={isBusy || !prompt.trim()}
              >
                {isBusy ? (PROGRESS_LABELS[progress] ?? "Building…") : "Build app →"}
              </button>
            </div>
            {error && <div className="error-bar" style={{ borderRadius: 6, borderTop: "none", border: "1px solid rgba(248,81,73,0.25)" }}>{error}</div>}
          </form>
        </div>
      </>
    );
  }

  /* ── IDE workspace ─────────────────────────────────── */
  return (
    <>
      <Topbar />
      <div className="workspace">

        {/* ── Left: file list ── */}
        <aside className="ws-sidebar">
          <div className="ws-sidebar-header">
            <span className="ws-sidebar-title">Files</span>
          </div>
          <div className="ws-file-list">
            {filenames.map((name) => (
              <button
                key={name}
                className={`ws-file-item ${name === currentFile ? "active" : ""}`}
                onClick={() => setActiveFile(name)}
              >
                <span className="ws-file-icon">{fileIcon(name)}</span>
                {name}
              </button>
            ))}
          </div>
        </aside>

        {/* ── Center: code viewer ── */}
        <div className="ws-editor">
          {currentFile ? (
            <>
              <div className="ws-tab-bar">
                {filenames.map((name) => (
                  <button
                    key={name}
                    className={`ws-tab ${name === currentFile ? "active" : ""}`}
                    onClick={() => setActiveFile(name)}
                  >
                    <span style={{ fontSize: 11 }}>{fileIcon(name)}</span>
                    {name}
                  </button>
                ))}
              </div>
              <div className="ws-code-scroll">
                <pre className="ws-code">
                  <code dangerouslySetInnerHTML={{ __html: highlighted }} />
                </pre>
              </div>
            </>
          ) : (
            <div className="ws-empty">
              <span style={{ fontSize: 32 }}>📂</span>
              <span>No files generated yet</span>
            </div>
          )}
        </div>

        {/* ── Right: preview + prompt ── */}
        <div className="ws-right">
          {/* preview bar */}
          <div className="ws-preview-bar">
            <div className="ws-preview-url">
              {run ? run.frontend_url : "No sandbox running"}
            </div>
            {run && (
              <a className="btn btn-ghost" style={{ height: 26, padding: "0 8px", fontSize: 11 }}
                href={run.frontend_url} target="_blank" rel="noreferrer">↗</a>
            )}
          </div>

          {/* iframe or placeholder */}
          {run ? (
            <iframe
              key={run.frontend_url}
              className="ws-preview-frame"
              src={run.frontend_url}
              title="Preview"
            />
          ) : (
            <div className="ws-preview-placeholder">
              <div className="ws-preview-placeholder-icon">🖥</div>
              {isBusy ? (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="ws-progress-dot" />
                    <span>{PROGRESS_LABELS[progress] ?? "Working…"}</span>
                  </div>
                  {fixInfo && (
                    <div className="fix-banner">
                      🔧 Fix attempt {fixInfo.attempt}/{MAX_FIX_ATTEMPTS} — {fixInfo.message}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <span>Sandbox not running</span>
                  <button className="btn btn-secondary" onClick={handleRestart}>
                    ▶ Start sandbox
                  </button>
                </>
              )}
            </div>
          )}

          {/* progress indicator (building) */}
          {isBusy && run === null && (
            <div className="ws-progress">
              <span className="ws-progress-dot" />
              {PROGRESS_LABELS[progress] ?? "Working…"}
            </div>
          )}

          {/* error bar */}
          {error && <div className="error-bar">{error}</div>}

          {/* prompt / improve bar */}
          <div className="ws-prompt-bar">
            <form onSubmit={improving || !generated ? undefined : handleImprove}>
              <textarea
                ref={instructionRef}
                className="ws-prompt-input"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder={
                  progress === "ready" || (!isBusy && generated)
                    ? "Describe a change… (⌘↵ to apply)"
                    : "Generating…"
                }
                disabled={isBusy || improving}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    if (instruction.trim() && !improving && !isBusy) handleImprove(e as unknown as FormEvent);
                  }
                }}
              />
              <div className="ws-prompt-footer">
                <div className="model-toggle model-toggle-sm">
                  <button
                    type="button"
                    className={`model-toggle-btn ${model === "gemini-2.5-flash" ? "active" : ""}`}
                    onClick={() => setModel("gemini-2.5-flash")}
                  >Flash</button>
                  <button
                    type="button"
                    className={`model-toggle-btn ${model === "gemini-2.5-pro" ? "active" : ""}`}
                    onClick={() => setModel("gemini-2.5-pro")}
                  >Pro</button>
                </div>
                <div className="ws-prompt-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={handleNew}
                  >
                    New
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary"
                    disabled={improving || isBusy || !instruction.trim()}
                    onClick={handleImprove}
                  >
                    {improving ? "Improving…" : "Apply"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>

      </div>
    </>
  );
}

export default function BuilderPage() {
  return (
    <Suspense>
      <BuilderInner />
    </Suspense>
  );
}
