import { z } from "zod";

/**
 * The shapes a bot may ask a document, spreadsheet, presentation or chart to have. Everything is plain data with hard size limits:
 * no scripts, no formulas, no images from outside, no links that run anything. Text is escaped for each file format.
 */
export const LIMITS = { text: 4000, items: 40, rows: 5000, cols: 50, cell: 2000, blocks: 200, slides: 40, series: 6, points: 60, sheets: 10, nodes: 40, edges: 80, fileBytes: 5_000_000 };

const text = (max = LIMITS.text) => z.string().max(max);
const cell = z.union([z.string().max(LIMITS.cell), z.number().finite(), z.boolean(), z.null()]);

export const chartSchema = z.strictObject({
  kind: z.enum(["bar", "line", "pie"]),
  title: text(120).default(""),
  labels: z.array(text(60)).min(1).max(LIMITS.points),
  series: z
    .array(z.strictObject({ name: text(60), values: z.array(z.number().finite()).min(1).max(LIMITS.points) }))
    .min(1)
    .max(LIMITS.series),
});
export type Chart = z.infer<typeof chartSchema>;

export const blockSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("heading"), level: z.number().int().min(1).max(3).default(1), text: text(300) }),
  z.strictObject({ type: z.literal("paragraph"), text: text() }),
  z.strictObject({ type: z.literal("bullets"), items: z.array(text(500)).min(1).max(LIMITS.items) }),
  z.strictObject({ type: z.literal("numbered"), items: z.array(text(500)).min(1).max(LIMITS.items) }),
  z.strictObject({ type: z.literal("table"), header: z.array(text(200)).min(1).max(12), rows: z.array(z.array(cell).max(12)).max(200) }),
  z.strictObject({ type: z.literal("chart"), chart: chartSchema }),
  z.strictObject({ type: z.literal("pagebreak") }),
]);
export type Block = z.infer<typeof blockSchema>;

export const documentSchema = z.strictObject({ title: text(200).min(1), blocks: z.array(blockSchema).min(1).max(LIMITS.blocks) });
export type DocumentSpec = z.infer<typeof documentSchema>;

export const sheetSchema = z.strictObject({
  name: z.string().min(1).max(31).regex(/^[^[\]:*?/\\]+$/, "sheet names cannot contain [ ] : * ? / \\"),
  header: z.array(text(200)).max(LIMITS.cols).default([]),
  rows: z.array(z.array(cell).max(LIMITS.cols)).max(LIMITS.rows),
});
export type SheetSpec = z.infer<typeof sheetSchema>;

export const slideSchema = z.strictObject({
  title: text(200).min(1),
  bullets: z.array(text(300)).max(12).default([]),
  notes: text(1000).optional(),
  chart: chartSchema.optional(),
});
export const presentationSchema = z.strictObject({ title: text(200).min(1), slides: z.array(slideSchema).min(1).max(LIMITS.slides) });
export type PresentationSpec = z.infer<typeof presentationSchema>;

export const diagramSchema = z.strictObject({
  title: text(120).default(""),
  nodes: z.array(z.strictObject({ id: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/), label: text(60) })).min(1).max(LIMITS.nodes),
  edges: z.array(z.strictObject({ from: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/), to: z.string().regex(/^[A-Za-z0-9_-]{1,20}$/), label: text(40).optional() })).max(LIMITS.edges),
});
export type DiagramSpec = z.infer<typeof diagramSchema>;

/** XML/HTML escaping that also removes characters XML cannot hold. */
export function esc(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** A cell that a spreadsheet program could read as a formula or command is made harmless by a leading apostrophe. */
export function neutralize(value: string | number | boolean | null): string {
  const s = value === null ? "" : String(value);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
