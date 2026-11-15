import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { VerificationService } from "./service.js";

const id = z.string().uuid();

/** Read-only. Asking for a verdict records at most one audit line; it never runs, approves or changes anything. */
export async function registerVerificationRoutes(app: FastifyInstance, svc: VerificationService): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/workflows/runs/:id/verification", async (req) => {
    const v = svc.verifyWorkflow(id.parse(req.params.id));
    if (!v) throw new AppError(404, "workflow_run_not_found", "That workflow run does not exist.");
    return { verification: v };
  });
  app.get<{ Params: { id: string } }>("/api/manager/runs/:id/verification", async (req) => {
    const v = svc.verifyManager(id.parse(req.params.id));
    if (!v) throw new AppError(404, "run_not_found", "That Manager run does not exist.");
    return { verification: v };
  });
  app.get<{ Params: { id: string } }>("/api/tasks/:id/verification", async (req) => {
    const v = svc.verifyTask(id.parse(req.params.id));
    if (!v) throw new AppError(404, "task_not_found", "Task not found");
    return { verification: v };
  });
  app.get<{ Params: { id: string } }>("/api/tasks/:id/chain-verification", async (req) => {
    const rootId = id.parse(req.params.id);
    const v = svc.verifyChain(rootId);
    if (!v) throw new AppError(404, "task_not_found", "Task not found");
    svc.record(rootId);
    return { verification: v };
  });
}
