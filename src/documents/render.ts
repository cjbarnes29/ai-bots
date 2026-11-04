import { chartSvg } from "./svg.js";
import { esc, neutralize, type Block, type DocumentSpec } from "./spec.js";

/** Plain-text formats: a web page report, Markdown, CSV, and a deterministic summary of a CSV file (no AI needed for arithmetic). */
export function writeHtml(spec: DocumentSpec): string {
  const body = spec.blocks
    .map((b: Block) => {
      switch (b.type) {
        case "heading":
          return `<h${b.level + 1}>${esc(b.text)}</h${b.level + 1}>`;
        case "paragraph":
          return `<p>${esc(b.text).replace(/\n/g, "<br>")}</p>`;
        case "bullets":
          return `<ul>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
        case "numbered":
          return `<ol>${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ol>`;
        case "table":
          return `<table><thead><tr>${b.header.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(String(c ?? ""))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
        case "chart":
          return `<figure>${chartSvg(b.chart)}</figure>`;
        case "pagebreak":
          return "<hr>";
      }
    })
    .join("\n");
  // No scripts and nothing loaded from outside; the page may only use its own inline style and pictures.
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>${esc(spec.title)}</title><style>body{font-family:Arial,Helvetica,sans-serif;max-width:48rem;margin:2rem auto;padding:0 1rem;color:#111827;line-height:1.5}table{border-collapse:collapse;width:100%;margin:1rem 0}th,td{border:1px solid #9ca3af;padding:.35rem .5rem;text-align:left}th{background:#e5e7eb}svg{max-width:100%;height:auto}</style></head><body><h1>${esc(spec.title)}</h1>\n${body}\n</body></html>\n`;
}

export function writeMarkdown(spec: DocumentSpec): string {
  const cell = (v: unknown) => String(v ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
  const out = [`# ${spec.title}`, ""];
  for (const b of spec.blocks) {
    switch (b.type) {
      case "heading":
        out.push(`${"#".repeat(b.level + 1)} ${b.text}`, "");
        break;
      case "paragraph":
        out.push(b.text, "");
        break;
      case "bullets":
        out.push(...b.items.map((i) => `- ${i}`), "");
        break;
      case "numbered":
        out.push(...b.items.map((i, n) => `${n + 1}. ${i}`), "");
        break;
      case "table":
        out.push(`| ${b.header.map(cell).join(" | ")} |`, `| ${b.header.map(() => "---").join(" | ")} |`, ...b.rows.map((r) => `| ${b.header.map((_, c) => cell(r[c])).join(" | ")} |`), "");
        break;
      case "chart":
        out.push(`**${b.chart.title || "Chart"}**`, "", `| | ${b.chart.series.map((s) => cell(s.name)).join(" | ")} |`, `| --- | ${b.chart.series.map(() => "---").join(" | ")} |`, ...b.chart.labels.map((l, i) => `| ${cell(l)} | ${b.chart.series.map((s) => cell(s.values[i])).join(" | ")} |`), "");
        break;
      case "pagebreak":
        out.push("---", "");
        break;
    }
  }
  return out.join("\n");
}

export function writeCsv(header: string[], rows: (string | number | boolean | null)[][]): string {
  const q = (v: string | number | boolean | null) => {
    const s = typeof v === "number" ? String(v) : neutralize(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return `﻿${[header, ...rows].filter((r) => r.length > 0).map((r) => r.map(q).join(",")).join("\r\n")}\r\n`;
}

/** A small, strict CSV reader (quotes, doubled quotes, commas and line breaks inside quotes). */
export function parseCsv(text: string, maxRows = 5000): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((c) => c !== "") || row.length > 1) rows.push(row);
      row = [];
      if (rows.length >= maxRows + 1) return rows;
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Counts, sums, averages, smallest and largest for every column that is mostly numbers. Pure arithmetic: no AI call. */
export function summarizeTable(rows: string[][]): string {
  if (rows.length === 0) return "The file is empty.";
  const [header, ...data] = rows as [string[], ...string[][]];
  const lines = [`${data.length} data row(s), ${header.length} column(s).`];
  header.forEach((name, c) => {
    const values = data.map((r) => r[c] ?? "").filter((v) => v.trim() !== "");
    const nums = values.map((v) => Number(v.replace(/,/g, ""))).filter((n) => Number.isFinite(n));
    if (values.length > 0 && nums.length / values.length >= 0.8) {
      const sum = nums.reduce((a, b) => a + b, 0);
      lines.push(`${name || `column ${c + 1}`}: ${nums.length} numbers, sum ${round(sum)}, average ${round(sum / nums.length)}, smallest ${round(Math.min(...nums))}, largest ${round(Math.max(...nums))}`);
    } else {
      const counts = new Map<string, number>();
      for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([v, n]) => `${v.slice(0, 30)} (${n})`);
      lines.push(`${name || `column ${c + 1}`}: ${values.length} values, ${counts.size} different${top.length ? `; most common: ${top.join(", ")}` : ""}`);
    }
  });
  return lines.join("\n");
}
const round = (n: number) => Math.round(n * 1000) / 1000;
