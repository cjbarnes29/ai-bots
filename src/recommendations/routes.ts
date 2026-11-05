import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import { LEVELS, type RecommendationEngine } from "./engine.js";

export interface RecommendationRouteDeps {
  audit: { record(kind: string, detail?: Record<string, unknown>, options?: { actor?: string }): void };
  /** A few plain facts about this PC and the connections, shown at the top of the assistant. */
  environment(): Record<string, string | number | boolean>;
}

/**
 * Reading and choosing the mode are open (a phone may look; the mode only changes what is shown).
 * Applying and restoring change settings, so they are owner-only (see remote/access.ts) and every change is audited.
 */
export async function registerRecommendationRoutes(app: FastifyInstance, engine: RecommendationEngine, d: RecommendationRouteDeps): Promise<void> {
  const view = () => {
    const mode = engine.mode();
    const { items, hidden } = engine.list(mode);
    return { mode, modes: LEVELS, items, hidden, history: engine.history().slice(-30).reverse(), environment: d.environment() };
  };

  app.get("/api/recommendations", async () => view());

  app.put("/api/recommendations/mode", async (req) => {
    const body = z.strictObject({ mode: z.enum(LEVELS) }).parse(req.body);
    engine.setMode(body.mode);
    return view();
  });

  app.post("/api/recommendations/apply", async (req) => {
    const body = z.strictObject({ ids: z.array(z.string().max(80)).min(1).max(40) }).parse(req.body);
    const results = engine.apply(body.ids);
    for (const r of results) if (r.result === "applied") d.audit.record("recommendation.applied", { id: r.id, before: r.before, after: r.after }, { actor: "owner" });
    return { results, ...view() };
  });

  app.post("/api/recommendations/restore", async (req) => {
    const body = z.strictObject({ historyId: z.string().max(80) }).parse(req.body);
    const result = engine.restore(body.historyId);
    if (result.result === "applied") d.audit.record("recommendation.restored", { id: result.id, before: result.before, after: result.after }, { actor: "owner" });
    else if (result.reason === "That change is not in the history.") throw new AppError(404, "not_found", result.reason);
    return { results: [result], ...view() };
  });
}
