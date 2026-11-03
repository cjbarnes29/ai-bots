export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

/**
 * What we send to a model. Deliberately has NO field for tools or functions:
 * in Phase 2 a bot can only produce text.
 */
export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface CompletionResult {
  text: string;
  /** Null when the provider did not report usage (we then estimate). */
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string | null;
  /** Cost the provider reported, in millionths of a dollar. Null when not reported. */
  costReportedMicro: number | null;
  /** True if the model asked to use a tool. We never run tools; the request is ignored. */
  toolCallsIgnored: boolean;
}

export interface ModelInfo {
  id: string;
  displayName: string;
  contextWindow: number | null;
  /** Dollars per token, when the provider publishes it. Null = unknown. */
  priceInput: number | null;
  priceOutput: number | null;
  /** Who the provider says owns the model (gateways such as OmniRoute: the upstream provider, or "combo"). Optional. */
  ownedBy?: string | null;
}

export interface LlmProvider {
  complete(request: CompletionRequest): Promise<CompletionResult>;
  listModels(timeoutMs: number): Promise<ModelInfo[]>;
}

export type FreeStatus = "verified_free" | "free_tier" | "blocked";
export type Availability = "available" | "not_installed" | "removed" | "unknown";
export type ProviderKind = "cloud" | "local";

/**
 * How we decide a provider's models are free:
 *  - price_zero_suffix: the live model list must show a price of exactly 0 (OpenRouter ":free").
 *  - account_billing_confirmation: free only while the account has no billing; the user confirms.
 *  - gateway_verified_zero_price: an AI gateway (OmniRoute). Never assumed free: the gateway must itself list a price of exactly 0 for
 *    input AND output, and the model must be one explicit model (no auto-routing, combos or fallbacks).
 *  - local: runs on this PC.
 */
export type FreePolicy = "price_zero_suffix" | "account_billing_confirmation" | "gateway_verified_zero_price" | "local";

/** Everything that is special about one provider. Adding a provider = adding one of these. */
export interface ProviderPlugin {
  id: string;
  displayName: string;
  kind: ProviderKind;
  /** False for providers that are defined but deliberately not connected (e.g. OmniRoute). */
  connectable: boolean;
  defaultBaseUrl: string;
  /** Name of the environment variable that holds the API key. Null = no key needed. */
  apiKeyEnv: string | null;
  freePolicy: FreePolicy;
  freePolicyLabel: string;
  baseUrlEditable: boolean;
  defaultDailyRequestCap: number | null;
  normalizeModelId(id: string): string;
  /** Filters out models that are not for text chat (embeddings, speech, images...). */
  isTextModel(id: string): boolean;
  classifyModel(model: ModelInfo): { status: FreeStatus; source: string };
  /** Keep blocked models in the catalog (greyed out, with the reason) instead of hiding them. For gateways, so the owner can see why. */
  storeBlocked?: boolean;
  /** Models we suggest even before they are installed (local provider). */
  suggestedModels?: { id: string; displayName: string }[];
}

export interface ModelRef {
  providerId: string;
  modelId: string;
}

/** "groq/llama-3.1-8b-instant" -> { providerId: "groq", modelId: "llama-3.1-8b-instant" } */
export function parseModelRef(ref: string): ModelRef | null {
  const slash = ref.indexOf("/");
  if (slash < 1 || slash === ref.length - 1) return null;
  return { providerId: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
}

export function formatModelRef(ref: ModelRef): string {
  return `${ref.providerId}/${ref.modelId}`;
}

/** A rough size estimate (about 4 characters per token). Used only when a provider omits usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: ChatMessage[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m.content) + 4, 0);
}
