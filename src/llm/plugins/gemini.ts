import type { ProviderPlugin } from "../types.js";

/** Google Gemini through its OpenAI-compatible endpoint. Free only on a project with no billing. */
export const geminiPlugin: ProviderPlugin = {
  id: "gemini",
  displayName: "Google Gemini",
  kind: "cloud",
  connectable: true,
  defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  apiKeyEnv: "GEMINI_API_KEY",
  freePolicy: "account_billing_confirmation",
  freePolicyLabel: "Free tier: free only while your Google project has no billing account",
  baseUrlEditable: false,
  // The OpenAI-compatible listing has only ids; this one says which operations (generateContent, embedContent, predict, bidiGenerateContent...) each model supports.
  nativeModels: { path: "models?pageSize=1000", header: "x-goog-api-key" },
  defaultDailyRequestCap: 50,
  normalizeModelId: (id) => id.replace(/^models\//, ""),
  isTextModel: (id) => /^gemini|^gemma/i.test(id) && !/embed|imagen|veo|tts|aqa|image|banana|lyria|live|audio|transcri|speech|robotics|computer[-_ ]?use/i.test(id),
  classifyModel: () => ({
    status: "free_tier",
    source: "Gemini free tier. Free only if no billing account is linked to the key's Google project (you confirm this).",
  }),
};
