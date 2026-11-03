import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ModelCatalogService } from "./catalog.js";
import { limitsUpdateSchema } from "./limits.js";
import type { LlmService } from "./service.js";
import type { UsageRepository } from "./usage.js";

const providerPatchSchema = z.strictObject({
  enabled: z.boolean().optional(),
  freeConfirmed: z.boolean().optional(),
  dailyRequestCap: z.number().int().min(1).max(100_000).nullable().optional(),
  baseUrl: z.string().trim().min(1).max(200).optional(),
});

const modelPatchSchema = z.strictObject({ enabled: z.boolean() });
const ownerVerifySchema = z.strictObject({ verified: z.boolean(), iUnderstand: z.literal(true) });
const pauseSchema = z.strictObject({ paused: z.boolean() });
const usageQuerySchema = z.strictObject({
  days: z.coerce.number().int().min(1).max(90).default(14),
});
const modelsQuerySchema = z.strictObject({ providerId: z.string().max(40).optional() });

export interface LlmRoutesDeps {
  catalog: ModelCatalogService;
  llm: LlmService;
  usage: UsageRepository;
  now: () => number;
}

/**
 * Note what is NOT here: there is no endpoint or field that can turn off free-only mode
 * or raise the 4,096 output-token ceiling. Unknown fields are rejected.
 */
export async function registerLlmRoutes(app: FastifyInstance, deps: LlmRoutesDeps): Promise<void> {
  const { catalog, llm, usage, now } = deps;

  app.get("/api/llm/status", async () => llm.status());

  app.put("/api/llm/limits", async (req) => {
    llm.updateLimits(limitsUpdateSchema.parse(req.body));
    return llm.status();
  });

  app.post("/api/llm/limits/reset", async () => {
    llm.resetLimits();
    return llm.status();
  });

  app.put("/api/llm/pause", async (req) => {
    llm.setPaused(pauseSchema.parse(req.body).paused);
    return llm.status();
  });

  app.get("/api/llm/providers", async () => ({ providers: catalog.listProviders() }));

  app.patch<{ Params: { id: string } }>("/api/llm/providers/:id", async (req) => {
    return { provider: catalog.updateProvider(req.params.id, providerPatchSchema.parse(req.body)) };
  });

  app.post<{ Params: { id: string } }>("/api/llm/providers/:id/test", async (req) => {
    return { provider: await catalog.checkConnection(req.params.id) };
  });

  app.post<{ Params: { id: string } }>("/api/llm/providers/:id/refresh-models", async (req) => {
    return catalog.refreshModels(req.params.id);
  });

  app.get("/api/llm/models", async (req) => {
    const query = modelsQuerySchema.parse(req.query);
    return { models: catalog.listModels(query.providerId) };
  });

  app.patch<{ Params: { id: string } }>("/api/llm/models/:id", async (req) => {
    const id = Number(req.params.id);
    const body = modelPatchSchema.parse(req.body);
    return { model: catalog.setModelEnabled(Number.isInteger(id) ? id : -1, body.enabled) };
  });

  // You personally confirm that one OmniRoute model is free although it lists no price. Needs an explicit acknowledgement.
  app.put<{ Params: { id: string } }>("/api/llm/models/:id/owner-verified", async (req) => {
    const id = Number(req.params.id);
    const body = ownerVerifySchema.parse(req.body);
    return { model: catalog.setOwnerVerified(Number.isInteger(id) ? id : -1, body.verified) };
  });

  app.get("/api/llm/usage", async (req) => {
    const query = usageQuerySchema.parse(req.query);
    return { usage: usage.summary(now(), query.days) };
  });
}
