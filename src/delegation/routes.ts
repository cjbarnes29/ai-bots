import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { CapabilityService } from "../capabilities/service.js";
import type { TaskEngine } from "./engine.js";
import { delegationLimitsUpdateSchema } from "./limits.js";
import type { DelegationService } from "./service.js";

const idSchema = z.string().uuid();
const submitSchema = z.strictObject({ instruction: z.string(), projectId: z.string().uuid().optional(), saveToWorkspace: z.boolean().optional(), proceedAnyway: z.boolean().optional() });
const teamSchema = z.strictObject({ targetBotIds: z.array(z.string().uuid()).max(100) });

function parseId(value: unknown, code: string, message: string): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new AppError(404, code, message);
  return parsed.data;
}

export async function registerDelegationRoutes(
  app: FastifyInstance,
  service: DelegationService,
  engine: TaskEngine,
  capabilities?: CapabilityService,
  audit?: { record(kind: string, detail?: Record<string, unknown>, options?: { actor?: string }): void },
): Promise<void> {
  // ---- who a bot may hand work to (nobody, until you say so) ----
  app.get<{ Params: { id: string } }>("/api/bots/:id/delegation", async (req) => {
    return service.getTeam(parseId(req.params.id, "bot_not_found", "Bot not found"));
  });

  app.put<{ Params: { id: string } }>("/api/bots/:id/delegation", async (req) => {
    const body = teamSchema.parse(req.body);
    return service.setTeam(parseId(req.params.id, "bot_not_found", "Bot not found"), body.targetBotIds);
  });

  // ---- tasks ----
  app.post<{ Params: { id: string } }>("/api/bots/:id/tasks", async (req, reply) => {
    const body = submitSchema.parse(req.body);
    let assessment: Awaited<ReturnType<CapabilityService["assess"]>> | undefined;
    if (capabilities) {
      assessment = await capabilities.assess(body.instruction);
      audit?.record("capability.assessed", { classification: assessment.classification, blockers: assessment.blockers, goal: body.instruction.slice(0, 120), via: "delegation" }, { actor: "system" });
      const policyBlocked = assessment.requirements.filter((r) => r.status === "blocked_by_policy");
      if (assessment.classification === "unsupported" && policyBlocked.length > 0 && body.proceedAnyway !== true) {
        return reply.code(422).send({ error: "task_unsupported", message: `${assessment.summary} Send the request again with proceedAnyway if you want a best-effort attempt; approval and permission gates still apply.`, assessment });
      }
    }
    const task = service.submit(parseId(req.params.id, "bot_not_found", "Bot not found"), body.instruction, body.projectId, body.saveToWorkspace === undefined ? {} : { saveToWorkspace: body.saveToWorkspace });
    return reply.code(202).send({ task, ...(assessment ? { assessment } : {}) });
  });

  app.get("/api/tasks", async () => ({ tasks: service.listRoots() }));

  app.get<{ Params: { id: string } }>("/api/tasks/:id", async (req) => {
    return service.getTree(parseId(req.params.id, "task_not_found", "Task not found"));
  });

  app.post<{ Params: { id: string } }>("/api/tasks/:id/cancel", async (req) => {
    const task = service.cancel(parseId(req.params.id, "task_not_found", "Task not found"));
    return { task };
  });

  // ---- limits ----
  app.get("/api/delegation/limits", async () => service.limits());

  app.put("/api/delegation/limits", async (req) => {
    engine.updateLimits(delegationLimitsUpdateSchema.parse(req.body));
    return service.limits();
  });

  app.post("/api/delegation/limits/reset", async () => {
    engine.resetLimits();
    return service.limits();
  });
}
