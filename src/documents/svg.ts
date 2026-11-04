import { esc, type Chart, type DiagramSpec } from "./spec.js";

/** Charts and diagrams drawn as plain SVG (a picture any browser, Word or PowerPoint can show). No scripts, no outside links. */
const COLORS = ["#4f46e5", "#0ea5e9", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6"];

const niceMax = (v: number) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};
const num = (v: number) => (Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 1 }) : String(Math.round(v * 100) / 100));

export function chartSvg(chart: Chart, width = 640, height = 360): string {
  const W = width;
  const H = height;
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" font-family="Arial, Helvetica, sans-serif" font-size="12">`, `<rect width="${W}" height="${H}" fill="#ffffff"/>`];
  if (chart.title) out.push(`<text x="${W / 2}" y="22" text-anchor="middle" font-size="16" font-weight="bold" fill="#111827">${esc(chart.title)}</text>`);
  const top = chart.title ? 40 : 16;
  const legendH = chart.series.length > 1 || chart.kind === "pie" ? 24 : 0;

  if (chart.kind === "pie") {
    const values = chart.series[0]!.values.map((v) => Math.max(0, v));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    const cx = W * 0.33;
    const cy = top + (H - top - 10) / 2;
    const r = Math.min(cx - 20, (H - top - 20) / 2);
    let angle = -Math.PI / 2;
    values.forEach((v, i) => {
      const a = (v / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      angle += a;
      const x2 = cx + r * Math.cos(angle);
      const y2 = cy + r * Math.sin(angle);
      if (a > 0) out.push(a >= Math.PI * 2 - 1e-9 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${COLORS[i % COLORS.length]}"/>` : `<path d="M${cx},${cy} L${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${a > Math.PI ? 1 : 0} 1 ${x2.toFixed(1)},${y2.toFixed(1)} Z" fill="${COLORS[i % COLORS.length]}"/>`);
    });
    values.forEach((v, i) => {
      const y = top + 8 + i * 20;
      out.push(`<rect x="${W * 0.62}" y="${y - 10}" width="12" height="12" fill="${COLORS[i % COLORS.length]}"/>`, `<text x="${W * 0.62 + 18}" y="${y}" fill="#111827">${esc(chart.labels[i] ?? "")}: ${num(v)} (${Math.round((v / total) * 100)}%)</text>`);
    });
    out.push("</svg>");
    return out.join("");
  }

  const left = 56;
  const right = 16;
  const bottom = 40 + legendH;
  const plotW = W - left - right;
  const plotH = H - top - bottom;
  const all = chart.series.flatMap((s) => s.values);
  const max = niceMax(Math.max(0, ...all));
  const y = (v: number) => top + plotH - (Math.max(0, v) / max) * plotH;
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i;
    out.push(`<line x1="${left}" y1="${y(v).toFixed(1)}" x2="${W - right}" y2="${y(v).toFixed(1)}" stroke="#e5e7eb"/>`, `<text x="${left - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" fill="#374151">${num(v)}</text>`);
  }
  const n = chart.labels.length;
  const slot = plotW / n;
  chart.labels.forEach((l, i) => out.push(`<text x="${(left + slot * i + slot / 2).toFixed(1)}" y="${top + plotH + 16}" text-anchor="middle" fill="#374151">${esc(l.length > 14 ? `${l.slice(0, 13)}…` : l)}</text>`));

  if (chart.kind === "bar") {
    const group = slot * 0.7;
    const barW = group / chart.series.length;
    chart.series.forEach((s, si) =>
      s.values.slice(0, n).forEach((v, i) => {
        const x = left + slot * i + (slot - group) / 2 + barW * si;
        out.push(`<rect x="${x.toFixed(1)}" y="${y(v).toFixed(1)}" width="${(barW - 2).toFixed(1)}" height="${(top + plotH - y(v)).toFixed(1)}" fill="${COLORS[si % COLORS.length]}"><title>${esc(s.name)}, ${esc(chart.labels[i] ?? "")}: ${num(v)}</title></rect>`);
      }),
    );
  } else {
    chart.series.forEach((s, si) => {
      const pts = s.values.slice(0, n).map((v, i) => `${(left + slot * i + slot / 2).toFixed(1)},${y(v).toFixed(1)}`);
      out.push(`<polyline points="${pts.join(" ")}" fill="none" stroke="${COLORS[si % COLORS.length]}" stroke-width="2"/>`);
      s.values.slice(0, n).forEach((v, i) => out.push(`<circle cx="${(left + slot * i + slot / 2).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3" fill="${COLORS[si % COLORS.length]}"><title>${esc(s.name)}, ${esc(chart.labels[i] ?? "")}: ${num(v)}</title></circle>`));
    });
  }
  out.push(`<line x1="${left}" y1="${top + plotH}" x2="${W - right}" y2="${top + plotH}" stroke="#9ca3af"/>`);
  if (chart.series.length > 1) {
    chart.series.forEach((s, i) => out.push(`<rect x="${left + i * 130}" y="${H - 20}" width="12" height="12" fill="${COLORS[i % COLORS.length]}"/>`, `<text x="${left + i * 130 + 18}" y="${H - 10}" fill="#111827">${esc(s.name)}</text>`));
  }
  out.push("</svg>");
  return out.join("");
}

/** A left-to-right flow diagram: boxes in columns by how far they are from the start, arrows between them. */
export function diagramSvg(d: DiagramSpec): string {
  const ids = new Set(d.nodes.map((n) => n.id));
  const edges = d.edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const level = new Map<string, number>(d.nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < d.nodes.length; pass++) {
    let changed = false;
    for (const e of edges) {
      if (e.from === e.to) continue;
      const want = (level.get(e.from) ?? 0) + 1;
      if (want > (level.get(e.to) ?? 0) && want < d.nodes.length) {
        level.set(e.to, want);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const cols = new Map<number, string[]>();
  for (const n of d.nodes) cols.set(level.get(n.id) ?? 0, [...(cols.get(level.get(n.id) ?? 0) ?? []), n.id]);
  const boxW = 150;
  const boxH = 44;
  const gapX = 70;
  const gapY = 26;
  const maxCol = Math.max(...[...cols.keys()]);
  const maxRows = Math.max(...[...cols.values()].map((c) => c.length));
  const top = d.title ? 40 : 16;
  const W = 32 + (maxCol + 1) * boxW + maxCol * gapX;
  const H = top + maxRows * boxH + (maxRows - 1) * gapY + 16;
  const pos = new Map<string, { x: number; y: number }>();
  for (const [c, list] of cols) {
    const colH = list.length * boxH + (list.length - 1) * gapY;
    list.forEach((id, i) => pos.set(id, { x: 16 + c * (boxW + gapX), y: top + (maxRows * boxH + (maxRows - 1) * gapY - colH) / 2 + i * (boxH + gapY) }));
  }
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" font-family="Arial, Helvetica, sans-serif" font-size="12">`, `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#374151"/></marker></defs>`, `<rect width="${W}" height="${H}" fill="#ffffff"/>`];
  if (d.title) out.push(`<text x="${W / 2}" y="24" text-anchor="middle" font-size="16" font-weight="bold" fill="#111827">${esc(d.title)}</text>`);
  for (const e of edges) {
    const a = pos.get(e.from)!;
    const b = pos.get(e.to)!;
    const x1 = a.x + boxW;
    const y1 = a.y + boxH / 2;
    const x2 = b.x;
    const y2 = b.y + boxH / 2;
    const back = x2 <= x1;
    out.push(back ? `<path d="M${a.x + boxW / 2},${a.y + boxH} v14 H${b.x + boxW / 2} V${b.y + boxH}" fill="none" stroke="#374151" marker-end="url(#a)"/>` : `<path d="M${x1},${y1} C${x1 + gapX / 2},${y1} ${x2 - gapX / 2},${y2} ${x2},${y2}" fill="none" stroke="#374151" marker-end="url(#a)"/>`);
    if (e.label) out.push(`<text x="${(x1 + x2) / 2}" y="${(y1 + y2) / 2 - 6}" text-anchor="middle" fill="#4b5563">${esc(e.label)}</text>`);
  }
  for (const n of d.nodes) {
    const p = pos.get(n.id)!;
    out.push(`<rect x="${p.x}" y="${p.y}" width="${boxW}" height="${boxH}" rx="8" fill="#eef2ff" stroke="#4f46e5"/>`, `<text x="${p.x + boxW / 2}" y="${p.y + boxH / 2 + 4}" text-anchor="middle" fill="#111827">${esc(n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label)}</text>`);
  }
  out.push("</svg>");
  return out.join("");
}
