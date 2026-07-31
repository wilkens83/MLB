/* Client-side export of an assistant response as JSON / Markdown / CSV. Only the
   formats applicable to a response are offered (CSV only when a table exists). */

import type { ChatAssistantResponse } from "../schemas/response";

export function toJSON(res: ChatAssistantResponse): string {
  return JSON.stringify(res, null, 2);
}

export function toMarkdown(res: ChatAssistantResponse): string {
  const lines: string[] = [];
  if (res.title) lines.push(`# ${res.title}`, "");
  lines.push(res.answer, "");
  for (const b of res.blocks) {
    if (b.type === "markdown") lines.push(b.content, "");
    else if (b.type === "table") {
      if (b.title) lines.push(`**${b.title}**`, "");
      lines.push(`| ${b.columns.map((c) => c.label).join(" | ")} |`);
      lines.push(`| ${b.columns.map(() => "---").join(" | ")} |`);
      for (const row of b.rows)
        lines.push(`| ${b.columns.map((c) => String(row[c.key] ?? "")).join(" | ")} |`);
      lines.push("");
    } else if (b.type === "metric-grid") {
      if (b.title) lines.push(`**${b.title}**`, "");
      for (const m of b.metrics) lines.push(`- ${m.label}: ${m.value}`);
      lines.push("");
    }
  }
  if (res.warnings.length) {
    lines.push("**Warnings**", "");
    for (const w of res.warnings) lines.push(`- ${w}`);
    lines.push("");
  }
  if (res.sources.length) {
    lines.push("**Sources**", "");
    for (const s of res.sources) lines.push(`- ${s.name}${s.modelVersion ? ` (${s.modelVersion})` : ""} — ${s.freshnessStatus}`);
  }
  return lines.join("\n");
}

export function hasTable(res: ChatAssistantResponse): boolean {
  return res.blocks.some((b) => b.type === "table");
}

export function toCSV(res: ChatAssistantResponse): string {
  const table = res.blocks.find((b) => b.type === "table");
  if (!table || table.type !== "table") return "";
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = table.columns.map((c) => esc(c.label)).join(",");
  const rows = table.rows.map((r) => table.columns.map((c) => esc(r[c.key])).join(","));
  return [header, ...rows].join("\n");
}

export function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
