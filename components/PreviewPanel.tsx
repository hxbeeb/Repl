"use client";

import { useState } from "react";

export function PreviewPanel({
  frontendUrl,
  backendUrl,
  sandboxId
}: {
  frontendUrl: string;
  backendUrl: string;
  sandboxId: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard.writeText(frontendUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="preview-panel">
      <div className="preview-toolbar">
        <div className="preview-meta">
          <div>Live preview</div>
          <span>{frontendUrl}</span>
        </div>
        <div className="preview-actions">
          <a
            href={frontendUrl}
            target="_blank"
            rel="noreferrer"
            className="primary-link"
          >
            Open in new tab
          </a>
          <button
            type="button"
            onClick={copyLink}
            className="secondary-button"
          >
            {copied ? "Copied" : "Copy link"}
          </button>
        </div>
      </div>
      <iframe
        title="Generated app preview"
        src={frontendUrl}
        className="preview-frame"
      />
      <div className="sandbox-strip">
        <span className="truncate">Sandbox: {sandboxId}</span>
        <span className="truncate">Frontend: {frontendUrl}</span>
        <span className="truncate">Backend: {backendUrl}</span>
      </div>
    </div>
  );
}
