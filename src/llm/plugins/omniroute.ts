import type { ModelInfo, ProviderPlugin } from "../types.js";

/**
 * OmniRoute: a local AI gateway that offers many providers behind one OpenAI-compatible address.
 *
 * A gateway can route a request to a paid provider, so nothing it lists is assumed free. A model is allowed ONLY when
 *  1. the gateway itself lists a price of exactly 0 for input AND output (unknown or missing = blocked),
 *  2. it is one explicit model: names that mean auto-routing, combos, fallbacks or "best of" lists are refused, and
 *  3. the owner picked it by its exact id. The platform never sends fallback lists or routing options.
 * Usage limits, permissions and the approval system apply exactly as for any other provider. The key lives in the vault.
 */
const ROUTING_WORDS = /(^|[\/:_.\- ])(auto|combo|combos|fallback|fallbacks|router|route|smart|best|cheapest|fastest|random|round[-_]?robin|load[-_]?balanc(?:e|er|ing)|any)([\/:_.\- ]|$)/i;

/** True for ids that mean "let the gateway choose" rather than one specific model. */
export function isRoutingModelId(id: string): boolean {
  return ROUTING_WORDS.test(id) || id.includes(",") || id.includes("|") || /^omniroute\//i.test(id);
}

const NOT_TEXT = /embed|rerank|moderation|whisper|tts|speech|transcri|dall-?e|image|imagen|video|audio|ocr/i;

export function classifyOmniRouteModel(model: ModelInfo): { status: "verified_free" | "blocked"; source: string } {
  if (isRoutingModelId(model.id)) {
    return { status: "blocked", source: "Blocked: this is an auto-routing, combo or fallback name, not one explicit model" };
  }
  if ((model.ownedBy ?? "").toLowerCase() === "combo") {
    return { status: "blocked", source: "Blocked: OmniRoute says this is a combo (it can switch to other models)" };
  }
  const { priceInput, priceOutput } = model;
  if (priceInput === null || priceOutput === null) {
    return { status: "blocked", source: "Blocked: OmniRoute did not list a price for this model, so it cannot be verified as free" };
  }
  if (priceInput !== 0 || priceOutput !== 0) {
    return { status: "blocked", source: `Blocked: OmniRoute lists a price (input ${priceInput}, output ${priceOutput} per token), so it is not free` };
  }
  return {
    status: "verified_free",
    source: `OmniRoute lists price 0 for input and output${model.ownedBy ? ` (provider: ${model.ownedBy})` : ""}`,
  };
}

export const omniRoutePlugin: ProviderPlugin = {
  id: "omniroute",
  displayName: "OmniRoute (gateway)",
  // "cloud" on purpose: a gateway may reach the internet, so it needs a key, a daily cap and counts toward the overall cloud limits.
  kind: "cloud",
  connectable: true,
  defaultBaseUrl: "http://127.0.0.1:20128/v1",
  apiKeyEnv: "OMNIROUTE_API_KEY",
  freePolicy: "gateway_verified_zero_price",
  freePolicyLabel: "Only explicit models that OmniRoute itself lists at a price of exactly 0 (never auto, combos or fallbacks)",
  baseUrlEditable: true,
  defaultDailyRequestCap: 40,
  storeBlocked: true,
  normalizeModelId: (id) => id,
  isTextModel: (id) => !NOT_TEXT.test(id),
  classifyModel: classifyOmniRouteModel,
};
