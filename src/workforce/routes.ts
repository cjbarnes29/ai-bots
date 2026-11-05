import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { DIVISIONS } from "../groups/service.js";
import type { NodeKind, WorkforceService } from "./service.js";

const division = z.enum(DIVISIONS.map((d) => d.key) as [string, ...string[]]);
const NODE_KINDS = ["manager", "division", "group", "bot", "project", "task", "decision", "approval", "deliverable"] as const;

/**
 * The workforce organisation and the board. Reading is open. Placing a bot in a division is an owner act (owner-only on a phone, owner proof on this PC).
 * Saving a board layout is cosmetic (positions and filters only) and is open.
 */
export async function registerWorkforceRoutes(app: FastifyInstance, workforce: WorkforceService): Promise<void> {
  app.get("/api/workforce/organization", async () => workforce.overview());
  app.put<{ Params: { botId: string } }>("/api/workforce/bots/:botId", async (req) => {
    const b = z.strictObject({ kind: z.enum(["shared", "dedicated", "temporary"]), divisions: z.array(division).min(1).max(4), expiresInHours: z.number().int().optional(), purpose: z.string().max(200).optional() }).parse(req.body);
    return { placement: workforce.assign(req.params.botId, b as never) };
  });
  app.delete<{ Params: { botId: string } }>("/api/workforce/bots/:botId", async (req) => workforce.clear(req.params.botId));

  app.get("/api/workforce/board", async () => workforce.board());
  app.get("/api/workforce/activity", async (req) => {
    const q = z.object({ kind: z.enum(NODE_KINDS), id: z.string().min(1).max(120) }).parse(req.query);
    return workforce.activity(q.kind as NodeKind, q.id);
  });

  app.get("/api/workforce/layouts", async () => ({ layouts: workforce.layouts() }));
  app.put("/api/workforce/layouts", async (req) => {
    const b = z.strictObject({ name: z.string(), positions: z.record(z.string(), z.strictObject({ x: z.number(), y: z.number() })), filters: z.record(z.string(), z.unknown()).optional() }).parse(req.body);
    return { layout: workforce.saveLayout(b.name, b.positions, b.filters ?? {}) };
  });
  app.delete("/api/workforce/layouts", async (req) => {
    const name = z.object({ name: z.string().min(1).max(40) }).parse(req.query).name;
    workforce.deleteLayout(name);
    return { ok: true };
  });
  void AppError;
}
