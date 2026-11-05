import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { InboxService } from "./service.js";

const uuid = z.string().uuid();
const id = (v: unknown) => {
  const p = uuid.safeParse(v);
  if (!p.success) throw new AppError(404, "conversation_not_found", "Conversation not found");
  return p.data;
};

/**
 * The owner's inbox. There is deliberately NO route that lets a bot (or anyone) post a message: bot messages are written only by code that
 * holds a real event (see service.postFromEvent). Changing the inbox (pin, mute, archive, hide, rename, read, preferences) is owner-only on a phone.
 */
export async function registerInboxRoutes(app: FastifyInstance, inbox: InboxService): Promise<void> {
  app.get("/api/inbox", async (req) => {
    const q = z.object({ view: z.enum(["all", "unread", "pinned", "archived"]).optional(), botId: z.string().max(80).optional(), q: z.string().max(100).optional() }).parse(req.query);
    return inbox.list({ ...(q.view ? { view: q.view } : {}), ...(q.botId ? { botId: q.botId } : {}), ...(q.q ? { q: q.q } : {}) });
  });
  app.get("/api/inbox/held-back", async () => ({ heldBack: inbox.heldBack() }));
  app.get<{ Params: { id: string } }>("/api/inbox/:id/messages", async (req) => inbox.messages(id(req.params.id)));

  const flag = z.strictObject({ on: z.boolean() });
  app.put<{ Params: { id: string } }>("/api/inbox/:id/pin", async (req) => (inbox.setPinned(id(req.params.id), flag.parse(req.body).on), { ok: true }));
  app.put<{ Params: { id: string } }>("/api/inbox/:id/mute", async (req) => (inbox.setMuted(id(req.params.id), flag.parse(req.body).on), { ok: true }));
  app.put<{ Params: { id: string } }>("/api/inbox/:id/archive", async (req) => (inbox.setArchived(id(req.params.id), flag.parse(req.body).on), { ok: true }));
  app.post<{ Params: { id: string } }>("/api/inbox/:id/hide", async (req) => (inbox.hide(id(req.params.id)), { ok: true }));
  app.post<{ Params: { id: string } }>("/api/inbox/:id/restore", async (req) => (inbox.restore(id(req.params.id)), { ok: true }));
  app.post<{ Params: { id: string } }>("/api/inbox/:id/read", async (req) => (inbox.markRead(id(req.params.id)), { ok: true }));
  app.put<{ Params: { id: string } }>("/api/inbox/:id/rename", async (req) => ({ title: inbox.rename(id(req.params.id), z.strictObject({ title: z.string() }).parse(req.body).title) }));

  const prefs = z.strictObject({ notify: z.enum(["all", "important", "none"]).optional(), maxPerHour: z.number().int().min(1).max(60).optional() });
  app.get("/api/inbox/preferences", async () => inbox.getPrefs(null));
  app.put("/api/inbox/preferences", async (req) => inbox.setPrefs(null, prefs.parse(req.body)));
  app.get<{ Params: { botId: string } }>("/api/inbox/preferences/:botId", async (req) => inbox.getPrefs(req.params.botId));
  app.put<{ Params: { botId: string } }>("/api/inbox/preferences/:botId", async (req) => inbox.setPrefs(req.params.botId, prefs.parse(req.body)));
}
