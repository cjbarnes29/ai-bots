-- Phase 5: approvals, secrets vault and audit log.
-- The safety rules are enforced here too, so no bug in application code can break them.

-- Secrets are stored ENCRYPTED (AES-256-GCM). The encryption key lives in a separate file, never in this database.
CREATE TABLE vault_secrets (
  name       TEXT PRIMARY KEY,
  iv         TEXT NOT NULL,
  tag        TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- A permanent record of security-relevant events. It never contains secret values.
CREATE TABLE audit_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  actor      TEXT NOT NULL DEFAULT 'system',
  bot_id     TEXT,
  detail     TEXT NOT NULL
);
CREATE INDEX idx_audit_events_ms ON audit_events (created_ms);

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only');
END;
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events
BEGIN
  SELECT RAISE(ABORT, 'audit_events is append-only');
END;

-- Outside actions that a bot asked for and that need the owner's approval (every write does).
CREATE TABLE approval_requests (
  id          TEXT PRIMARY KEY,
  bot_id      TEXT NOT NULL REFERENCES bots(id),
  task_id     TEXT,
  connector   TEXT NOT NULL,
  action      TEXT NOT NULL,
  summary     TEXT NOT NULL,
  args_json   TEXT NOT NULL,          -- the EXACT content that will be used if approved
  args_hash   TEXT NOT NULL,          -- fingerprint of args_json, checked again just before it runs
  status      TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'executed', 'failed', 'denied', 'expired')),
  result      TEXT,
  error       TEXT,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  decided_at  TEXT,
  decided_by  TEXT,
  executed_at TEXT
);
CREATE INDEX idx_approval_requests_status ON approval_requests (status, created_at);
CREATE INDEX idx_approval_requests_bot ON approval_requests (bot_id, created_at);

-- Once a request exists, what it says can never be changed.
CREATE TRIGGER approval_requests_content_locked
BEFORE UPDATE OF bot_id, task_id, connector, action, summary, args_json, args_hash, created_at, expires_at ON approval_requests
BEGIN
  SELECT RAISE(ABORT, 'an approval request cannot be edited');
END;

-- Allowed status changes only: pending -> approved / denied / expired, approved -> executed / failed.
-- A finished request can never change again, so an action can never run twice.
CREATE TRIGGER approval_requests_status_flow
BEFORE UPDATE OF status ON approval_requests
WHEN NOT (
  OLD.status = NEW.status
  OR (OLD.status = 'pending' AND NEW.status IN ('approved', 'denied', 'expired'))
  OR (OLD.status = 'approved' AND NEW.status IN ('executed', 'failed'))
)
BEGIN
  SELECT RAISE(ABORT, 'that approval status change is not allowed');
END;

CREATE TRIGGER approval_requests_no_delete BEFORE DELETE ON approval_requests
BEGIN
  SELECT RAISE(ABORT, 'approval requests cannot be deleted');
END;

CREATE TABLE approval_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
