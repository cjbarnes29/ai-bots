import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { TaskEngine } from "./engine.js";
import { delegationLimitsUpdateSchema } from "./limits.js";
import type { DelegationService } from "./service.js";

const idSchema = z.string().uuid();
const submitSchema = z.strictObject({ instruction: z.string() });
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
    const task = service.submit(parseId(req.params.id, "bot_not_found", "Bot not found"), body.instruction);
    return reply.code(202).send({ task });
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
