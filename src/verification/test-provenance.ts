/** Test-only source declarations, never a marker-based inference or production fallback. */
import { assessProvenance, manifestFor, renderResult, type ResultSegment } from "../delegation/result-provenance.js";
import type { TaskFact } from "./verify.js";
export function syntheticAuthorship(task: TaskFact, segments: ResultSegment[] = [{ origin: "agent", text: task.result ?? "" }]) {
  const rootId = task.id;
  return assessProvenance({ ...task, rootId }, 1, { taskId: task.id, rootId, detail: manifestFor(task.id, rootId, task.status === "failed" ? "failed" : "completed", renderResult(segments)) });
}
