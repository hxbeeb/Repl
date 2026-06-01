"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { FileTree } from "@/components/FileTree";
import { PreviewPanel } from "@/components/PreviewPanel";
import { ProgressSteps } from "@/components/ProgressSteps";
import type { GeneratedApp, ProgressState, RunResult } from "@/lib/types";

const STORAGE_KEY = "ai-app-builder-session";

type SavedSession = {
  generated: GeneratedApp;
  run: RunResult;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? "Request failed.");
  }

  return data as T;
}

export default function HomePage() {
  const [prompt, setPrompt] = useState("");
  const [progress, setProgress] = useState<ProgressState>("idle");
  const [generated, setGenerated] = useState<GeneratedApp | null>(null);
  const [run, setRun] = useState<RunResult | null>(null);
  const [error, setError] = useState("");

  const isBusy = useMemo(
    () => ["generating", "sandbox", "installing", "starting"].includes(progress),
    [progress]
  );

  useEffect(() => {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return;

    try {
      const session = JSON.parse(saved) as SavedSession;
      if (session.generated && session.run) {
        setGenerated(session.generated);
        setRun(session.run);
        setProgress("ready");
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!prompt.trim() || isBusy) return;

    setError("");
    setGenerated(null);
    setRun(null);
    window.localStorage.removeItem(STORAGE_KEY);

    try {
      setProgress("generating");
      const nextGenerated = await postJson<GeneratedApp>("/api/generate", { prompt });
      setGenerated(nextGenerated);

      setProgress("sandbox");
      await new Promise((resolve) => setTimeout(resolve, 350));

      setProgress("installing");
      await new Promise((resolve) => setTimeout(resolve, 350));

      setProgress("starting");
      const nextRun = await postJson<RunResult>("/api/run", nextGenerated);
      setRun(nextRun);
      setProgress("ready");

      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ generated: nextGenerated, run: nextRun })
      );
    } catch (caught) {
      setProgress("error");
      setError(
        caught instanceof Error
          ? caught.message
          : "Something went wrong while building your app."
      );
    }
  }

  return (
    <main className="builder-page">
      <section className="builder-shell">
        <header className="builder-hero">
          <div className="eyebrow">Gemini + E2B full-stack builder</div>
          <h1>What do you want to build?</h1>
          <p>
            Describe a FastAPI and React app. Gemini generates the files, E2B
            runs them, and you get a live sandbox preview.
          </p>
        </header>

        <form onSubmit={handleSubmit} className="prompt-panel">
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Build a todo app where I can add, complete and delete todos"
            className="prompt-input"
          />
          <div className="prompt-actions">
            <p>
              Sandboxes are configured with a 10 minute timeout, so save anything
              important from generated apps before they expire.
            </p>
            <button
              type="submit"
              disabled={isBusy || !prompt.trim()}
              className="primary-button"
            >
              {isBusy ? "Building..." : "Build app"}
            </button>
          </div>
        </form>

        <ProgressSteps state={progress} />

        {error ? (
          <div className="error-banner">{error}</div>
        ) : null}

        {run ? (
          <PreviewPanel
            frontendUrl={run.frontend_url}
            backendUrl={run.backend_url}
            sandboxId={run.sandbox_id}
          />
        ) : null}

        <FileTree files={generated?.files ?? {}} />
      </section>
    </main>
  );
}
