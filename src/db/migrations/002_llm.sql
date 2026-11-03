-- Phase 2: AI model integration (providers, models, usage, limits).
-- Free-only mode is enforced here too: a model flagged "blocked" can never be enabled.

-- Per-bot generation settings (saved in version history like the other bot fields).
ALTER TABLE bots ADD COLUMN temperature REAL
  CHECK (temperature IS NULL OR (temperature >= 0 AND temperature <= 2));
ALTER TABLE bots ADD COLUMN max_output_tokens INTEGER
  CHECK (max_output_tokens IS NULL OR (max_output_tokens >= 1 AND max_output_tokens <= 4096));
ALTER TABLE bot_versions ADD COLUMN temperature REAL;
ALTER TABLE bot_versions ADD COLUMN max_output_tokens INTEGER;

-- Mutable state for each provider. Which providers exist (and their fixed addresses and
-- key names) is defined in code, so a cloud address or key name can never be edited here.
CREATE TABLE llm_providers (
  id                TEXT PRIMARY KEY,
  enabled           INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  free_confirmed    INTEGER NOT NULL DEFAULT 0 CHECK (free_confirmed IN (0, 1)),
  daily_request_cap INTEGER CHECK (daily_request_cap IS NULL OR daily_request_cap >= 1),
  base_url          TEXT,                    -- only used for the local provider
  last_status       TEXT,
  last_checked_at   TEXT,
  last_message      TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE llm_models (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id     TEXT NOT NULL REFERENCES llm_providers(id),
  model_id        TEXT NOT NULL,
  display_name    TEXT NOT NULL,
  free_status     TEXT NOT NULL CHECK (free_status IN ('verified_free', 'free_tier', 'blocked')),
  free_source     TEXT NOT NULL,
  free_checked_at TEXT NOT NULL,
  context_window  INTEGER,
  enabled         INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  availability    TEXT NOT NULL DEFAULT 'unknown'
                  CHECK (availability IN ('available', 'not_installed', 'removed', 'unknown')),
  is_llama        INTEGER NOT NULL DEFAULT 0 CHECK (is_llama IN (0, 1)),
  updated_at      TEXT NOT NULL,
  UNIQUE (provider_id, model_id),
  -- A blocked (paid or unverified) model can never be switched on.
  CHECK (NOT (enabled = 1 AND free_status = 'blocked'))
);

-- Editable settings such as limit overrides and the global pause switch.
CREATE TABLE llm_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- One row per call attempt (including failed and blocked ones). Never edited or deleted.
CREATE TABLE llm_usage (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at          TEXT NOT NULL,
  created_ms          INTEGER NOT NULL,
  day                 TEXT NOT NULL,          -- local date, YYYY-MM-DD
  month               TEXT NOT NULL,          -- local month, YYYY-MM
  bot_id              TEXT REFERENCES bots(id),
  conversation_id     TEXT,
  provider_id         TEXT NOT NULL,
  model_id            TEXT NOT NULL,
  cloud               INTEGER NOT NULL CHECK (cloud IN (0, 1)),
  status              TEXT NOT NULL CHECK (status IN ('ok', 'error', 'blocked')),
  error_code          TEXT,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  tokens_estimated    INTEGER NOT NULL DEFAULT 0 CHECK (tokens_estimated IN (0, 1)),
  latency_ms          INTEGER,
  cost_reported_micro INTEGER NOT NULL DEFAULT 0,
  note                TEXT
);
CREATE INDEX idx_llm_usage_day ON llm_usage (day);
CREATE INDEX idx_llm_usage_month ON llm_usage (month);
CREATE INDEX idx_llm_usage_bot_day ON llm_usage (bot_id, day);
CREATE INDEX idx_llm_usage_provider_day ON llm_usage (provider_id, day);
CREATE INDEX idx_llm_usage_ms ON llm_usage (created_ms);

CREATE TRIGGER llm_usage_no_update BEFORE UPDATE ON llm_usage
BEGIN
  SELECT RAISE(ABORT, 'llm_usage is append-only');
END;
CREATE TRIGGER llm_usage_no_delete BEFORE DELETE ON llm_usage
BEGIN
  SELECT RAISE(ABORT, 'llm_usage is append-only');
END;
