import type { DatabaseSync } from "node:sqlite";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { searchAll } from "./search.js";
import type { HubService } from "./service.js";

const uuid = z.string().uuid();
const KINDS = z.enum(["conversation", "task", "approval", "decision", "workflow", "bot"]);

/** Read-only. These routes change nothing and grant nothing; they only say how things are connected. */
export async function registerHubRoutes(app: FastifyInstance, hub: HubService, db: DatabaseSync): Promise<void> {
  app.get<{ Params: { id: string } }>("/api/projects/:id/hub", async (req) => {
    const p = uuid.safeParse(req.params.id);
    if (!p.success) throw new AppError(404, "project_not_found", "Project not found");
    return hub.hub(p.data);
  });
  app.get<{ Params: { kind: string; id: string } }>("/api/related/:kind/:id", async (req) => {
    const kind = KINDS.safeParse(req.params.kind);
    if (!kind.success || req.params.id.length > 80) throw new AppError(404, "not_found", "That item does not exist.");
    return hub.related(kind.data, req.params.id);
  });
  app.get<{ Params: { id: string } }>("/api/bots/:id/projects", async (req) => ({ projects: hub.projectsOfBot(req.params.id.slice(0, 80)) }));
  /** Global search over names and titles. Read-only; never message text, note bodies, files or secrets. */
  app.get("/api/search", async (req) => searchAll(db, z.object({ q: z.string().max(200).default("") }).parse(req.query).q));
}
