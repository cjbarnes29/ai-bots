import { z } from "zod";
import type { LlmRepository } from "../llm/repository.js";

/**
 * Universal model routing (Stage 1). A bot whose model is "auto/<class>" does not have one fixed model: for each call the router picks the
 * best eligible FREE model for that kind of task, and moves on to the next one if a provider is down, rate-limited or out of quota.
 *
 * The router can only ever choose from models that already pass the free-only policy (verified free, enabled, available, provider switched
 * on and with a key). It never sends a call that the normal limits would refuse, never retries the same model after it failed, never rotates
 * accounts, and never picks a paid model. Every attempt is a normal call through LlmService, so every limit and every record still applies.
 */
export const ROUTE_CLASSES = ["general", "coding", "research", "light"] as const;
export type RouteClass = (typeof ROUTE_CLASSES)[number];

export const AUTO_PREFIX = "auto/";

export const CLASS_LABELS: Record<RouteClass, string> = {
  general: "General tasks",
  coding: "Coding",
  research: "Research and reasoning",
  light: "Quick, lightweight tasks",
};

export function parseAutoRef(ref: string | null | undefined): RouteClass | null {
  if (!ref || !ref.startsWith(AUTO_PREFIX)) return null;
  const cls = ref.slice(AUTO_PREFIX.length);
  return (ROUTE_CLASSES as readonly string[]).includes(cls) ? (cls as RouteClass) : null;
}

export const autoRef = (cls: RouteClass) => `${AUTO_PREFIX}${cls}`;

export const routingConfigSchema = z.strictObject({
  /** Master switch. Off = "auto/..." bots cannot run until it is switched on again. */
  enabled: z.boolean(),
  /** Give bots that have no model "auto/general" when they are created. */
  autoAssignNewBots: z.boolean(),
  /** Switch on newly discovered models that are verified free (never owner-confirmed gateway models). */
  autoEnableEligible: z.boolean(),
  /** Providers tried first-to-last when models score equally. */
  providerOrder: z.array(z.string().max(40)).max(10),
  /** Empty = every provider that is switched on. */
  allowedProviders: z.array(z.string().max(40)).max(10),
  /** Models never chosen automatically ("provider/model"). */
  excludedModels: z.array(z.string().max(200)).max(100),
  /**
   * Share work: among models that score equally (for example two verified models on different providers), take turns instead of always starting with the first
   * provider. Spreads independent tasks over the combined free allowance. Off by default so the order never changes without the owner's say-so.
   */
  spreadLoad: z.boolean(),
  /** Try local Ollama models first (default: only as a backup). */
  preferLocal: z.boolean(),
  /** How many different models one call may try. */
  maxAttempts: z.number().int().min(1).max(5),
  /** Ask the providers for their model lists again every this many hours (0 = never by itself). */
  autoRefreshHours: z.number().int().min(0).max(168),
  /**
   * The owner's first choice per kind of task ("provider/model"). It is tried first while it is eligible (free, switched on, provider on and
   * healthy); if it fails or is not eligible, routing falls back to the next best free models as usual. Never a way to allow a paid model.
   */
  preferred: z.strictObject({
    general: z.string().max(200).optional(),
    coding: z.string().max(200).optional(),
    research: z.string().max(200).optional(),
    light: z.string().max(200).optional(),
  }),
  /** The model a new bot gets ("provider/model" or "auto/<kind>"). null = "auto/general" when automatic assignment is on. */
  defaultModel: z.string().max(200).nullable(),
});

export type RoutingConfig = z.infer<typeof routingConfigSchema>;

export const DEFAULT_ROUTING: RoutingConfig = {
  enabled: true,
  autoAssignNewBots: true,
  autoEnableEligible: true,
  providerOrder: ["gemini", "groq", "openrouter", "omniroute", "ollama"],
  allowedProviders: [],
  excludedModels: [],
  spreadLoad: false,
  preferLocal: false,
  maxAttempts: 3,
  autoRefreshHours: 24,
  preferred: {},
  defaultModel: null,
};

export const routingPatchSchema = routingConfigSchema.partial();
const KEY = "routing";

export function loadRouting(repo: LlmRepository): RoutingConfig {
  const raw = repo.getSetting(KEY);
  if (!raw) return { ...DEFAULT_ROUTING };
  try {
    return { ...DEFAULT_ROUTING, ...routingPatchSchema.parse(JSON.parse(raw)) };
  } catch {
    return { ...DEFAULT_ROUTING }; // a damaged setting falls back to the defaults
  }
}

export function saveRouting(repo: LlmRepository, patch: Partial<RoutingConfig>, now: string): RoutingConfig {
  const next = { ...loadRouting(repo), ...routingPatchSchema.parse(patch) };
  repo.setSetting(KEY, JSON.stringify(next), now);
  return next;
}
