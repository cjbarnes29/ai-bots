-- Phase 3: collaboration. Bots hand text tasks to teammates the owner has explicitly allowed.
-- (bot_delegation_targets, the allow-list, already exists from migration 001 and starts empty.)

CREATE TABLE tasks (
  id               TEXT PRIMARY KEY,
  root_id          TEXT NOT NULL,                       -- the first task in the chain (its own id for a root)
  parent_id        TEXT REFERENCES tasks(id),
  assignee_bot_id  TEXT NOT NULL REFERENCES bots(id),
  requested_by     TEXT NOT NULL,                       -- 'user' or the id of the bot that delegated it
  instruction      TEXT NOT NULL,
  depth            INTEGER NOT NULL CHECK (depth >= 0),
  status           TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  result           TEXT,
  error_code       TEXT,
  error_message    TEXT,
  llm_calls        INTEGER NOT NULL DEFAULT 0,
  input_tokens     INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  started_at       TEXT,
  finished_at      TEXT
);
CREATE INDEX idx_tasks_root ON tasks (root_id);
CREATE INDEX idx_tasks_parent ON tasks (parent_id);
CREATE INDEX idx_tasks_created ON tasks (created_at);

CREATE TRIGGER tasks_no_delete BEFORE DELETE ON tasks
BEGIN
  SELECT RAISE(ABORT, 'tasks cannot be deleted');
END;

-- A full, permanent log of what happened inside a chain of tasks.
CREATE TABLE task_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id    TEXT NOT NULL REFERENCES tasks(id),
  root_id    TEXT NOT NULL,
  kind       TEXT NOT NULL,
  detail     TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_task_events_root ON task_events (root_id, id);

CREATE TRIGGER task_events_no_update BEFORE UPDATE ON task_events
BEGIN
  SELECT RAISE(ABORT, 'task_events is append-only');
END;
CREATE TRIGGER task_events_no_delete BEFORE DELETE ON task_events
BEGIN
  SELECT RAISE(ABORT, 'task_events is append-only');
END;

-- Who changed who may delegate to whom, and when. Never edited or deleted.
CREATE TABLE delegation_audit (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id        TEXT NOT NULL REFERENCES bots(id),
  target_bot_id TEXT NOT NULL REFERENCES bots(id),
  action        TEXT NOT NULL CHECK (action IN ('allowed', 'removed')),
  actor         TEXT NOT NULL DEFAULT 'local-user',
  created_at    TEXT NOT NULL
);

CREATE TRIGGER delegation_audit_no_update BEFORE UPDATE ON delegation_audit
BEGIN
  SELECT RAISE(ABORT, 'delegation_audit is append-only');
END;
CREATE TRIGGER delegation_audit_no_delete BEFORE DELETE ON delegation_audit
BEGIN
  SELECT RAISE(ABORT, 'delegation_audit is append-only');
END;

CREATE TABLE delegation_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
