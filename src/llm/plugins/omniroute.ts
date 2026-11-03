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

/** Fields that describe a price but are not an amount (currency name, unit, link...). Ignored. */
const PRICE_METADATA = /(^|[_.-])(currency|unit|units|per|source|updated|updated_at|type|tier|note|notes|description|url|link|id)$/i;
const NOT_INPUT_OR_OUTPUT = /cache|audio|image|video|modalit|reasoning|search/;

const snake = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
const isInputKey = (k: string) => /(^|[_.-])(prompt|input)([_.-]|$)/.test(k) && !NOT_INPUT_OR_OUTPUT.test(k);
const isOutputKey = (k: string) => /(^|[_.-])(completion|output)([_.-]|$)/.test(k) && !NOT_INPUT_OR_OUTPUT.test(k);

/** A price as a number, or null when it is not clearly a number ("free", "varies", empty, an object, true...). */
function priceNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && /^\s*[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?\s*$/i.test(value)) return Number(value);
  return null;
}

/**
 * Checks EVERY price-like field OmniRoute listed for a model (the whole "pricing" object in any format, plus any top-level
 * field with cost/price in its name: prompt/completion, input/output, per token, per million, per request, images, cache, search...).
 * Verified zero needs: an input price and an output price both present and exactly 0, and every other price field also exactly 0.
 * Missing, unreadable, negative, non-zero or disagreeing fields all block. A word such as "free" is not a number and proves nothing.
 */
export function verifyZeroPricing(model: ModelInfo): { ok: true } | { ok: false; reason: string; missing?: true } {
  const fields: Record<string, unknown> =
    model.pricingFields ??
    Object.fromEntries(
      [
        ["pricing.prompt", model.priceInput],
        ["pricing.completion", model.priceOutput],
      ].filter(([, v]) => v !== null),
    );
  let input = false;
  let output = false;
  let sawZero = false;
  const nonZero: string[] = [];
  for (const [rawKey, value] of Object.entries(fields)) {
    const key = snake(rawKey.replace(/^pricing\./, ""));
    if (PRICE_METADATA.test(key)) continue;
    const n = priceNumber(value);
    if (n === null) return { ok: false, reason: `the price field "${rawKey}" is not a clear number` };
    if (n < 0) return { ok: false, reason: `the price field "${rawKey}" is negative` };
    if (n !== 0) {
      nonZero.push(rawKey);
      continue;
    }
    sawZero = true;
    if (isInputKey(key)) input = true;
    if (isOutputKey(key)) output = true;
  }
  if (nonZero.length > 0) {
    return { ok: false, reason: sawZero ? `its price fields disagree or are not all zero (${nonZero.join(", ")})` : `it has a price (${nonZero.join(", ")})` };
  }
  if (!input || !output) return { ok: false, reason: "it did not list both an input price and an output price", missing: true };
  return { ok: true };
}

export function classifyOmniRouteModel(model: ModelInfo): { status: "verified_free" | "blocked"; source: string; overridable?: boolean } {
  if (isRoutingModelId(model.id)) {
    return { status: "blocked", source: "Blocked: this is an auto-routing, combo or fallback name, not one explicit model" };
  }
  if ((model.ownedBy ?? "").toLowerCase() === "combo") {
    return { status: "blocked", source: "Blocked: OmniRoute says this is a combo (it can switch to other models)" };
  }
  const verdict = verifyZeroPricing(model);
  if (!verdict.ok) {
    // Only "no price listed at all" can be settled by the owner. A price, an unreadable price or a routing name never can.
    return { status: "blocked", source: `Blocked: OmniRoute pricing could not be verified as free: ${verdict.reason}`, overridable: verdict.missing === true };
  }
  return {
    status: "verified_free",
    source: `OmniRoute lists a price of exactly 0 in every price field, input and output included${model.ownedBy ? ` (provider: ${model.ownedBy})` : ""}`,
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
  verifyReturnedModel: true,
  ownerOverridable: true,
  normalizeModelId: (id) => id,
  isTextModel: (id) => !NOT_TEXT.test(id),
  classifyModel: classifyOmniRouteModel,
};
