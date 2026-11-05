/**
 * What each provider costs, what it can do and what happens to the data, as VERIFIED against the provider's own pages on the date below
 * (docs/SETTINGS-AUDIT.md has the sources and the parts that could NOT be verified). This is information for the Settings page only: it never
 * changes what the free-only gate allows. Update it together with the audit; a stale date is shown to the owner as stale.
 */
export type CostClass =
  | "permanently_free" //  1. no time limit and no usage limit
  | "free_with_limits" //  2. a free tier with request/token limits
  | "trial_credits" //     3. temporary trial or signup credit
  | "paid" //              4.
  | "local_free" //        5. runs on this PC, no API usage cost
  | "unverified"; //       6.

export const COST_CLASS_LABEL: Record<CostClass, string> = {
  permanently_free: "Permanently free",
  free_with_limits: "Free with usage limits",
  trial_credits: "Temporary trial or credits",
  paid: "Paid",
  local_free: "Local, no API usage cost",
  unverified: "Unknown or unverified",
};

export type Fit = "yes" | "partly" | "no" | "untested";

export interface ProviderProfile {
  costClass: CostClass;
  /** One plain sentence on the free offer. */
  freeSummary: string;
  /** Is a payment card needed to use the free tier? null = the provider's pages do not say. */
  cardRequired: boolean | null;
  /** The provider's stated limits, or what could not be verified. */
  limits: string;
  commercialUse: string;
  privacy: string;
  /** What the provider's models offer in general. */
  provider: { vision: Fit; toolCalling: Fit };
  /** What THIS app can use today. The app's model adapter sends text only: no images and no tools. */
  inThisApp: { vision: boolean; toolCalling: boolean };
  /** How well it could serve each part of operating desktop applications (a judgement, not a provider statement). */
  suitability: { planning: Fit; workerSteps: Fit; screenshots: Fit; visualNavigation: Fit; toolCalls: Fit; errorRecovery: Fit; multiStep: Fit };
  recommendation: string;
  verifiedOn: string;
  sources: string[];
}

export const PROFILE_DATE = "2026-11-04";

export const PROFILES: Record<string, ProviderProfile> = {
  gemini: {
    costClass: "free_with_limits",
    freeSummary: "Several Gemini models are free of charge (input and output) on the free tier, in Google AI Studio projects.",
    cardRequired: null,
    limits: "Per project, not per key: requests per minute, input tokens per minute and requests per day (reset at midnight Pacific). Google says the numbers are not guaranteed and shows your real ones in AI Studio. Not verified from outside the account.",
    commercialUse: "Not verified in this audit (read the Gemini API terms).",
    privacy: "On the free tier Google says content is used to improve its products. The paid tier says it is not. Do not send private screens or data on the free tier.",
    provider: { vision: "yes", toolCalling: "untested" },
    inThisApp: { vision: false, toolCalling: false },
    suitability: { planning: "yes", workerSteps: "yes", screenshots: "partly", visualNavigation: "untested", toolCalls: "untested", errorRecovery: "partly", multiStep: "partly" },
    recommendation: "Best free cloud candidate for planning and screenshot reading once the app can send images, but never with private content (free-tier data is used by Google). Needs an owner-created key with no billing (NV-3).",
    verifiedOn: PROFILE_DATE,
    sources: ["https://aistudio.google.com/docs/pricing", "https://aistudio.google.com/docs/rate-limits"],
  },
  groq: {
    costClass: "free_with_limits",
    freeSummary: "Groq's rate-limit page names a Free plan alongside the Developer plan; the free figures are only visible after signing in.",
    cardRequired: null,
    limits: "Per organisation. Free figures NOT verified (third-party sites quote about 30 requests/minute and 1,000/day for Llama-4-class models, and disagree on tokens).",
    commercialUse: "Not verified.",
    privacy: "Not verified (Groq's pricing page does not state retention or training terms).",
    provider: { vision: "untested", toolCalling: "untested" },
    inThisApp: { vision: false, toolCalling: false },
    suitability: { planning: "partly", workerSteps: "yes", screenshots: "untested", visualNavigation: "untested", toolCalls: "untested", errorRecovery: "partly", multiStep: "partly" },
    recommendation: "Fast text model for worker steps and planning. Its official model page does not show vision support, so do not count on it for screenshots. Confirm the free limits in the Groq console first.",
    verifiedOn: PROFILE_DATE,
    sources: ["https://console.groq.com/docs/rate-limits", "https://console.groq.com/docs/models"],
  },
  openrouter: {
    costClass: "free_with_limits",
    freeSummary: "Models whose id ends in :free cost nothing.",
    cardRequired: null,
    limits: "Free models: 20 requests/minute and 50 requests/day while fewer than 10 credits have ever been bought; buying 10 credits raises only the daily cap to 1,000 (a purchase: this app will never make it for you). A negative balance can block free models. Exceeding gives HTTP 429.",
    commercialUse: "Not verified.",
    privacy: "OpenRouter says it does not store prompts or responses unless you opt in. How each underlying free provider handles prompts is NOT stated on the page checked.",
    provider: { vision: "untested", toolCalling: "untested" },
    inThisApp: { vision: false, toolCalling: false },
    suitability: { planning: "partly", workerSteps: "partly", screenshots: "untested", visualNavigation: "no", toolCalls: "untested", errorRecovery: "no", multiStep: "no" },
    recommendation: "Useful as a text fallback. 50 requests a day is too few for step-by-step application work, so do not plan around it.",
    verifiedOn: PROFILE_DATE,
    sources: ["https://openrouter.ai/docs/api-reference/limits", "https://openrouter.ai/docs/guides/privacy/data-collection"],
  },
  ollama: {
    costClass: "local_free",
    freeSummary: "Running models on your own hardware is free and unlimited (Ollama's FAQ). Models whose name ends in cloud run on Ollama's servers and are billed per token, so this app blocks them.",
    cardRequired: false,
    limits: "Only this PC's speed and memory. This PC has no NVIDIA GPU and about 23.6 GB RAM (board T-8): a small vision model is the most it can run, and its speed and accuracy on screenshots are untested.",
    commercialUse: "Depends on each model's licence (not checked).",
    privacy: "Nothing leaves this PC for local models.",
    provider: { vision: "yes", toolCalling: "yes" },
    inThisApp: { vision: false, toolCalling: false },
    suitability: { planning: "partly", workerSteps: "partly", screenshots: "untested", visualNavigation: "untested", toolCalls: "untested", errorRecovery: "no", multiStep: "no" },
    recommendation: "The only option with no quota and full privacy, so private screens should only ever go here. Not installed yet (needs your approval). Test one small vision model before trusting it.",
    verifiedOn: PROFILE_DATE,
    sources: ["https://ollama.com/pricing", "https://ollama.com/search?c=vision"],
  },
  omniroute: {
    costClass: "unverified",
    freeSummary: "A gateway on this PC. Free only for models it lists at a price of exactly 0; its upstream providers set the real terms.",
    cardRequired: null,
    limits: "Whatever the upstream providers allow; the app adds its own daily cap.",
    commercialUse: "Depends on the upstream provider.",
    privacy: "Requests leave this PC for the upstream provider. Check which one.",
    provider: { vision: "untested", toolCalling: "untested" },
    inThisApp: { vision: false, toolCalling: false },
    suitability: { planning: "untested", workerSteps: "untested", screenshots: "untested", visualNavigation: "untested", toolCalls: "untested", errorRecovery: "untested", multiStep: "untested" },
    recommendation: "Not evaluated: it adds no capability of its own. Keep it as an optional text route.",
    verifiedOn: PROFILE_DATE,
    sources: [],
  },
  demo: {
    costClass: "local_free",
    freeSummary: "A built-in simulation inside this app. It costs nothing and uses no account, but it is NOT an AI: it only echoes what it was given, so you can try agents, workflows and routing.",
    cardRequired: false,
    limits: "None. It makes no network request.",
    commercialUse: "Not applicable (there is no model).",
    privacy: "Nothing leaves this PC.",
    provider: { vision: "no", toolCalling: "no" },
    inThisApp: { vision: false, toolCalling: false },
    suitability: { planning: "no", workerSteps: "no", screenshots: "no", visualNavigation: "no", toolCalls: "no", errorRecovery: "no", multiStep: "no" },
    recommendation: "For exploring the application only. Every reply is marked as simulated. Connect a real provider for real answers.",
    verifiedOn: PROFILE_DATE,
    sources: [],
  },
};

/** Settings key (existing llm_settings table) holding the providers the owner allowed for application automation. */
export const APP_AUTOMATION_KEY = "app_automation_providers";
