import { z } from "zod";

/** The one limit nobody can raise: no bot may ask for a longer reply than this. */
export const MAX_OUTPUT_TOKENS_CEILING = 4096;

/** Default temperature for bots that do not set their own. */
export const DEFAULT_TEMPERATURE = 0.7;

/** The approved limits. Editable in the dashboard (within the bounds below). */
export const DEFAULT_LIMITS = {
  // Global limits: count cloud calls only (local models cost nothing)
  globalDailyRequests: 100,
  globalMonthlyRequests: 2000,
  globalDailyTokens: 200_000,
  globalMonthlyTokens: 2_000_000,
  // Per-bot limits: apply to every provider, including local ones
  botDailyRequests: 30,
  botMonthlyRequests: 600,
  botDailyTokens: 50_000,
  botMonthlyTokens: 500_000,
  botRequestsPerMinute: 6,
  // Per cloud provider
  providerRequestsPerMinute: 10,
  // Per request
  maxOutputTokensDefault: 1024,
  maxPromptTokens: 12_000,
  maxMessageChars: 8000,
  historyMessages: 20,
  // Concurrency
  maxConcurrentCloud: 2,
  maxConcurrentLocal: 1,
  // Reliability
  timeoutMs: 60_000,
  retries: 1,
  retryDelayMs: 2000,
  retryDelayMaxMs: 30_000,
  breakerFailures: 3,
  breakerOpenMs: 60_000,
} as const;

export type LimitsConfig = { [K in keyof typeof DEFAULT_LIMITS]: number };
export type LimitKey = keyof LimitsConfig;

const big = (min = 1) => z.number().int().min(min).max(10_000_000);

/** What may be edited, and the allowed range for each value. Unknown keys are rejected. */
export const limitsUpdateSchema = z.strictObject({
  globalDailyRequests: big(),
  globalMonthlyRequests: big(),
  globalDailyTokens: big(),
  globalMonthlyTokens: big(),
  botDailyRequests: big(),
  botMonthlyRequests: big(),
  botDailyTokens: big(),
  botMonthlyTokens: big(),
  botRequestsPerMinute: z.number().int().min(1).max(1000),
  providerRequestsPerMinute: z.number().int().min(1).max(1000),
  maxOutputTokensDefault: z.number().int().min(1).max(MAX_OUTPUT_TOKENS_CEILING),
  maxPromptTokens: z.number().int().min(100).max(1_000_000),
  maxMessageChars: z.number().int().min(1).max(100_000),
  historyMessages: z.number().int().min(0).max(200),
  maxConcurrentCloud: z.number().int().min(1).max(20),
  maxConcurrentLocal: z.number().int().min(1).max(20),
  timeoutMs: z.number().int().min(1000).max(600_000),
  retries: z.number().int().min(0).max(3),
  retryDelayMs: z.number().int().min(0).max(60_000),
  retryDelayMaxMs: z.number().int().min(0).max(120_000),
  breakerFailures: z.number().int().min(1).max(20),
  breakerOpenMs: z.number().int().min(1000).max(3_600_000),
}).partial();

export type LimitsUpdate = z.infer<typeof limitsUpdateSchema>;

export function mergeLimits(overrides: LimitsUpdate | null): LimitsConfig {
  return { ...DEFAULT_LIMITS, ...(overrides ?? {}) } as LimitsConfig;
}

/** Local calendar day and month (YYYY-MM-DD, YYYY-MM): limits reset at local midnight / the 1st. */
export function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export function localMonth(ms: number): string {
  return localDay(ms).slice(0, 7);
}
