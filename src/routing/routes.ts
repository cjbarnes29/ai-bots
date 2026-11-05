import type { FastifyInstance } from "fastify";
import { AppError } from "../errors.js";
import type { ModelCatalogService } from "../llm/catalog.js";
import type { LlmRepository } from "../llm/repository.js";
import { CLASS_LABELS, ROUTE_CLASSES, loadRouting, routingPatchSchema, saveRouting } from "./config.js";
import type { ModelRouter } from "./router.js";

const LAST_REFRESH_KEY = "routing_last_refresh_ms";

/** Asks every provider that is switched on (and has its key, or is local) for its model list. Uses no tokens. A failing provider never stops the others. */
export async function refreshAllProviders(catalog: ModelCatalogService): Promise<{ id: string; ok: boolean; message: string; models: number }[]> {
  const out: { id: string; ok: boolean; message: string; models: number }[] = [];
  for (const p of catalog.listProviders()) {
    if (!p.connectable || !p.enabled || (p.kind === "cloud" && !p.keyConfigured)) continue;
    try {
      const r = await catalog.refreshModels(p.id);
      out.push({ id: p.id, ok: true, message: r.provider.statusMessage ?? "Refreshed.", models: r.models.length });
    } catch (e) {
      out.push({ id: p.id, ok: false, message: e instanceof Error ? e.message : "Refresh failed.", models: 0 });
    }
  }
  return out;
}

/** Keeps the model catalog fresh by itself (every N hours, set in Settings; 0 = never). Runs on the clock; failures never reach it. */
export class RoutingMaintenance {
  constructor(
    private readonly repo: LlmRepository,
    private readonly catalog: ModelCatalogService,
    private readonly now: () => number,
  ) {}

  async tick(): Promise<number> {
    try {
      const hours = loadRouting(this.repo).autoRefreshHours;
      if (hours <= 0) return 0;
      const last = Number(this.repo.getSetting(LAST_REFRESH_KEY) ?? 0);
      if (this.now() - last < hours * 3_600_000) return 0;
      this.repo.setSetting(LAST_REFRESH_KEY, String(this.now()), new Date(this.now()).toISOString());
      return (await refreshAllProviders(this.catalog)).filter((r) => r.ok).length;
    } catch {
      return 0;
    }
  }
}

export interface RoutingRoutesDeps {
  router: ModelRouter;
  catalog: ModelCatalogService;
  repo: LlmRepository;
  now: () => number;
  breakerWaitMs: (providerId: string) => number;
  /** Models resting after a free-tier rate limit, with the seconds left. */
  cooldowns: () => { ref: string; secondsLeft: number }[];
  /** Gives every bot that has no model "auto/general". Returns how many were changed. */
  assignUnassigned: () => number;
  audit: { record(kind: string, detail?: Record<string, unknown>, options?: { actor?: string }): void };
  /** Switches recorded in the audit log (they survive a restart). */
  switchLog?: (limit: number) => { createdAt: string; detail: Record<string, unknown> }[];
}

/** Everything here is under /api/llm/, so a phone cannot change it (see src/remote/access.ts). */
export async function registerRoutingRoutes(app: FastifyInstance, d: RoutingRoutesDeps): Promise<void> {
  const view = () => {
    const providers = d.catalog.listProviders();
    const models = d.catalog.listModels();
    return {
      config: d.router.config(),
      classes: ROUTE_CLASSES.map((id) => ({ id, label: CLASS_LABELS[id] })),
      preview: d.router.preview(),
      providers: providers.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        kind: p.kind,
        enabled: p.enabled,
        keyConfigured: p.keyConfigured,
        status: p.status,
        statusMessage: p.statusMessage,
        lastCheckedAt: p.lastCheckedAt,
        requestsToday: p.requestsToday,
        dailyRequestCap: p.dailyRequestCap,
        pausedForSeconds: Math.ceil(d.breakerWaitMs(p.id) / 1000),
        modelCount: p.modelCount,
        usableModels: models.filter((m) => m.providerId === p.id && m.callable).length,
      })),
      cooldowns: d.cooldowns(),
      lastRefreshAt: d.repo.getSetting(LAST_REFRESH_KEY) ? new Date(Number(d.repo.getSetting(LAST_REFRESH_KEY))).toISOString() : null,
    };
  };

  app.get("/api/llm/routing", async () => view());
  // Which model is answering now, and every recent switch (memory: the latest decisions; audit log: switches since the database began).
  app.get("/api/llm/routing/history", async () => {
    const recent = d.router.history();
    const current: Record<string, { ref: string; at: string }> = {};
    for (const r of recent) if (r.answeredBy && !current[r.class]) current[r.class] = { ref: r.answeredBy, at: r.at };
    return { current, recent, switches: d.switchLog?.(30) ?? [], note: "Recorded from real routing decisions only. Nothing here is estimated." };
  });

  app.put("/api/llm/routing", async (req) => {
    const patch = routingPatchSchema.parse(req.body);
    // A first choice per task must be one real, known, non-blocked model (never "auto/..."); the default for new bots may be either.
    for (const ref of Object.values(patch.preferred ?? {})) {
      if (ref === undefined) continue;
      if (ref.startsWith("auto/")) throw new AppError(400, "invalid_preferred", "Choose a specific model as the first choice for a kind of task.");
      d.catalog.validateModelRef(ref);
    }
    if (patch.defaultModel) d.catalog.validateModelRef(patch.defaultModel);
    saveRouting(d.repo, patch, new Date(d.now()).toISOString());
    d.audit.record("routing.changed", { fields: Object.keys(patch) }, { actor: "owner" });
    return view();
  });

  app.post("/api/llm/routing/refresh-all", async () => {
    const results = await refreshAllProviders(d.catalog);
    d.repo.setSetting(LAST_REFRESH_KEY, String(d.now()), new Date(d.now()).toISOString());
    return { results, ...view() };
  });

  app.post("/api/llm/routing/assign", async () => {
    const changed = d.assignUnassigned();
    d.audit.record("routing.assigned", { bots: changed }, { actor: "owner" });
    return { changed, ...view() };
  });
}
