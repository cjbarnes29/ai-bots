import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { AuditLog } from "../audit/audit.js";
import type { ActionGate } from "./service.js";

const idSchema = z.string().uuid();
const listQuery = z.strictObject({
  status: z.enum(["pending", "all"]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});
const denySchema = z.strictObject({ reason: z.string().max(300).optional() });
const pauseSchema = z.strictObject({ paused: z.boolean() });
const auditQuery = z.strictObject({ limit: z.coerce.number().int().min(1).max(500).default(100) });

function parseId(value: unknown): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new AppError(404, "approval_not_found", "Approval request not found");
  return parsed.data;
}

/**
 * Only the dashboard can approve or deny: a bot has no way to call these. Every change needs the client header,
 * which other websites cannot add.
 */
export async function registerApprovalRoutes(app: FastifyInstance, gate: ActionGate, audit: AuditLog): Promise<void> {
  app.get("/api/external/status", async () => gate.status());

  app.put("/api/external/pause", async (req) => {
    gate.setPaused(pauseSchema.parse(req.body).paused);
    return gate.status();
  });

  app.get("/api/approvals", async (req) => {
    const q = listQuery.parse(req.query);
    return { approvals: gate.list(q.status === "pending", q.limit) };
  });

  app.get<{ Params: { id: string } }>("/api/approvals/:id", async (req) => ({ approval: gate.get(parseId(req.params.id)) }));

  app.post<{ Params: { id: string } }>("/api/approvals/:id/approve", async (req) => ({ approval: await gate.approve(parseId(req.params.id)) }));

  app.post<{ Params: { id: string } }>("/api/approvals/:id/deny", async (req) => {
    const body = denySchema.parse(req.body ?? {});
    return { approval: gate.deny(parseId(req.params.id), body.reason ?? null) };
  });

  app.get("/api/audit", async (req) => ({ events: audit.list(auditQuery.parse(req.query).limit) }));
}
