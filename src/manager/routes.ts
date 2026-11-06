import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { CapabilityService } from "../capabilities/service.js";
import { MANAGER_CEILINGS, managerSettingsPatch, type ManagerService } from "./service.js";

const startSchema = z.strictObject({
  goal: z.string().min(1).max(4000),
  /** The owner has read the feasibility answer and wants a best-effort plan anyway. It changes nothing about permissions: the Manager is still told what is missing and may only use what exists. */
  proceedAnyway: z.boolean().optional(),
  budget: z
    .strictObject({
      maxModelCalls: z.number().int().min(1).max(MANAGER_CEILINGS.maxModelCalls).optional(),
      maxTokens: z.number().int().min(1000).max(MANAGER_CEILINGS.maxTokens).optional(),
      maxSteps: z.number().int().min(1).max(MANAGER_CEILINGS.maxSteps).optional(),
    })
    .optional(),
});

export async function registerManagerRoutes(app: FastifyInstance, manager: ManagerService, capabilities?: CapabilityService, audit?: { record(kind: string, detail?: Record<string, unknown>, options?: { actor?: string }): void }): Promise<void> {
  app.get("/api/manager", async () => ({
    settings: manager.settings(),
    ceilings: MANAGER_CEILINGS,
    specialists: manager.specialists(),
    runs: manager.list(20),
  }));

  // Changing which bots the Manager may use, or its budgets, is an owner-only change (see src/remote/access.ts).
  app.put("/api/manager/settings", async (req) => ({ settings: manager.updateSettings(managerSettingsPatch.parse(req.body)) }));

  app.post("/api/manager/runs", async (req, reply) => {
    const body = startSchema.parse(req.body);
    const requestedBy = req.access?.device ? `device:${req.access.device.name}` : "owner";
    // Before accepting the task: can it be done at all? Only a task that is impossible as asked because something it needs is NOT BUILT / not installed / forbidden
    // is refused (with the reasons). A task that merely needs setup or is unproven is accepted, and the owner is told what is missing.
    let assessment: Awaited<ReturnType<CapabilityService["assess"]>> | undefined;
    if (capabilities) {
      assessment = await capabilities.assess(body.goal);
      audit?.record("capability.assessed", { classification: assessment.classification, blockers: assessment.blockers, goal: body.goal.slice(0, 120), via: "manager" }, { actor: "system" });
      const hard = assessment.requirements.filter((r) => r.id !== "ai-models" && (r.status === "missing" || r.status === "blocked_by_policy"));
      if (assessment.classification === "unsupported" && hard.length > 0 && body.proceedAnyway !== true) {
        return reply.code(422).send({ error: "task_unsupported", message: `${assessment.summary} Send the request again with proceedAnyway if you want a best-effort plan anyway.`, assessment });
      }
    }
    reply.code(202);
    return { run: manager.start(body.goal, body.budget ?? {}, requestedBy), ...(assessment ? { assessment } : {}) };
  });

  app.get<{ Params: { id: string } }>("/api/manager/runs/:id", async (req) => ({ run: manager.view(z.string().uuid().parse(req.params.id)) }));

  app.post<{ Params: { id: string } }>("/api/manager/runs/:id/cancel", async (req) => ({ run: manager.cancel(z.string().uuid().parse(req.params.id)) }));
}
