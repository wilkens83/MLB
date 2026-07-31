"use client";

/* Minimal, SAFE markdown renderer. Renders a small, known subset (headings-as-bold,
   **bold**, `code`, and "- " bullet lists) into React elements. It NEVER injects
   raw HTML (no dangerouslySetInnerHTML), so model/tool text cannot inject markup. */

import { Fragment } from "react";

function renderInline(text: string, keyBase: string) {
  // Split on **bold** and `code`, keeping delimiters.
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**"))
      return (
        <strong key={`${keyBase}-${i}`} className="font-semibold text-foreground">
          {p.slice(2, -2)}
        </strong>
      );
    if (p.startsWith("`") && p.endsWith("`"))
      return (
        <code key={`${keyBase}-${i}`} className="rounded bg-surface-2 px-1 py-0.5 text-[0.85em]">
          {p.slice(1, -1)}
        </code>
      );
    return <Fragment key={`${keyBase}-${i}`}>{p}</Fragment>;
  });
}

export function SafeMarkdown({ content }: { content: string }) {
  const lines = content.split("\n");
  const out: React.ReactNode[] = [];
  let list: string[] = [];
  const flush = (key: string) => {
    if (list.length) {
      out.push(
        <ul key={`ul-${key}`} className="my-1.5 list-disc space-y-0.5 pl-5">
          {list.map((li, i) => (
            <li key={i}>{renderInline(li, `li-${key}-${i}`)}</li>
          ))}
        </ul>,
      );
      list = [];
    }
  };
  lines.forEach((raw, idx) => {
    const line = raw.trimEnd();
    if (/^\s*-\s+/.test(line)) {
      list.push(line.replace(/^\s*-\s+/, ""));
      return;
    }
    flush(String(idx));
    if (line.trim() === "") return;
    out.push(
      <p key={`p-${idx}`} className="my-1 leading-relaxed">
        {renderInline(line, `p-${idx}`)}
      </p>,
    );
  });
  flush("end");
  return <div className="text-sm text-foreground/90">{out}</div>;
}
