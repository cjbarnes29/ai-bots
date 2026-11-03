import { LlmError } from "../errors.js";
import type {
  CompletionRequest,
  CompletionResult,
  LlmProvider,
  ModelInfo,
  ProviderPlugin,
} from "../types.js";

const MAX_BODY_CHARS = 2_000_000;
const MAX_ERROR_CHARS = 300;

export interface OpenAiCompatibleOptions {
  baseUrl: string;
  /** Null for providers that need no key (local). */
  apiKey: string | null;
  plugin: Pick<ProviderPlugin, "normalizeModelId" | "isTextModel">;
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
  constructor(private readonly options: OpenAiCompatibleOptions) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const body = {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      max_tokens: request.maxOutputTokens,
      stream: false,
    };
    const { status, text, retryAfter } = await this.send(
      "POST",
      "chat/completions",
      body,
      request.timeoutMs,
    );
    if (status < 200 || status >= 300) throw this.errorForStatus(status, text, retryAfter);
    return this.parseCompletion(text);
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
      if (!id || seen.has(id) || !this.options.plugin.isTextModel(id)) continue;
      seen.add(id);
      const pricing = asRecord(rec["pricing"]);
      const price = (v: unknown): number | null => {
        if (v === null || v === undefined || v === "") return null;
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      models.push({
        id,
        displayName: typeof rec["name"] === "string" && rec["name"] ? rec["name"] : id,
        contextWindow: numberOrNull(rec["context_length"]) ?? numberOrNull(rec["context_window"]),
        priceInput: price(pricing?.["prompt"]),
        priceOutput: price(pricing?.["completion"]),
      });
    }
    return models;
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
    if (status === 404) {
      return new LlmError("model_not_found", `The provider does not know that model or address.${suffix}`);
    }
    if (status === 408) {
      return new LlmError("timeout", "The provider timed out.", { retryable: true });
    }
    if (status === 429) {
      const retryAfterMs = parseRetryAfter(retryAfter);
      return new LlmError("rate_limited", `The provider says too many requests were sent (free-tier limit).${suffix}`, {
        retryable: true,
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

  private parseCompletion(text: string): CompletionResult {
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

    const usage = asRecord(root["usage"]);
    const cost = numberOrNull(usage?.["cost"]);
    return {
      text: content,
      inputTokens: numberOrNull(usage?.["prompt_tokens"]),
      outputTokens: numberOrNull(usage?.["completion_tokens"]),
      finishReason,
      costReportedMicro: cost === null ? null : Math.round(cost * 1_000_000),
      toolCallsIgnored,
    };
  }
}
