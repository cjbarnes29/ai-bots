import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { PushService } from "./push.js";

const subscribeSchema = z.strictObject({ endpoint: z.string().url().max(600) });

/** Any signed-in device (or the PC) may switch alerts on or off FOR ITSELF. Nothing here reveals content. */
export async function registerPushRoutes(app: FastifyInstance, push: PushService): Promise<void> {
  app.get("/api/push/key", async () => ({ publicKey: push.publicKey() }));

  app.post("/api/push/subscribe", async (req) => {
    const body = subscribeSchema.parse(req.body);
    push.subscribe(body.endpoint, req.access.device?.id ?? null);
    return { ok: true };
  });

  app.post("/api/push/unsubscribe", async (req) => {
    push.unsubscribe(subscribeSchema.parse(req.body).endpoint);
    return { ok: true };
  });
}
