import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuditLog } from "../audit/audit.js";
import type { AccessService } from "./service.js";

/**
 * Owner-only routes (see OWNER_ONLY_ROUTES in remote/access.ts, which also asks for the passphrase proof when a Guardian is running):
 * creating or changing an application approval or a folder approval, and the reset. Open to a paired phone: looking, previewing, scanning
 * (read-only) and every REVOKE, because taking access away is always safe.
 */
const actorOf = (req: { access?: { device?: { name: string } | null } }) => (req.access?.device ? `device:${req.access.device.name}` : "owner");

const grantBody = z.strictObject({
  subject: z.string().max(80).default("workforce"),
  path: z.string().min(1).max(400),
  ops: z.array(z.string().max(12)).min(1).max(5),
  inherit: z.boolean().optional(),
  expiresInMinutes: z.number().positive().max(525_600).nullable().optional(),
  acknowledgeSensitive: z.string().max(40).optional(),
  note: z.string().max(200).optional(),
});

export async function registerAccessRoutes(app: FastifyInstance, access: AccessService, audit: AuditLog): Promise<void> {
  app.get("/api/access/applications", async () => access.view());
  app.post("/api/access/applications/scan", async () => {
    try {
      await access.scan();
    } catch (e) {
      return { ...access.view(), scanError: e instanceof Error ? e.message : "The scan failed." };
    }
    return access.view();
  });
  app.put<{ Params: { id: string } }>("/api/access/applications/:id", async (req) => {
    const body = z.strictObject({ level: z.enum(["approved", "trusted"]), capabilities: z.array(z.string().max(12)).min(1).max(4), expiresInDays: z.number().positive().max(3650).nullable().optional(), reviewInDays: z.number().positive().max(365).nullable().optional(), note: z.string().max(200).optional() }).parse(req.body);
    return access.setApp(req.params.id, body, actorOf(req));
  });
  app.post<{ Params: { id: string } }>("/api/access/applications/:id/session", async (req) => {
    const body = z.strictObject({ capabilities: z.array(z.string().max(12)).min(1).max(4) }).parse(req.body);
    return access.approveAppForSession(req.params.id, body.capabilities, actorOf(req));
  });
  app.post<{ Params: { id: string } }>("/api/access/applications/:id/revoke", async (req) => {
    access.revokeApp(req.params.id, actorOf(req));
    return access.view();
  });
  app.post("/api/access/applications/revoke-all", async (req) => ({ revoked: access.apps.revokeAll(actorOf(req)) }));

  app.get("/api/access/folders", async () => ({ tampered: access.store.tampered(), generation: access.folders.generation(), grants: access.folders.list(), operations: ["read", "create", "edit", "rename", "delete"] }));
  app.post("/api/access/folders/preview", async (req) => access.folders.preview(grantBody.parse(req.body)));
  app.post("/api/access/folders", async (req) => access.folders.grant(grantBody.parse(req.body), actorOf(req)));
  app.patch<{ Params: { id: string } }>("/api/access/folders/:id", async (req) => {
    const body = z.strictObject({ ops: z.array(z.string().max(12)).min(1).max(5).optional(), inherit: z.boolean().optional(), expiresInMinutes: z.number().positive().max(525_600).nullable().optional() }).parse(req.body);
    return access.folders.change(req.params.id, body, actorOf(req));
  });
  app.post<{ Params: { id: string } }>("/api/access/folders/:id/revoke", async (req) => access.folders.revoke(req.params.id, actorOf(req)));
  app.post("/api/access/folders/revoke-all", async (req) => ({ revoked: access.folders.revokeAll(actorOf(req)) }));

  /** "Would this be allowed?" for a beginner who wants to test a rule. Denials are recorded like any other. */
  app.post("/api/access/check", async (req) => {
    const b = z.strictObject({ subject: z.string().max(80).default("workforce"), path: z.string().min(1).max(400), op: z.enum(["read", "create", "edit", "rename", "delete"]), isDirectory: z.boolean().optional() }).parse(req.body);
    const v = access.folders.authorize({ subject: b.subject, path: b.path, op: b.op, ...(b.isDirectory !== undefined ? { isDirectory: b.isDirectory } : {}) });
    return v.allowed ? { allowed: true } : { allowed: false, reason: v.reason };
  });

  app.get("/api/access/log", async () => ({ events: audit.listPrefix("access.", 200) }));
  app.post("/api/access/reset", async (req) => {
    access.reset(actorOf(req));
    return { ok: true };
  });
}
