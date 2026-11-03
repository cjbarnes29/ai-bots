import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { INBOUND_LIMITS, type InboundService } from "./service.js";

const eventName = z.string().trim().regex(/^[A-Za-z0-9_.-]{1,40}$/, "use letters, numbers, dots, dashes or underscores");
const createSchema = z.strictObject({
  connector: z.enum(["telegram", "gmail"]),
  botId: z.string().uuid(),
  eventName: eventName.optional(),
  intervalMinutes: z.number().int().min(INBOUND_LIMITS.minIntervalMinutes).max(1440).optional(),
});
const patchSchema = z.strictObject({
  enabled: z.boolean().optional(),
  eventName: eventName.optional(),
  intervalMinutes: z.number().int().min(INBOUND_LIMITS.minIntervalMinutes).max(1440).optional(),
});

/** Only the owner on the PC may change these (see src/remote/access.ts). */
export async function registerInboundRoutes(app: FastifyInstance, service: InboundService): Promise<void> {
  app.get("/api/inbound", async () => ({ sources: service.list(), limits: INBOUND_LIMITS }));

  app.post("/api/inbound", async (req, reply) => {
    reply.code(201);
    return { source: service.create(createSchema.parse(req.body)) };
  });

  app.patch<{ Params: { id: string } }>("/api/inbound/:id", async (req) => {
    return { source: service.update(z.string().uuid().parse(req.params.id), patchSchema.parse(req.body)) };
  });

  app.delete<{ Params: { id: string } }>("/api/inbound/:id", async (req) => {
    service.remove(z.string().uuid().parse(req.params.id));
    return { ok: true };
  });
}
