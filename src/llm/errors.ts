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
  | "model_mismatch"
  /** The model answered, but not in the form the task requires (for example JSON that cannot be read). */
  | "bad_output"
  /** The bot asking is switched off, paused or archived: it may not run at all. */
  | "bot_not_active";

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
  bad_output: 502,
  bot_not_active: 409,
};

export interface LlmErrorOptions {
  /** Worth trying again (rate limit, server error, network). */
  retryable?: boolean;
  /** How long the provider asked us to wait. */
  retryAfterMs?: number;
  /** For limit errors: which limit was hit. */
  limitKey?: string;
  /** A rate-limit error that is really a used-up quota (per day, or no free allowance for this model): waiting a few seconds will not help. */
  quota?: boolean;
  /** The provider said, in a confirmed answer, that this model is no longer available (retired, decommissioned). Not set for temporary problems. */
  retired?: boolean;
}

export class LlmError extends AppError {
  readonly retryable: boolean;
  readonly retryAfterMs: number | undefined;
  readonly limitKey: string | undefined;
  readonly quota: boolean;
  readonly retired: boolean;

  constructor(
    public readonly llmCode: LlmErrorCode,
    message: string,
    options: LlmErrorOptions = {},
  ) {
    super(HTTP_STATUS[llmCode], `llm_${llmCode}`, message);
    this.retryable = options.retryable ?? false;
    this.retryAfterMs = options.retryAfterMs;
    this.limitKey = options.limitKey;
    this.quota = options.quota ?? false;
    this.retired = options.retired ?? false;
  }
}
