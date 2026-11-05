import type { ProviderPlugin } from "../types.js";

/** Groq (fast hosted Llama and other open models). Free only on the free plan, with no payment method. */
export const groqPlugin: ProviderPlugin = {
  id: "groq",
  displayName: "Groq",
  kind: "cloud",
  connectable: true,
  defaultBaseUrl: "https://api.groq.com/openai/v1",
  apiKeyEnv: "GROQ_API_KEY",
  freePolicy: "account_billing_confirmation",
  freePolicyLabel: "Free plan: free only while your Groq account has no payment method",
  baseUrlEditable: false,
  defaultDailyRequestCap: 50,
  normalizeModelId: (id) => id,
  isTextModel: (id) => !/whisper|tts|orpheus|guard|embed|distil-whisper|transcri|speech/i.test(id),
  classifyModel: () => ({
    status: "free_tier",
    source: "Groq free plan. Free only if no payment method is added to the account (you confirm this).",
  }),
};
