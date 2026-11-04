import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MANAGER_CEILINGS, managerSettingsPatch, type ManagerService } from "./service.js";

const startSchema = z.strictObject({
  goal: z.string().min(1).max(4000),
  budget: z
    .strictObject({
      maxModelCalls: z.number().int().min(1).max(MANAGER_CEILINGS.maxModelCalls).optional(),
      maxTokens: z.number().int().min(1000).max(MANAGER_CEILINGS.maxTokens).optional(),
      maxSteps: z.number().int().min(1).max(MANAGER_CEILINGS.maxSteps).optional(),
    })
    .optional(),
});

export async function registerManagerRoutes(app: FastifyInstance, manager: ManagerService): Promise<void> {
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
    reply.code(202);
    return { run: manager.start(body.goal, body.budget ?? {}, requestedBy) };
  });

  app.get<{ Params: { id: string } }>("/api/manager/runs/:id", async (req) => ({ run: manager.view(z.string().uuid().parse(req.params.id)) }));

  app.post<{ Params: { id: string } }>("/api/manager/runs/:id/cancel", async (req) => ({ run: manager.cancel(z.string().uuid().parse(req.params.id)) }));
}
