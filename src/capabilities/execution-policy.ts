import { AppError } from "../errors.js";
import type { Assessment } from "./feasibility.js";
import type { CapabilityService } from "./service.js";

export type AssessmentKind = "task" | "manager";

/** Preserve the established route policies: ordinary task text keeps its best-effort fallback. */
export function assessmentBlocks(assessment: Assessment, kind: AssessmentKind): boolean {
  return assessment.classification === "unsupported" && assessment.requirements.some(r =>
    r.status === "blocked_by_policy" || (kind === "manager" && r.id !== "ai-models" && r.status === "missing"),
  );
}

/** Execution assessment uses the existing registry, never a model, and grants no permission. */
export async function assessExecution(
  capabilities: Pick<CapabilityService, "assess"> | undefined,
  audit: { record(kind: string, detail?: Record<string, unknown>, options?: { actor?: string }): void },
  input: { kind: AssessmentKind; id: string; goal: string; source: string; proceedAnyway: boolean },
): Promise<void> {
  if (!capabilities) throw new AppError(503, "capabilities_unavailable", "Capability assessment is not available yet. Nothing was sent to the model.");
  const assessment = await capabilities.assess(input.goal);
  const blocked = assessmentBlocks(assessment, input.kind);
  audit.record("capability.assessed", {
    classification: assessment.classification, blockers: assessment.blockers,
    goal: input.goal.slice(0, 120), via: input.kind, phase: "execution",
    source: input.source, ...(input.kind === "task" ? { taskId: input.id } : { runId: input.id }),
    proceedAnyway: input.proceedAnyway, refused: blocked && !input.proceedAnyway,
  }, { actor: "system" });
  if (blocked && !input.proceedAnyway) throw new AppError(422, "task_unsupported", `${assessment.summary} No model call was made for this request. Approval and permission gates still apply.`);
}
