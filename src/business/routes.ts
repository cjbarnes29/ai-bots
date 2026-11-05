import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { BUSINESS_LIMITS, type BusinessService } from "./service.js";
import { DISCOVERY_LIMITS } from "./discovery.js";
import { LEAD_STATUSES, rowsHash, type Lead } from "./leads.js";
import { CATEGORIES, MARKETS } from "./markets.js";
import { PRIORITY_RULE, RUBRIC, scoreLead } from "./scoring.js";
import { LEADS_FILE, STORE_LIMITS } from "./store.js";
import { AGENT_TEMPLATES } from "./team.js";
import { installTeam, teamStatus, type TeamDeps } from "./team-install.js";

/**
 * Dashboard routes for the Business Workforce. Reading is open to the dashboard (and a paired phone). Everything that changes
 * something (the outside-requests lock, a lead's status, creating the team) is owner-only on the PC: see src/remote/access.ts.
 */
const leadId = z.string().regex(/^L-[0-9a-f]{12}$/);
const batchId = z.string().regex(/^B-[0-9a-f]{8}$/);

/** A lead with the explanation of its score, so the screen can show every point. */
export function leadView(l: Lead) {
  const s = scoreLead(l);
  return { ...l, confidence: s.confidence, criteria: s.criteria };
}

/** The Business team: what would be installed (readable by anyone on the dashboard) and the owner-only install. */
export async function registerBusinessTeamRoutes(app: FastifyInstance, team: TeamDeps): Promise<void> {
  app.get("/api/business/team", async () => {
    const status = await teamStatus(team);
    return {
      ...status,
      agents: status.agents.map((a) => ({ ...a, instructions: AGENT_TEMPLATES.find((t) => t.key === a.key)!.instructions })),
    };
  });
  app.post("/api/business/team", async (req) => {
    z.strictObject({}).parse(req.body ?? {});
    return installTeam(team);
  });
}

export async function registerBusinessRoutes(app: FastifyInstance, svc: BusinessService): Promise<void> {
  const status = () => ({
    externalEnabled: svc.externalEnabled(),
    usage: svc.usage(),
    storage: { dir: svc.store.dir, file: LEADS_FILE, count: svc.store.count(), max: STORE_LIMITS.maxLeads },
    limits: { ...DISCOVERY_LIMITS, ...BUSINESS_LIMITS },
    markets: Object.values(MARKETS).map((m) => ({ code: m.code, name: m.name, regions: m.regions.map((r) => r.name), note: m.regulatoryNote, proposalLanguage: m.proposalLanguage })),
    categories: CATEGORIES.map((c) => ({ id: c.id, label: c.label })),
    statuses: [...LEAD_STATUSES],
    rubric: { rows: RUBRIC, priorityRule: PRIORITY_RULE },
  });

  app.get("/api/business/status", async () => status());

  // ---- which map service; its health; one status request. Choosing and checking are owner acts (owner-only on a phone, owner proof on this PC). ----
  app.get("/api/business/map", async () => svc.mapService());
  app.put("/api/business/map", async (req) => {
    const { endpoint } = z.strictObject({ endpoint: z.string().max(20) }).parse(req.body);
    try {
      svc.selectEndpoint(endpoint);
    } catch (e) {
      throw new AppError(400, "unknown_map_service", e instanceof Error ? e.message : "Unknown map service.");
    }
    return svc.mapService();
  });
  app.post("/api/business/map/status-check", async () => {
    try {
      return { health: await svc.mapStatusCheck(), map: svc.mapService() };
    } catch (e) {
      throw new AppError(409, "map_request_refused", e instanceof Error ? e.message : "The request was refused.");
    }
  });

  app.put("/api/business/external", async (req) => {
    // allowance: an exact number of outside requests approved for this session (counted down in the platform; memory only)
    const { enabled, allowance } = z.strictObject({ enabled: z.boolean(), allowance: z.strictObject({ map: z.number().int().min(0).max(1000).nullable().optional(), website: z.number().int().min(0).max(5000).nullable().optional() }).optional() }).parse(req.body);
    svc.setExternal(enabled);
    if (allowance) svc.setAllowance(allowance);
    return status();
  });

  app.get("/api/business/leads", async (req) => {
    const q = z
      .strictObject({
        status: z.enum(LEAD_STATUSES).optional(),
        priority: z.enum(["high", "medium", "low"]).optional(),
        q: z.string().max(80).optional(),
        limit: z.coerce.number().int().min(1).max(500).default(200),
      })
      .parse(req.query);
    const needle = (q.q ?? "").trim().toLowerCase();
    const all = svc.listLeads({ status: q.status, priority: q.priority }).filter((l) => (needle ? `${l.business_name} ${l.business_name_ar} ${l.city} ${l.category} ${l.phone}`.toLowerCase().includes(needle) : true));
    return { total: all.length, leads: all.slice(0, q.limit).map(leadView) };
  });

  app.put<{ Params: { id: string } }>("/api/business/leads/:id", async (req) => {
    const id = leadId.safeParse(req.params.id);
    if (!id.success) throw new AppError(404, "not_found", "No such lead.");
    const body = z.strictObject({ status: z.enum(LEAD_STATUSES).optional(), notes: z.string().max(1000).optional(), confirmNoWebsite: z.boolean().optional() }).parse(req.body);
    try {
      const lead = await svc.store.update(id.data, body);
      return { lead: leadView(lead) };
    } catch (e) {
      const message = e instanceof Error ? e.message : "That did not work.";
      throw new AppError(/No such lead/.test(message) ? 404 : 409, /No such lead/.test(message) ? "not_found" : "lead_change_refused", message);
    }
  });

  app.get("/api/business/batches", async () => ({
    batches: svc.staging.list().map((b) => ({
      id: b.id,
      label: b.label,
      createdAt: new Date(b.createdAt).toISOString(),
      count: b.rows.length,
      rowsHash: rowsHash(b.rows),
      states: b.rows.reduce<Record<string, number>>((acc, l) => ({ ...acc, [l.website_state]: (acc[l.website_state] ?? 0) + 1 }), {}),
    })),
  }));

  app.get<{ Params: { id: string } }>("/api/business/batches/:id", async (req) => {
    const id = batchId.safeParse(req.params.id);
    const b = id.success ? svc.staging.get(id.data) : undefined;
    if (!b) throw new AppError(404, "not_found", "That batch is not available any more.");
    return { id: b.id, label: b.label, rowsHash: rowsHash(b.rows), leads: [...b.rows].sort((x, y) => (y.lead_score ?? -1) - (x.lead_score ?? -1)).map(leadView) };
  });

  app.get("/api/business/leads.xlsx", async (_req, reply) => {
    const file = svc.store.exportXlsx();
    reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("content-disposition", 'attachment; filename="leads.xlsx"');
    return reply.send(file);
  });
}
