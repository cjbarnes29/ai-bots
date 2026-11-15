import { createHash } from "node:crypto";
import { z } from "zod";
import { MAX_RESULT_CHARS } from "./limits.js";

export type ResultOrigin = "agent" | "platform" | "untrusted";
export interface ResultSegment { origin: ResultOrigin; text: string }
export interface ResultRange { start: number; end: number; origin: ResultOrigin }
export interface RenderedResult { text: string; originalLength: number; agentTextComplete: boolean; ranges: ResultRange[] }
export const resultHash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const boundary = (text: string, i: number) => !(i > 0 && i < text.length && text.charCodeAt(i - 1) >= 0xd800 && text.charCodeAt(i - 1) <= 0xdbff && text.charCodeAt(i) >= 0xdc00 && text.charCodeAt(i) <= 0xdfff);

/** Source-labelled input only. A heading or JSON inside a segment never changes its origin. */
export function renderResult(segments: readonly ResultSegment[], notice = true): RenderedResult {
  let text = "";
  const ranges: ResultRange[] = [];
  for (const s of segments) {
    const part = Buffer.from(s.text, "utf8").toString("utf8"); // well-formed Unicode before offsets/hashing
    if (!part) continue;
    const start = text.length;
    text += part;
    const last = ranges.at(-1);
    if (last?.origin === s.origin) last.end = text.length;
    else ranges.push({ start, end: text.length, origin: s.origin });
  }
  const originalLength = text.length;
  let cut = Math.min(text.length, MAX_RESULT_CHARS);
  if (!boundary(text, cut)) cut--;
  const agentTextComplete = !ranges.some(r => r.origin === "agent" && r.end > cut);
  const kept = ranges.filter(r => r.start < cut).map(r => ({ ...r, end: Math.min(r.end, cut) }));
  text = text.slice(0, cut);
  if (originalLength > cut && notice) {
    const start = text.length;
    text += `\n\n[Cut: the answer was longer than ${MAX_RESULT_CHARS.toLocaleString()} characters.]`;
    if (kept.at(-1)?.origin === "platform") kept.at(-1)!.end = text.length;
    else kept.push({ start, end: text.length, origin: "platform" });
  }
  return { text, originalLength, agentTextComplete, ranges: kept };
}

const manifestSchema = z.strictObject({
  version: z.literal(1), unit: z.literal("utf16"), taskId: z.string(), rootId: z.string(), status: z.enum(["completed", "failed"]),
  resultLength: z.number().int().min(0).max(MAX_RESULT_CHARS + 512), resultSha256: z.string().regex(/^[a-f0-9]{64}$/), agentTextComplete: z.boolean(),
  ranges: z.array(z.strictObject({ start: z.number().int().min(0), end: z.number().int().min(1), origin: z.enum(["agent", "platform", "untrusted"]) })).max(64),
});
export interface ProvenanceTask { id: string; rootId: string; status: string; result: string | null }
export interface ProvenanceEvent { taskId: string; rootId: string; detail: string }
export type AuthorshipAssessment = { state: "unknown"; reason: string } | {
  state: "known"; taskId: string; resultSha256: string; ranges: ResultRange[]; agentTextComplete: boolean; hasUntrusted: boolean;
};

export function manifestFor(taskId: string, rootId: string, status: "completed" | "failed", r: RenderedResult): string {
  const detail = JSON.stringify({ version: 1, unit: "utf16", taskId, rootId, status, resultLength: r.text.length, resultSha256: resultHash(r.text), agentTextComplete: r.agentTextComplete, ranges: r.ranges });
  // Bounded unsupported record: retain the result without claiming safe attribution.
  return Buffer.byteLength(detail, "utf8") <= 16_384 && r.ranges.length <= 64 ? detail : JSON.stringify({ version: 0, reason: "range_limit", taskId, rootId, resultSha256: resultHash(r.text) });
}

/** Count and candidate must be loaded with the task in one SQL snapshot. No marker fallback or legacy backfill. */
export function assessProvenance(task: ProvenanceTask, count: unknown, event?: ProvenanceEvent): AuthorshipAssessment {
  const unknown = (reason: string): AuthorshipAssessment => ({ state: "unknown", reason });
  if (count !== 1 || !event) return unknown("A unique saved result-origin record is unavailable.");
  if (event.taskId !== task.id || event.rootId !== task.rootId || Buffer.byteLength(event.detail, "utf8") > 16_384 || task.result === null) return unknown("The saved result-origin binding is invalid.");
  try {
    const m = manifestSchema.parse(JSON.parse(event.detail));
    const text = task.result;
    if (m.taskId !== task.id || m.rootId !== task.rootId || m.status !== task.status || m.resultLength !== text.length || m.resultSha256 !== resultHash(text)) return unknown("The saved result and origin record do not match.");
    let end = 0;
    for (const r of m.ranges) {
      if (r.start !== end || r.end <= r.start || r.end > text.length || !boundary(text, r.start) || !boundary(text, r.end)) return unknown("The saved result-origin ranges are invalid.");
      end = r.end;
    }
    if (end !== text.length) return unknown("The saved result-origin ranges do not cover the result.");
    return { state: "known", taskId: task.id, resultSha256: m.resultSha256, ranges: m.ranges, agentTextComplete: m.agentTextComplete, hasUntrusted: m.ranges.some(r => r.origin === "untrusted") };
  } catch { return unknown("The saved result-origin record is malformed or unsupported."); }
}
