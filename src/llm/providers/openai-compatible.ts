import { LlmError } from "../errors.js";
import { stripReasoning } from "../reasoning.js";
import { foldInstructionsIntoUserTurn, isInstructionRoleRefusal, modelLacksInstructionRole } from "./instructions.js";
import type {
  CompletionRequest,
  CompletionResult,
  LlmProvider,
  ModelInfo,
  ProviderPlugin,
} from "../types.js";

const MAX_BODY_CHARS = 2_000_000;
const MAX_ERROR_CHARS = 300;
/** A provider answer that says, about the model, that it has been retired. Needs the word "model" nearby so an unrelated "deprecated parameter" is not mistaken for it. */
const RETIRED = /model[\s\S]{0,120}?(no longer (available|supported)|decommission|has been (deprecated|retired|shut ?down|discontinued)|is (deprecated|retired|discontinued))|model_decommissioned/i;

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  /** Null for providers that need no key (local). */
  apiKey: string | null;
  plugin: Pick<ProviderPlugin, "normalizeModelId" | "isTextModel" | "capabilities" | "nativeModels">;
  /** Removes API keys from text before it is put in an error message. */
  redact: (text: string) => string;
  fetchImpl?: typeof fetch;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Collects every price-like field of a listed model, untouched, so a gateway can be checked field by field. */
function pricingFieldsOf(rec: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const pricing = rec["pricing"];
  if (pricing !== undefined) {
    const obj = asRecord(pricing);
    if (obj) for (const [k, v] of Object.entries(obj)) out[`pricing.${k}`] = v;
    else out["pricing"] = pricing;
  }
  for (const [k, v] of Object.entries(rec)) if (k !== "pricing" && /(cost|price|pricing)/i.test(k)) out[k] = v;
  return out;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** "Retry-After" is either seconds or a date. Returns milliseconds, or undefined. */
function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/**
 * Talks to any provider that offers the common "OpenAI-compatible" chat API
 * (Gemini, Groq, OpenRouter, Ollama, ...). Uses Node's built-in fetch.
 *
 * It only ever sends: model, messages, temperature, max_tokens, stream=false.
 * It never sends tools, functions, fallback model lists or routing options.
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  /** Models that refused a system/developer message in this run: from then on their instructions go inside the first user turn. */
  private readonly noInstructionRole = new Set<string>();

  constructor(private readonly options: OpenAiCompatibleOptions) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const caps = this.options.plugin.capabilities;
    const hasImages = request.messages.some((m) => (m.images?.length ?? 0) > 0);
    if (hasImages && (!request.imagesApproved || !caps?.vision)) {
      throw new LlmError("blocked_by_policy", "Pictures are not sent: the provider is not set up for images, or the picture policy did not approve this request.");
    }
    const tools = request.tools && request.tools.length > 0 && caps?.toolCalling ? request.tools : null;
    const build = (messages: CompletionRequest["messages"]) => ({
      model: request.model,
      // only role and content leave this program: any other field of a message (including pictures that were not approved) is dropped here
      messages: messages.map((m) =>
        m.images && m.images.length > 0
          ? { role: m.role, content: [{ type: "text", text: m.content }, ...m.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mime};base64,${i.dataBase64}` } }))] }
          : { role: m.role, content: m.content },
      ),
      ...(tools ? { tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })) } : {}),
      temperature: request.temperature,
      max_tokens: request.maxOutputTokens,
      stream: false,
    });
    const hasInstructions = request.messages.some((m) => m.role === "system");
    // A model with no instruction role gets the SAME instructions inside the first user turn (see instructions.ts); nothing is dropped.
    const mode = request.instructionRole;
    const folded = hasInstructions && (mode === "folded" || (mode === undefined && (modelLacksInstructionRole(request.model) || this.noInstructionRole.has(request.model))));
    let { status, text, retryAfter } = await this.send("POST", "chat/completions", build(folded ? foldInstructionsIntoUserTurn(request.messages) : request.messages), request.timeoutMs);
    // A model we did not know about refuses the role: remember it and ask once more, with the instructions folded in. Only this exact refusal is retried.
    // (Only when the way to send instructions was not fixed by a test: a test of the native role must see the refusal, not have it hidden.)
    if (mode === undefined && !folded && hasInstructions && status === 400 && isInstructionRoleRefusal(this.providerMessage(text))) {
      this.noInstructionRole.add(request.model);
      ({ status, text, retryAfter } = await this.send("POST", "chat/completions", build(foldInstructionsIntoUserTurn(request.messages)), request.timeoutMs));
    }
    if (status < 200 || status >= 300) throw this.errorForStatus(status, text, retryAfter);
    return this.parseCompletion(text, request.model);
  }

  async listModels(timeoutMs: number): Promise<ModelInfo[]> {
    const { status, text, retryAfter } = await this.send("GET", "models", undefined, timeoutMs);
    if (status < 200 || status >= 300) throw this.errorForStatus(status, text, retryAfter);

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmError("bad_response", "The provider returned a model list that could not be read.");
    }
    const root = asRecord(json);
    const list = Array.isArray(root?.["data"])
      ? (root?.["data"] as unknown[])
      : Array.isArray(root?.["models"])
        ? (root?.["models"] as unknown[])
        : null;
    if (!list) throw new LlmError("bad_response", "The provider returned an unexpected model list.");

    const seen = new Set<string>();
    const models: ModelInfo[] = [];
    for (const item of list) {
      const rec = asRecord(item);
      const rawId = typeof rec?.["id"] === "string" ? rec["id"] : typeof rec?.["name"] === "string" ? rec["name"] : null;
      if (!rec || !rawId) continue;
      const id = this.options.plugin.normalizeModelId(rawId);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const chat = this.options.plugin.isTextModel(id);
      const pricing = asRecord(rec["pricing"]);
      const price = (v: unknown): number | null => {
        if (v === null || v === undefined || v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      models.push({
        id,
        chat,
        native: {
          ...(typeof rec["active"] === "boolean" ? { active: rec["active"] as boolean } : {}),
          ...(typeof rec["owned_by"] === "string" ? { ownedBy: rec["owned_by"] as string } : {}),
          ...(numberOrNull(rec["max_completion_tokens"]) !== null ? { maxOutputTokens: numberOrNull(rec["max_completion_tokens"]) } : {}),
        },
        displayName: typeof rec["name"] === "string" && rec["name"] ? rec["name"] : id,
        contextWindow: numberOrNull(rec["context_length"]) ?? numberOrNull(rec["context_window"]),
        priceInput: price(pricing?.["prompt"] ?? pricing?.["input"]),
        priceOutput: price(pricing?.["completion"] ?? pricing?.["output"]),
        ...(typeof rec["owned_by"] === "string" ? { ownedBy: rec["owned_by"] } : {}),
        ...(Object.keys(pricingFieldsOf(rec)).length > 0 ? { pricingFields: pricingFieldsOf(rec) } : {}),
      });
    }
    await this.addNativeFacts(models, timeoutMs);
    return models;
  }

  /**
   * Gemini: asks the provider's own listing (one GET, no tokens) which operations each model supports and how large its windows are, and adds those
   * facts to the models already listed (and any model only the native listing knows). A failure here never fails discovery: the id-based rules still apply.
   */
  private async addNativeFacts(models: ModelInfo[], timeoutMs: number): Promise<void> {
    const cfg = this.options.plugin.nativeModels;
    if (!cfg || !this.options.apiKey) return;
    try {
      const root = this.options.baseUrl.replace(/\/openai\/?$/, "");
      const res = await (this.options.fetchImpl ?? fetch)(joinUrl(root, cfg.path), { method: "GET", headers: { accept: "application/json", [cfg.header]: this.options.apiKey }, signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return;
      const json = asRecord(JSON.parse(await res.text()));
      const list = Array.isArray(json?.["models"]) ? (json?.["models"] as unknown[]) : [];
      const byId = new Map(models.map((m) => [m.id, m]));
      for (const item of list) {
        const rec = asRecord(item);
        const rawName = typeof rec?.["name"] === "string" ? rec["name"] : null;
        if (!rec || !rawName) continue;
        const id = this.options.plugin.normalizeModelId(rawName);
        const methods = Array.isArray(rec["supportedGenerationMethods"]) ? (rec["supportedGenerationMethods"] as unknown[]).filter((x): x is string => typeof x === "string") : null;
        const native = {
          ...(methods ? { methods } : {}),
          ...(numberOrNull(rec["inputTokenLimit"]) !== null ? { contextWindow: numberOrNull(rec["inputTokenLimit"]) } : {}),
          ...(numberOrNull(rec["outputTokenLimit"]) !== null ? { maxOutputTokens: numberOrNull(rec["outputTokenLimit"]) } : {}),
          ...(typeof rec["thinking"] === "boolean" ? { thinking: rec["thinking"] as boolean } : {}),
          ...(typeof rec["version"] === "string" ? { version: rec["version"] as string } : {}),
          ...(typeof rec["description"] === "string" ? { description: (rec["description"] as string).slice(0, 200) } : {}),
        };
        const known = byId.get(id);
        if (known) {
          known.native = { ...(known.native ?? {}), ...native };
          if (known.contextWindow === null && native.contextWindow) known.contextWindow = native.contextWindow;
          // The provider's own operation list wins over the id rule: a model that cannot generate text is not a chat model.
          if (methods && methods.length > 0 && !methods.some((m) => /generateContent|generateMessage/i.test(m))) known.chat = false;
        } else {
          const chat = this.options.plugin.isTextModel(id) && (!methods || methods.some((m) => /generateContent|generateMessage/i.test(m)));
          models.push({ id, chat, native, displayName: typeof rec["displayName"] === "string" ? rec["displayName"] : id, contextWindow: native.contextWindow ?? null, priceInput: null, priceOutput: null });
        }
      }
    } catch {
      /* optional enrichment */
    }
  }

  // ---- internals ----

  private async send(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<{ status: number; text: string; retryAfter: string | null }> {
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.options.apiKey) headers["authorization"] = `Bearer ${this.options.apiKey}`;

    const doFetch = this.options.fetchImpl ?? fetch;
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const res = await doFetch(joinUrl(this.options.baseUrl, path), {
        method,
        headers,
        signal,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      if (text.length > MAX_BODY_CHARS) {
        throw new LlmError("bad_response", "The provider's reply was unexpectedly large.");
      }
      return { status: res.status, text, retryAfter: res.headers.get("retry-after") };
    } catch (err) {
      if (err instanceof LlmError) throw err;
      if (signal.aborted) {
        throw new LlmError(
          "timeout",
          `The provider did not answer within ${Math.round(timeoutMs / 1000)} seconds.`,
          { retryable: true },
        );
      }
      throw new LlmError("network", "Could not reach the provider. Check that it is running and your internet connection.", {
        retryable: true,
      });
    }
  }

  private providerMessage(text: string): string {
    let message = text;
    try {
      const json = JSON.parse(text) as unknown;
      const first = Array.isArray(json) ? json[0] : json;
      const rec = asRecord(first);
      const error = asRecord(rec?.["error"]);
      const found = error?.["message"] ?? rec?.["message"] ?? (typeof rec?.["error"] === "string" ? rec["error"] : undefined);
      if (typeof found === "string") message = found;
    } catch {
      /* not JSON: use the raw text */
    }
    const clean = this.options.redact(message).replace(/\s+/g, " ").trim();
    return clean.length > MAX_ERROR_CHARS ? `${clean.slice(0, MAX_ERROR_CHARS)}…` : clean;
  }

  private errorForStatus(status: number, text: string, retryAfter: string | null): LlmError {
    const detail = this.providerMessage(text);
    const suffix = detail ? ` (${detail})` : "";
    if (status === 401 || status === 403) {
      return new LlmError("auth_failed", `The provider rejected the API key. Check the key in your .env file.${suffix}`);
    }
    if (status === 402) {
      return new LlmError(
        "quota_exceeded",
        `The provider says payment or credits are required. This platform only uses free models, so the call was stopped.${suffix}`,
      );
    }
    // A CONFIRMED retirement: the provider says, about the model, that it is gone. A bare 404 or a temporary error is never read this way.
    if ((status === 404 || status === 410 || status === 400) && RETIRED.test(this.options.redact(text).slice(0, 3000))) {
      return new LlmError("model_not_found", `The provider says this model is no longer available.${suffix}`, { retired: true });
    }
    if (status === 404) {
      return new LlmError("model_not_found", `The provider does not know that model or address.${suffix}`);
    }
    if (status === 408) {
      return new LlmError("timeout", "The provider timed out.", { retryable: true });
    }
    if (status === 429) {
      const retryAfterMs = parseRetryAfter(retryAfter);
      // A used-up daily quota (or "limit: 0", no free allowance for this model at all) will not clear in seconds, so it is flagged and never retried.
      const quota = /per[ _-]?day|daily|limit:\s*0\b|PerDay/i.test(detail);
      return new LlmError("rate_limited", `The provider says too many requests were sent (free-tier limit).${suffix}`, {
        retryable: !quota,
        quota,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      });
    }
    if (status >= 500) {
      return new LlmError("provider_unavailable", `The provider had a problem (HTTP ${status}).${suffix}`, {
        retryable: true,
      });
    }
    return new LlmError("bad_request", `The provider refused the request (HTTP ${status}).${suffix}`);
  }

  private parseCompletion(text: string, model: string): CompletionResult {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new LlmError("bad_response", "The provider's reply could not be read.");
    }
    const root = asRecord(json);
    const choices = root?.["choices"];
    const choice = Array.isArray(choices) ? asRecord(choices[0]) : null;
    const message = asRecord(choice?.["message"]);
    if (!root || !choice || !message) {
      throw new LlmError("bad_response", "The provider's reply had an unexpected shape.");
    }

    const finishReason = typeof choice["finish_reason"] === "string" ? choice["finish_reason"] : null;
    if (finishReason === "content_filter") {
      throw new LlmError("content_blocked", "The provider blocked this reply with its content filter.");
    }

    const content = typeof message["content"] === "string" ? message["content"] : "";
    const toolCallsIgnored =
      (Array.isArray(message["tool_calls"]) && message["tool_calls"].length > 0) || message["function_call"] != null;
    if (!content.trim() && !toolCallsIgnored) {
      throw new LlmError("bad_response", "The model returned an empty reply.");
    }

    // Internal reasoning is never an answer. Only a block at the very start is removed; a reply that is nothing but reasoning is a failed call, not a success.
    const cleaned = stripReasoning(content, model);
    if (cleaned.reasoningOnly && !toolCallsIgnored) {
      throw new LlmError("bad_output", `${model} answered with only its internal reasoning${cleaned.incomplete ? " (cut off before it reached an answer)" : ""}, so there is no answer to use.`);
    }
    const usage = asRecord(root["usage"]);
    const cost = numberOrNull(usage?.["cost"]);
    return {
      text: cleaned.text,
      ...(cleaned.removed ? { reasoningRemoved: true } : {}),
      inputTokens: numberOrNull(usage?.["prompt_tokens"]),
      outputTokens: numberOrNull(usage?.["completion_tokens"]),
      finishReason,
      costReportedMicro: cost === null ? null : Math.round(cost * 1_000_000),
      toolCallsIgnored,
      modelReturned: typeof root["model"] === "string" ? root["model"] : null,
    };
  }
}
