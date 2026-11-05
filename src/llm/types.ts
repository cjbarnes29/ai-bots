export type Role = "system" | "user" | "assistant";

/**
 * A picture (for example a screenshot of an application window). Pictures are OFF by default everywhere: a picture is sent only when ALL of these hold
 * (see image-policy.ts): the provider declares vision support, the request carries the explicit `imagesApproved` mark that only that policy sets, a
 * picture marked "private" goes only to a provider that runs on this PC, and a "public" picture goes to a cloud provider only if the owner switched
 * that on. Nothing in the platform creates a picture-carrying request yet.
 */
export interface ImagePart {
  mime: "image/png" | "image/jpeg";
  dataBase64: string;
  sensitivity: "private" | "public";
}

export interface ChatMessage {
  role: Role;
  content: string;
  /** Normally absent. Without the policy's approval the adapter refuses to send a message that carries pictures. */
  images?: ImagePart[];
}

/** A function a model may ask to have called. Never sent unless the provider declares tool support; calls are only ever REQUESTS, executed by our own checked code. */
export interface ToolSpec {
  name: string;
  description: string;
  /** JSON-schema object describing the arguments. */
  parameters: Record<string, unknown>;
}
export interface ToolCallRequest {
  name: string;
  /** The arguments exactly as the model wrote them (a JSON string). Must be validated before use. */
  arguments: string;
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
  /** Set only by image-policy.ts after it allowed the pictures in these messages. */
  imagesApproved?: boolean;
  tools?: ToolSpec[];
  /**
   * How to give the model its instructions. "native" = a real system message (never folded, and a refusal is reported, not hidden); "folded" = inside the first user turn.
   * Absent = decide by the model's name and learn from a refusal. The model registry supplies this once a model's behaviour has been TESTED.
   */
  instructionRole?: "native" | "folded";
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
  /** A leading reasoning block (<thought>, <think>...) was removed from the text. */
  reasoningRemoved?: boolean;
  /** Tool calls the model asked for, when tools were offered. Requests only: nothing here has been run. */
  toolCalls?: ToolCallRequest[];
  /** The model name the provider says answered (the "model" field of its reply). Null/absent when it did not say. */
  modelReturned?: string | null;
}

export interface ModelInfo {
  id: string;
  /** False when the provider listed it but it is not a chat model (speech, image, embedding...). It is recorded in the registry and never offered for chat. */
  chat?: boolean;
  /** The few facts of the provider's own listing that the registry keeps. */
  native?: import("./model-kinds.js").NativeInfo;
  displayName: string;
  contextWindow: number | null;
  /** Dollars per token, when the provider publishes it. Null = unknown. */
  priceInput: number | null;
  priceOutput: number | null;
  /** Who the provider says owns the model (gateways such as OmniRoute: the upstream provider, or "combo"). Optional. */
  ownedBy?: string | null;
  /** Every price-like field the provider listed, exactly as received (for gateways, which must be checked field by field). */
  pricingFields?: Record<string, unknown>;
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
  /** True for the built-in demonstration provider: its answers are made up by this app, not by a real AI. Never chosen by automatic routing unless the owner allows it. */
  simulated?: boolean;
  defaultBaseUrl: string;
  /** What the provider's models can take or do beyond text. All false unless verified AND the app supports it (profiles.ts keeps the facts). */
  capabilities?: { vision?: boolean; toolCalling?: boolean };
  /** Name of the environment variable that holds the API key. Null = no key needed. */
  apiKeyEnv: string | null;
  freePolicy: FreePolicy;
  freePolicyLabel: string;
  baseUrlEditable: boolean;
  /** Gemini only: the provider's own (non OpenAI-compatible) model listing, which says which operations each model supports. Path relative to the API root. */
  nativeModels?: { path: string; header: string };
  defaultDailyRequestCap: number | null;
  normalizeModelId(id: string): string;
  /** Filters out models that are not for text chat (embeddings, speech, images...). */
  isTextModel(id: string): boolean;
  classifyModel(model: ModelInfo): { status: FreeStatus; source: string; overridable?: boolean };
  /** Gateways only: the owner may personally confirm a model as free when its ONLY problem is that no price was listed. */
  ownerOverridable?: boolean;
  /** Keep blocked models in the catalog (greyed out, with the reason) instead of hiding them. For gateways, so the owner can see why. */
  storeBlocked?: boolean;
  /** The reply must name exactly the model we asked for. Anything else (or nothing) is rejected and the model is blocked. For gateways. */
  verifyReturnedModel?: boolean;
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
