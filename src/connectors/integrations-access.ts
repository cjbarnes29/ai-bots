import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AuditLog } from "../audit/audit.js";
import type { DatabaseSync } from "node:sqlite";
import { AppError } from "../errors.js";
import type { ConnectorRegistry } from "./types.js";

export const INTEGRATION_IDS = ["github", "notion", "n8n", "mcp", "gworkspace"] as const;
export type IntegrationId = (typeof INTEGRATION_IDS)[number];
export const isIntegration = (id: string): id is IntegrationId => (INTEGRATION_IDS as readonly string[]).includes(id);

/** Per-bot READ switches for the integrations. Off for every bot until the owner turns them on. */
export class IntegrationAccess {
  constructor(
    private readonly db: DatabaseSync,
    private readonly audit: AuditLog,
    private readonly now: () => number = Date.now,
  ) {}

  has(botId: string, connector: string): boolean {
    return this.db.prepare("SELECT 1 AS x FROM integration_access WHERE bot_id = ? AND connector = ?").get(botId, connector) !== undefined;
  }

  list(botId: string): IntegrationId[] {
    return this.db.prepare("SELECT connector FROM integration_access WHERE bot_id = ? ORDER BY connector").all(botId).map((r) => String(r["connector"]) as IntegrationId);
  }

  set(botId: string, connectors: IntegrationId[]): IntegrationId[] {
    const before = new Set(this.list(botId));
    const after = new Set(connectors);
    this.db.exec("BEGIN");
    try {
      for (const c of INTEGRATION_IDS) {
        if (after.has(c) && !before.has(c)) this.db.prepare("INSERT INTO integration_access (bot_id, connector, granted_at) VALUES (?, ?, ?)").run(botId, c, new Date(this.now()).toISOString());
        if (!after.has(c) && before.has(c)) this.db.prepare("DELETE FROM integration_access WHERE bot_id = ? AND connector = ?").run(botId, c);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    for (const c of INTEGRATION_IDS) if (before.has(c) !== after.has(c)) this.audit.record("integration.access_changed", { connector: c, enabled: after.has(c) }, { botId, actor: "owner" });
    return this.list(botId);
  }
}

export async function registerIntegrationRoutes(app: FastifyInstance, access: IntegrationAccess, registry: ConnectorRegistry, botExists: (id: string) => boolean): Promise<void> {
  const available = () => INTEGRATION_IDS.filter((id) => registry.get(id)).map((id) => ({ id, label: registry.get(id)!.label, actions: Object.entries(registry.get(id)!.actions).map(([name, a]) => ({ name, kind: a.kind })) }));
  app.get<{ Params: { id: string } }>("/api/bots/:id/integrations", async (req) => {
    const id = z.string().uuid().parse(req.params.id);
    if (!botExists(id)) throw new AppError(404, "not_found", "No such bot.");
    return { enabled: access.list(id), available: available() };
  });
  app.put<{ Params: { id: string } }>("/api/bots/:id/integrations", async (req) => {
    const id = z.string().uuid().parse(req.params.id);
    if (!botExists(id)) throw new AppError(404, "not_found", "No such bot.");
    const body = z.strictObject({ connectors: z.array(z.enum(INTEGRATION_IDS)).max(INTEGRATION_IDS.length) }).parse(req.body);
    return { enabled: access.set(id, body.connectors.filter((c) => registry.get(c))), available: available() };
  });
}
