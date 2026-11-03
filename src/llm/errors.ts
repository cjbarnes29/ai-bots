import { AppError } from "../errors.js";

/** Every way a model call can fail, in plain categories. */
export type LlmErrorCode =
  | "paused"
  | "blocked_by_policy"
  | "limit_exceeded"
  | "prompt_too_large"
  | "no_model_selected"
  | "model_unavailable"
  | "key_missing"
  | "auth_failed"
  | "quota_exceeded"
  | "rate_limited"
  | "timeout"
  | "network"
  | "model_not_found"
  | "content_blocked"
  | "provider_unavailable"
  | "circuit_open"
  | "bad_request"
  | "bad_response"
  | "model_mismatch";

const HTTP_STATUS: Record<LlmErrorCode, number> = {
  paused: 409,
  blocked_by_policy: 409,
  limit_exceeded: 429,
  prompt_too_large: 413,
  no_model_selected: 409,
  model_unavailable: 409,
  key_missing: 409,
  auth_failed: 502,
  quota_exceeded: 502,
  rate_limited: 429,
  timeout: 504,
  network: 502,
  model_not_found: 502,
  content_blocked: 422,
  provider_unavailable: 502,
  circuit_open: 503,
  bad_request: 502,
  bad_response: 502,
  model_mismatch: 502,
};

export interface LlmErrorOptions {
  /** Worth trying again (rate limit, server error, network). */
  retryable?: boolean;
  /** How long the provider asked us to wait. */
  retryAfterMs?: number;
  /** For limit errors: which limit was hit. */
  limitKey?: string;
}

export class LlmError extends AppError {
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly limitKey: string | undefined;

  constructor(
    public readonly llmCode: LlmErrorCode,
    message: string,
    options: LlmErrorOptions = {},
  ) {
    super(HTTP_STATUS[llmCode], `llm_${llmCode}`, message);
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.limitKey = options.limitKey;
  }
}
