"use client";

import hljs from "highlight.js";
import { useMemo, useState } from "react";
import type { GeneratedFiles } from "@/lib/types";

function languageFor(filename: string) {
  const extension = filename.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "py":
      return "python";
    case "html":
      return "html";
    case "css":
      return "css";
    case "js":
    case "jsx":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "json":
      return "json";
    case "txt":
      return "plaintext";
    default:
      return "plaintext";
  }
}

export function FileTree({ files }: { files: GeneratedFiles }) {
  const filenames = useMemo(() => Object.keys(files).sort(), [files]);
  const [activeFile, setActiveFile] = useState(filenames[0] ?? "");

  const currentFile = files[activeFile] ? activeFile : filenames[0] ?? "";
  const code = currentFile ? files[currentFile] : "";
  const language = languageFor(currentFile);
  const highlighted = hljs.highlight(code, { language, ignoreIllegals: true }).value;

  if (!filenames.length) {
    return (
      <div className="empty-panel">
        <span>Generated files will appear here.</span>
      </div>
    );
  }

  return (
    <div className="file-workspace">
      <aside className="file-sidebar">
        <div className="panel-label">Generated files</div>
        <div className="file-list">
          {filenames.map((filename) => (
            <button
              key={filename}
              type="button"
              onClick={() => setActiveFile(filename)}
              className={[
                "file-button",
                filename === currentFile ? "file-button-active" : ""
              ].join(" ")}
            >
              {filename}
            </button>
          ))}
        </div>
      </aside>
      <section className="code-panel">
        <div className="code-header">
          <h2>{currentFile}</h2>
          <span>{language}</span>
        </div>
        <pre className="code-block">
          <code
            className={`language-${language}`}
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </pre>
      </section>
    </div>
  );
}
