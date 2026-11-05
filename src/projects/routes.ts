import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { ProjectService } from "./service.js";

const uuid = z.string().uuid();
const pid = (v: unknown) => {
  const p = uuid.safeParse(v);
  if (!p.success) throw new AppError(404, "project_not_found", "Project not found");
  return p.data;
};

/** Projects. Reading is open; creating, editing, archiving, deleting and linking are owner-only on a phone (see remote/access.ts). */
export async function registerProjectRoutes(app: FastifyInstance, projects: ProjectService): Promise<void> {
  app.get("/api/projects", async (req) => {
    const q = z.object({ archived: z.enum(["0", "1", "true", "false"]).optional(), q: z.string().max(100).optional() }).parse(req.query);
    return { projects: projects.list({ archived: q.archived === "1" || q.archived === "true", ...(q.q ? { q: q.q } : {}) }) };
  });
  app.post("/api/projects", async (req, reply) => {
    const body = z.strictObject({ name: z.string(), description: z.string().optional(), instructions: z.string().optional() }).parse(req.body);
    reply.code(201);
    return { project: projects.create(body) };
  });
  app.get<{ Params: { id: string } }>("/api/projects/:id", async (req) => ({ project: projects.get(pid(req.params.id)), items: projects.items(pid(req.params.id)) }));
  app.patch<{ Params: { id: string } }>("/api/projects/:id", async (req) => ({
    project: projects.update(pid(req.params.id), z.strictObject({ name: z.string().optional(), description: z.string().optional(), instructions: z.string().optional() }).parse(req.body)),
  }));
  app.put<{ Params: { id: string } }>("/api/projects/:id/archive", async (req) => ({ project: projects.setArchived(pid(req.params.id), z.strictObject({ on: z.boolean() }).parse(req.body).on) }));
  app.delete<{ Params: { id: string } }>("/api/projects/:id", async (req) => (projects.remove(pid(req.params.id), z.strictObject({ confirmName: z.string() }).parse(req.body).confirmName), { ok: true }));

  const item = z.strictObject({ kind: z.string().max(20), id: z.string().min(1).max(80) });
  app.post<{ Params: { id: string } }>("/api/projects/:id/items", async (req, reply) => {
    const b = item.parse(req.body);
    reply.code(201);
    return { item: projects.link(pid(req.params.id), b.kind, b.id) };
  });
  app.delete<{ Params: { id: string } }>("/api/projects/:id/items", async (req) => {
    const b = item.parse(req.body);
    projects.unlink(pid(req.params.id), b.kind, b.id);
    return { ok: true };
  });
  app.put<{ Params: { id: string } }>("/api/projects/:id/items/pin", async (req) => {
    const b = item.extend({ on: z.boolean() }).parse(req.body);
    projects.setPinned(pid(req.params.id), b.kind, b.id, b.on);
    return { ok: true };
  });
}
