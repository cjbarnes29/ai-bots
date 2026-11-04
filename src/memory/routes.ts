import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { MEMORY_LIMITS, MemoryService, noteSchema } from "./service.js";

const id = z.string().uuid();

/** All owner-only (a phone is refused): memory can hold private working notes. */
export async function registerMemoryRoutes(app: FastifyInstance, memory: MemoryService, botExists: (id: string) => boolean): Promise<void> {
  const mustBot = (raw: string) => {
    const b = id.parse(raw);
    if (!botExists(b)) throw new AppError(404, "not_found", "No such bot.");
    return b;
  };
  app.get("/api/memory", async (req) => {
    const q = z.strictObject({ scope: z.enum(["bot", "shared"]).default("shared"), botId: id.optional(), archived: z.enum(["0", "1"]).optional(), q: z.string().max(MEMORY_LIMITS.queryChars).optional() }).parse(req.query);
    if (q.scope === "bot" && !q.botId) throw new AppError(400, "bad_scope", "Choose a bot.");
    return { notes: memory.list({ scope: q.scope, ...(q.botId ? { botId: q.botId } : {}), archived: q.archived === "1", ...(q.q ? { q: q.q } : {}) }), limits: MEMORY_LIMITS };
  });
  app.post("/api/memory", async (req, reply) => {
    const body = z.looseObject({ scope: z.enum(["bot", "shared"]), botId: id.optional() }).parse(req.body);
    const { scope, botId, ...note } = body;
    if (scope === "bot") mustBot(botId ?? "");
    reply.code(201);
    return { note: memory.create(noteSchema.parse(note), scope, scope === "bot" ? botId! : null, "owner") };
  });
  app.get<{ Params: { id: string } }>("/api/memory/:id", async (req) => ({ note: memory.get(id.parse(req.params.id)) }));
  app.patch<{ Params: { id: string } }>("/api/memory/:id", async (req) => ({ note: memory.update(id.parse(req.params.id), req.body) }));
  app.post<{ Params: { id: string } }>("/api/memory/:id/archive", async (req) => ({ note: memory.setArchived(id.parse(req.params.id), true) }));
  app.post<{ Params: { id: string } }>("/api/memory/:id/unarchive", async (req) => ({ note: memory.setArchived(id.parse(req.params.id), false) }));
  app.post<{ Params: { id: string } }>("/api/memory/:id/share", async (req, reply) => {
    reply.code(201);
    return { note: memory.share(id.parse(req.params.id)) };
  });
  app.get<{ Params: { id: string } }>("/api/bots/:id/memory", async (req) => ({ settings: memory.settings(mustBot(req.params.id)) }));
  app.put<{ Params: { id: string } }>("/api/bots/:id/memory", async (req) => {
    const body = z.strictObject({ usePrivate: z.boolean().optional(), useShared: z.boolean().optional() }).parse(req.body);
    return { settings: memory.setSettings(mustBot(req.params.id), body) };
  });
}
