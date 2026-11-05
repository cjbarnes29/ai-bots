import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "../errors.js";
import type { ModelCatalogService } from "./catalog.js";
import { evaluateModel, FULL_RUN } from "./evaluation.js";
import { KIND_LABEL } from "./model-kinds.js";
import { CORE_TESTS, TEST_LABEL, TEST_NAMES, type ModelRegistry } from "./registry.js";
import type { LlmService } from "./service.js";
import type { UsageRepository } from "./usage.js";
import { getPlugin } from "./plugins/index.js";

export interface RegistryRouteDeps {
  registry: ModelRegistry;
  catalog: ModelCatalogService;
  usage: UsageRepository;
  llm: LlmService;
  audit: { record(kind: string, detail?: Record<string, unknown>, options?: { actor?: string }): void };
}

/** "Please use models/gemini-3.8-flash" style hints in a provider's retirement message. */
const suggestionIn = (text: string): string | null => /(?:use|switch to|migrate to)\s+(?:the\s+)?(?:models\/)?([A-Za-z0-9][\w.:/-]{2,60})/i.exec(text)?.[1]?.replace(/[.,;:]+$/, "") ?? null;

/**
 * The model evaluation dashboard's data, and the only way to record a verification: a budget-limited evaluation run. Reading is open; running tests is owner-only
 * (see remote/access.ts) and every run states how many requests the owner approved. Nothing here changes a provider setting, a bot, a permission or the database schema.
 */
export async function registerRegistryRoutes(app: FastifyInstance, d: RegistryRouteDeps): Promise<void> {
  app.get("/api/llm/registry", async () => {
    const views = d.catalog.listModels();
    const inCatalog = new Map(views.map((v) => [v.ref, v]));
    const stats = d.usage.byModelStats();
    const entries = d.registry.entries();
    const refs = new Set<string>([...entries.map((e) => e.ref), ...views.map((v) => v.ref)]);
    const rows = [...refs].sort().map((ref) => {
      const view = inCatalog.get(ref);
      const slash = ref.indexOf("/");
      const providerId = ref.slice(0, slash);
      const modelId = ref.slice(slash + 1);
      const entry = d.registry.ensure(providerId, modelId);
      const ctx = { callable: view?.callable ?? false, blockedReason: view?.blockedReason ?? (view ? null : entry.chatCapable ? "Listed by the provider and able to generate text, but not added to the catalog: its name is not a recognised chat model of this provider. It needs a manual decision before it can be tested." : "Listed by the provider, but not a chat model, so it is not in the catalog."), availability: view?.availability ?? "unknown", contextWindow: view?.contextWindow ?? entry.native.contextWindow ?? null };
      const judged = d.registry.judge(entry, ctx);
      const retiredHint = entry.retired ? suggestionIn(entry.retired.reason) : null;
      return {
        ref,
        providerId,
        providerName: getPlugin(providerId)?.displayName ?? providerId,
        modelId,
        displayName: view?.displayName ?? modelId,
        kind: entry.kind,
        kindLabel: KIND_LABEL[entry.kind],
        chatCapable: entry.chatCapable,
        modalities: entry.modalities,
        basis: entry.basis,
        status: judged.status,
        reasons: judged.reasons,
        routable: view?.routable ?? false,
        inCatalog: !!view,
        enabled: view?.enabled ?? false,
        availability: ctx.availability,
        contextWindow: ctx.contextWindow,
        maxOutputTokens: entry.native.maxOutputTokens ?? null,
        providerOperations: entry.native.methods ?? null,
        tests: TEST_NAMES.map((t) => ({ test: t, label: TEST_LABEL[t], core: CORE_TESTS.includes(t), ...(d.registry.effectiveTest(entry, t) ?? (entry.tests[t] ? { result: "untested" as const, source: null, at: null, detail: "Outdated: the way this model is given its instructions changed since this result; run it again.", latencyMs: null } : { result: "untested" as const, source: null, at: null, detail: "Not tested yet", latencyMs: null })) })),
        missingTests: judged.missingTests,
        suitability: d.registry.suitability(entry, ctx),
        lastVerifiedAt: entry.lastVerifiedAt,
        retired: entry.retired,
        suggestedReplacement: retiredHint,
        limitations: entry.limitations,
        instructionRole: entry.instructionRole ?? null,
        failures: entry.failures,
        usage: stats.get(ref) ?? { requests: 0, ok: 0, errors: 0, avgLatencyMs: null, lastAt: null },
        cooldownSeconds: Math.ceil(d.llm.modelCooldownMs(ref) / 1000),
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
      };
    });
    const count = (s: string) => rows.filter((r) => r.chatCapable && r.status === s).length;
    return {
      enforced: d.registry.enforce,
      summary: { verified: count("verified"), unverified: count("unverified"), unavailable: rows.filter((r) => r.status === "unavailable").length, notChat: rows.filter((r) => !r.chatCapable).length },
      battery: { order: FULL_RUN, core: CORE_TESTS, requestsPerFullRun: FULL_RUN.length, labels: TEST_LABEL },
      models: rows,
    };
  });

  const runSchema = z.strictObject({
    ref: z.string().min(3).max(200),
    tests: z.array(z.enum(TEST_NAMES)).min(1).max(6),
    /** How many real requests the OWNER approved for this run. The run never exceeds it. */
    approvedRequests: z.number().int().min(1).max(20),
  });
  app.post("/api/llm/registry/evaluate", async (req) => {
    const body = runSchema.parse(req.body);
    const view = d.catalog.listModels().find((m) => m.ref === body.ref);
    if (!view) throw new AppError(404, "model_not_found", "That model is not in the catalog. Refresh the provider's models first.");
    const result = await evaluateModel({ llm: d.llm, registry: d.registry, isSimulated: (id) => getPlugin(id)?.simulated === true }, body.ref, body.tests, body.approvedRequests);
    d.audit.record("model.evaluated", { ref: body.ref, tests: body.tests, approvedRequests: body.approvedRequests, used: result.requestsUsed, status: result.status }, { actor: "owner" });
    return { result };
  });
}
