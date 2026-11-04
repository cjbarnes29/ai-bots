import { deflateSync } from "node:zlib";
import type { Block, DocumentSpec } from "./spec.js";

/**
 * A plain PDF writer (no packages): A4 pages, the standard fonts every PDF reader has, headings, paragraphs, lists, tables and bar/line charts
 * drawn as shapes. Characters outside Western European text are shown as "?" because the standard fonts cannot draw them.
 */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 56;
const COLORS: [number, number, number][] = [[0.31, 0.27, 0.9], [0.05, 0.65, 0.91], [0.06, 0.73, 0.51], [0.96, 0.62, 0.04], [0.94, 0.27, 0.27], [0.55, 0.36, 0.96]];

function winAnsi(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    const c = ch.codePointAt(0)!;
    if (c === 9) out += "    ";
    else if (c >= 32 && c < 127) out += ch === "(" || ch === ")" || ch === "\\" ? `\\${ch}` : ch;
    else if (c >= 160 && c <= 255) out += `\\${c.toString(8).padStart(3, "0")}`;
    else if (c === 0x2022) out += "\\225";
    else if (c === 0x2013) out += "\\226";
    else if (c === 0x2014) out += "\\227";
    else if (c === 0x2018 || c === 0x2019) out += "'";
    else if (c === 0x201c || c === 0x201d) out += '"';
    else if (c === 0x20ac) out += "\\200";
    else if (c === 10 || c === 13) out += " ";
    else out += "?";
  }
  return out;
}

// average character widths (in 1/1000 em) of Helvetica and Helvetica-Bold: good enough to wrap lines without cutting words
const avg = (bold: boolean, mono: boolean) => (mono ? 600 : bold ? 580 : 540);

function wrap(text: string, size: number, maxWidth: number, bold = false, mono = false): string[] {
  const perChar = (avg(bold, mono) / 1000) * size;
  const maxChars = Math.max(8, Math.floor(maxWidth / perChar));
  const lines: string[] = [];
  for (const para of text.split(/\r?\n/)) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      let w = word;
      while (w.length > maxChars) {
        if (line) {
          lines.push(line);
          line = "";
        }
        lines.push(w.slice(0, maxChars));
        w = w.slice(maxChars);
      }
      if ((line + " " + w).trim().length > maxChars) {
        lines.push(line);
        line = w;
      } else line = (line ? line + " " : "") + w;
    }
    lines.push(line);
  }
  return lines;
}

interface Page {
  ops: string[];
}

export function writePdf(spec: DocumentSpec): Buffer {
  const pages: Page[] = [{ ops: [] }];
  let y = PAGE_H - MARGIN;
  const page = () => pages[pages.length - 1]!;
  const newPage = () => {
    pages.push({ ops: [] });
    y = PAGE_H - MARGIN;
  };
  const need = (h: number) => {
    if (y - h < MARGIN) newPage();
  };
  const text = (t: string, x: number, size: number, font: "F1" | "F2" | "F3" = "F1", color = "0.1 0.13 0.2") => {
    page().ops.push(`BT /${font} ${size} Tf ${color} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${winAnsi(t)}) Tj ET`);
  };
  const block = (t: string, size: number, o: { bold?: boolean; indent?: number; gap?: number; mono?: boolean; color?: string; prefix?: string } = {}) => {
    const lines = wrap(t, size, PAGE_W - MARGIN * 2 - (o.indent ?? 0), o.bold, o.mono);
    const lead = size * 1.35;
    lines.forEach((l, i) => {
      need(lead);
      y -= lead;
      if (i === 0 && o.prefix) text(o.prefix, MARGIN + (o.indent ?? 0) - 16, size, o.bold ? "F2" : "F1");
      text(l, MARGIN + (o.indent ?? 0), size, o.mono ? "F3" : o.bold ? "F2" : "F1", o.color);
    });
    y -= o.gap ?? 4;
  };

  block(spec.title, 22, { bold: true, gap: 14 });
  const table = (header: string[], rows: (string | number | boolean | null)[][]) => {
    const cols = Math.max(header.length, ...rows.map((r) => r.length), 1);
    const colW = (PAGE_W - MARGIN * 2) / cols;
    const size = 9;
    const draw = (cells: string[], bold: boolean, shade: boolean) => {
      const wrapped = Array.from({ length: cols }, (_, c) => wrap(cells[c] ?? "", size, colW - 8, bold));
      const rowH = Math.max(...wrapped.map((w) => w.length)) * size * 1.3 + 6;
      need(rowH);
      if (shade) page().ops.push(`0.9 0.91 0.93 rg ${MARGIN} ${(y - rowH).toFixed(2)} ${(PAGE_W - MARGIN * 2).toFixed(2)} ${rowH.toFixed(2)} re f`);
      page().ops.push(`0.6 0.64 0.69 RG 0.5 w ${MARGIN} ${(y - rowH).toFixed(2)} ${(PAGE_W - MARGIN * 2).toFixed(2)} ${rowH.toFixed(2)} re S`);
      wrapped.forEach((lines, c) => {
        lines.forEach((l, i) => {
          const saved = y;
          y = saved - 3 - size * 1.15 * (i + 1);
          text(l, MARGIN + c * colW + 4, size, bold ? "F2" : "F1");
          y = saved;
        });
      });
      y -= rowH;
    };
    draw(header, true, true);
    for (const r of rows) draw(Array.from({ length: cols }, (_, c) => String(r[c] ?? "")), false, false);
    y -= 8;
  };

  const chart = (c: Extract<Block, { type: "chart" }>["chart"]) => {
    const h = 190;
    const w = PAGE_W - MARGIN * 2;
    if (c.title) block(c.title, 12, { bold: true, gap: 4 });
    need(h + 40);
    const top = y;
    const plotH = h - 36;
    const max = Math.max(1e-9, ...c.series.flatMap((s) => s.values));
    const n = c.labels.length;
    const slot = w / n;
    page().ops.push(`0.6 0.64 0.69 RG 0.5 w ${MARGIN} ${(top - plotH).toFixed(2)} m ${(MARGIN + w).toFixed(2)} ${(top - plotH).toFixed(2)} l S`);
    if (c.kind === "pie") {
      // pie charts are shown as a list of shares (drawing arcs by hand is not worth the risk of a broken file)
      const total = c.series[0]!.values.reduce((a, b) => a + Math.max(0, b), 0) || 1;
      let yy = top;
      c.series[0]!.values.forEach((v, i) => {
        yy -= 18;
        const col = COLORS[i % COLORS.length]!;
        page().ops.push(`${col.join(" ")} rg ${MARGIN} ${(yy - 2).toFixed(2)} 12 12 re f`);
        const saved = y;
        y = yy;
        text(`${c.labels[i] ?? ""}: ${v} (${Math.round((Math.max(0, v) / total) * 100)}%)`, MARGIN + 18, 10);
        y = saved;
      });
      y = top - Math.max(h, c.labels.length * 18 + 10) - 8;
      return;
    }
    const group = slot * 0.7;
    const barW = group / c.series.length;
    c.series.forEach((s, si) => {
      const col = COLORS[si % COLORS.length]!;
      const pts: [number, number][] = [];
      s.values.slice(0, n).forEach((v, i) => {
        const bh = (Math.max(0, v) / max) * plotH;
        if (c.kind === "bar") {
          page().ops.push(`${col.join(" ")} rg ${(MARGIN + slot * i + (slot - group) / 2 + barW * si).toFixed(2)} ${(top - plotH).toFixed(2)} ${(barW - 2).toFixed(2)} ${bh.toFixed(2)} re f`);
        } else pts.push([MARGIN + slot * i + slot / 2, top - plotH + bh]);
      });
      if (c.kind === "line" && pts.length > 0) page().ops.push(`${col.join(" ")} RG 1.5 w ${pts.map(([px, py], i) => `${px.toFixed(2)} ${py.toFixed(2)} ${i === 0 ? "m" : "l"}`).join(" ")} S`);
    });
    c.labels.forEach((l, i) => {
      const saved = y;
      y = top - plotH - 12;
      text(l.length > 14 ? `${l.slice(0, 13)}.` : l, MARGIN + slot * i + 2, 8);
      y = saved;
    });
    const saved = y;
    y = top + 2 - 0;
    text(`max ${Math.round(max * 100) / 100}`, MARGIN + w - 60, 8, "F1", "0.4 0.4 0.4");
    y = saved;
    y = top - h - 4;
    if (c.series.length > 1) block(c.series.map((s) => s.name).join("   |   "), 8, { color: "0.4 0.4 0.4", gap: 6 });
  };

  for (const b of spec.blocks) {
    switch (b.type) {
      case "heading":
        y -= 6;
        block(b.text, b.level === 1 ? 17 : b.level === 2 ? 14 : 12, { bold: true, gap: 4 });
        break;
      case "paragraph":
        block(b.text, 11, { gap: 8 });
        break;
      case "bullets":
        b.items.forEach((t) => block(t, 11, { indent: 20, prefix: "•", gap: 2 }));
        y -= 6;
        break;
      case "numbered":
        b.items.forEach((t, i) => block(t, 11, { indent: 22, prefix: `${i + 1}.`, gap: 2 }));
        y -= 6;
        break;
      case "table":
        table(b.header, b.rows);
        break;
      case "chart":
        chart(b.chart);
        break;
      case "pagebreak":
        newPage();
        break;
    }
  }

  // ---- assemble the file ----
  const objects: Buffer[] = [];
  const add = (body: string | Buffer) => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"));
    return objects.length;
  };
  const catalog = add("");
  const pagesRoot = add("");
  const fonts = [add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"), add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"), add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>")];
  const pageIds: number[] = [];
  for (const p of pages) {
    const content = deflateSync(Buffer.from(p.ops.join("\n"), "latin1"));
    const cid = add(Buffer.concat([Buffer.from(`<< /Length ${content.length} /Filter /FlateDecode >>\nstream\n`, "latin1"), content, Buffer.from("\nendstream", "latin1")]));
    pageIds.push(add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Resources << /Font << /F1 ${fonts[0]} 0 R /F2 ${fonts[1]} 0 R /F3 ${fonts[2]} 0 R >> >> /Contents ${cid} 0 R >>`));
  }
  objects[catalog - 1] = Buffer.from(`<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`, "latin1");
  objects[pagesRoot - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`, "latin1");
  const info = add(`<< /Title (${winAnsi(spec.title).slice(0, 200)}) /Producer (AI Workforce Platform) >>`);

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  const offsets: number[] = [];
  let pos = chunks[0]!.length;
  objects.forEach((o, i) => {
    offsets.push(pos);
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), o, Buffer.from("\nendobj\n", "latin1")]);
    chunks.push(b);
    pos += b.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${pos}\n%%EOF\n`, "latin1"));
  return Buffer.concat(chunks);
}
