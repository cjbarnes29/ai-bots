import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PcService } from "./service.js";

/**
 * Owner-only (a phone is refused): workspace folders, resuming after a stop, and each bot's PC permissions.
 * Allowed from a phone: looking, and the emergency stop / stopping a running program (stopping is always safe).
 */
export async function registerPcRoutes(app: FastifyInstance, pc: PcService): Promise<void> {
  app.get("/api/pc", async () => ({ ...pc.status(), executions: pc.executions(50), resources: await pc.resources() }));

  app.post("/api/pc/workspaces", async (req) => ({ roots: pc.addRoot(z.strictObject({ path: z.string().min(1).max(300) }).parse(req.body).path) }));
  app.post("/api/pc/workspaces/remove", async (req) => ({ roots: pc.removeRoot(z.strictObject({ path: z.string().min(1).max(300) }).parse(req.body).path) }));

  app.post("/api/pc/stop", async (req) => {
    const by = req.access?.device ? `device:${req.access.device.name}` : "owner";
    return { ended: pc.emergencyStop(by), ...pc.status() };
  });
  app.post("/api/pc/resume", async () => {
    pc.resume();
    return pc.status();
  });
  app.post<{ Params: { id: string } }>("/api/pc/servers/:id/stop", async (req) => ({ stopped: pc.stopServer(req.params.id) }));

  app.get<{ Params: { id: string } }>("/api/bots/:id/pc", async (req) => ({ grants: pc.grantsOf(z.string().uuid().parse(req.params.id)) }));
  app.put<{ Params: { id: string } }>("/api/bots/:id/pc", async (req) => {
    const body = z.strictObject({ grants: z.array(z.string().max(20)).max(5) }).parse(req.body);
    return { grants: pc.setGrants(z.string().uuid().parse(req.params.id), body.grants) };
  });
}
