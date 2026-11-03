import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  connectorParamSchema,
  createBotSchema,
  listBotsQuerySchema,
  setReadPermissionSchema,
  updateBotSchema,
} from "./schemas.js";
import type { AgentManagerService } from "./service.js";
import { AppError } from "./types.js";

const idSchema = z.string().uuid();
const versionSchema = z.coerce.number().int().min(1);

/** A malformed id can't match any bot, so it is reported as "not found". */
function parseId(value: unknown): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new AppError(404, "bot_not_found", "Bot not found");
  return parsed.data;
}

export async function registerAgentManagerRoutes(
  app: FastifyInstance,
  service: AgentManagerService,
): Promise<void> {
  type IdParams = { Params: { id: string } };

  // ---- Bots ----
  app.get("/api/bots", async (req) => {
    const query = listBotsQuerySchema.parse(req.query);
    return { bots: service.listBots(query.includeArchived) };
  });

  app.post("/api/bots", async (req, reply) => {
    const bot = service.createBot(createBotSchema.parse(req.body));
    return reply.code(201).send({ bot });
  });

  app.get<IdParams>("/api/bots/:id", async (req) => {
    return { bot: service.getBot(parseId(req.params.id)) };
  });

  app.patch<IdParams>("/api/bots/:id", async (req) => {
    const bot = service.updateBot(parseId(req.params.id), updateBotSchema.parse(req.body));
    return { bot };
  });

  // "Delete" means archive: nothing is ever destroyed.
  app.delete<IdParams>("/api/bots/:id", async (req) => {
    return { bot: service.archiveBot(parseId(req.params.id)) };
  });

  app.post<IdParams>("/api/bots/:id/unarchive", async (req) => {
    return { bot: service.unarchiveBot(parseId(req.params.id)) };
  });

  app.post<IdParams>("/api/bots/:id/duplicate", async (req, reply) => {
    const bot = service.duplicateBot(parseId(req.params.id));
    return reply.code(201).send({ bot });
  });

  // ---- Version history ----
  app.get<IdParams>("/api/bots/:id/versions", async (req) => {
    return { versions: service.listVersions(parseId(req.params.id)) };
  });

  app.get<{ Params: { id: string; version: string } }>(
    "/api/bots/:id/versions/:version",
    async (req) => {
      const version = versionSchema.safeParse(req.params.version);
      if (!version.success) throw new AppError(404, "version_not_found", "Version not found");
      return { version: service.getVersion(parseId(req.params.id), version.data) };
    },
  );

  app.post<{ Params: { id: string; version: string } }>(
    "/api/bots/:id/versions/:version/restore",
    async (req) => {
      const version = versionSchema.safeParse(req.params.version);
      if (!version.success) throw new AppError(404, "version_not_found", "Version not found");
      return { bot: service.restoreVersion(parseId(req.params.id), version.data) };
    },
  );

  // ---- Permissions (reading is OFF by default; writing always needs approval) ----
  app.get<IdParams>("/api/bots/:id/permissions", async (req) => {
    return { permissions: service.getPermissions(parseId(req.params.id)) };
  });

  app.put<{ Params: { id: string; connector: string } }>(
    "/api/bots/:id/permissions/:connector",
    async (req) => {
      const connector = connectorParamSchema.safeParse(req.params.connector);
      if (!connector.success) {
        throw new AppError(404, "connector_not_found", "Unknown connector");
      }
      const body = setReadPermissionSchema.parse(req.body);
      return {
        permissions: service.setReadPermission(
          parseId(req.params.id),
          connector.data,
          body.readEnabled,
        ),
      };
    },
  );

  app.get<IdParams>("/api/bots/:id/permissions/audit", async (req) => {
    return { audit: service.listAudit(parseId(req.params.id)) };
  });
}
