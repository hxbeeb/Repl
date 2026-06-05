"use client";

import { useEffect, useState } from "react";
import { useSession, signIn } from "next-auth/react";
import Link from "next/link";
import { Navbar } from "@/components/Navbar";

type ProjectSummary = {
  id: string;
  name: string;
  prompt: string;
  frontendUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export default function ProjectsPage() {
  const { data: session, status } = useSession();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/projects")
      .then((r) => r.json())
      .then((d) => setProjects(Array.isArray(d) ? d : []))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [status]);

  async function handleDelete() {
    if (!confirmId) return;
    setDeleting(confirmId);
    setConfirmId(null);
    try {
      await fetch(`/api/projects/${confirmId}`, { method: "DELETE" });
      setProjects((p) => p.filter((x) => x.id !== confirmId));
    } finally {
      setDeleting(null);
    }
  }

  if (status === "loading") {
    return (
      <>
        <Navbar />
        <div className="projects-page">
          <div className="projects-inner">
            <div className="projects-loading">Loading…</div>
          </div>
        </div>
      </>
    );
  }

  if (!session) {
    return (
      <>
        <Navbar />
        <div className="projects-page">
          <div className="auth-gate">
            <h2>Sign in to see your projects</h2>
            <p>All your saved apps will appear here.</p>
            <button className="btn btn-primary btn-lg" onClick={() => signIn("google")}>
              Sign in with Google
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="projects-page">
        <div className="projects-inner">
          <div className="projects-page-header">
            <div>
              <h1>My Projects</h1>
              <p>{projects.length} saved app{projects.length !== 1 ? "s" : ""}</p>
            </div>
            <Link href="/" className="btn btn-primary btn-lg">+ New project</Link>
          </div>

          {loading ? (
            <div className="projects-loading">Loading projects…</div>
          ) : projects.length === 0 ? (
            <div className="projects-empty">
              <span style={{ fontSize: 40 }}>🚀</span>
              <h3>No projects yet</h3>
              <p>Build your first app and save it from the editor.</p>
              <Link href="/" className="btn btn-primary btn-lg">Build something</Link>
            </div>
          ) : (
            <div className="projects-grid">
              {projects.map((p) => (
                <article key={p.id} className="project-card">
                  <div>
                    <div className="project-card-name">{p.name}</div>
                    <div className="project-card-prompt" style={{ marginTop: 6 }}>{p.prompt}</div>
                  </div>
                  <div className="project-card-meta">
                    <time className="project-card-date">
                      {new Date(p.updatedAt).toLocaleDateString(undefined, {
                        month: "short", day: "numeric", year: "numeric",
                      })}
                    </time>
                  </div>
                  <div className="project-card-actions">
                    <Link href={`/?project=${p.id}`} className="btn btn-secondary">Open</Link>
                    {p.frontendUrl && (
                      <a href={p.frontendUrl} target="_blank" rel="noreferrer" className="btn btn-ghost">
                        ↗ Preview
                      </a>
                    )}
                    <button
                      className="btn btn-danger"
                      disabled={deleting === p.id}
                      onClick={() => setConfirmId(p.id)}
                    >
                      {deleting === p.id ? "…" : "Delete"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      {confirmId && (
        <div className="modal-backdrop" onClick={() => setConfirmId(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h3>Delete project?</h3>
            <p>This cannot be undone. The project and all its code will be permanently removed.</p>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setConfirmId(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
