import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { WorkspaceService } from "./service.js";

const uuid = z.string().uuid();
const id = (v: unknown, code: string, msg: string) => {
  const p = uuid.safeParse(v);
  if (!p.success) throw new AppError(404, code, msg);
  return p.data;
};

/**
 * A project's shared workspace. Reading is open (like the project itself). Marking an entry as checked and withdrawing or restoring it are owner acts
 * (owner-only on a phone, see remote/access.ts). There is no route that writes an entry: only agents' finished tasks do, through the platform.
 */
export async function registerWorkspaceRoutes(app: FastifyInstance, ws: WorkspaceService): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/projects/:id/workspace", async (req) => ws.view(id(req.params.id, "project_not_found", "Project not found")));
  app.post<{ Params: { id: string; entryId: string } }>("/api/projects/:id/workspace/entries/:entryId/check", async (req) => ({
    entry: ws.check(id(req.params.id, "project_not_found", "Project not found"), id(req.params.entryId, "entry_not_found", "Entry not found")),
  }));
  app.put<{ Params: { id: string; entryId: string } }>("/api/projects/:id/workspace/entries/:entryId/withdrawn", async (req) => ({
    entry: ws.setWithdrawn(id(req.params.id, "project_not_found", "Project not found"), id(req.params.entryId, "entry_not_found", "Entry not found"), z.strictObject({ on: z.boolean() }).parse(req.body).on),
  }));
}
