-- Phase 1 schema: Agent Manager.
-- Safety rules are enforced by the database itself (CHECK constraints and triggers),
-- so no bug in application code can quietly break them.

CREATE TABLE bots (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL DEFAULT '',
  personality      TEXT NOT NULL DEFAULT '',
  instructions     TEXT NOT NULL DEFAULT '',
  responsibilities TEXT NOT NULL DEFAULT '[]',          -- JSON array of strings
  runtime          TEXT NOT NULL DEFAULT 'builtin' CHECK (runtime IN ('builtin', 'openclaw')),
  model            TEXT,                                -- not used until Phase 2
  status           TEXT NOT NULL DEFAULT 'disabled' CHECK (status IN ('disabled', 'paused', 'active')),
  current_version  INTEGER NOT NULL DEFAULT 1,
  archived         INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);

-- Bots are never really deleted: they are archived and can be restored.
CREATE TRIGGER bots_no_delete BEFORE DELETE ON bots
BEGIN
  SELECT RAISE(ABORT, 'bots cannot be deleted; archive them instead');
END;

-- Every edit to a bot's content adds a row here. History is never rewritten.
CREATE TABLE bot_versions (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id           TEXT NOT NULL REFERENCES bots(id),
  version          INTEGER NOT NULL,
  name             TEXT NOT NULL,
  role             TEXT NOT NULL,
  personality      TEXT NOT NULL,
  instructions     TEXT NOT NULL,
  responsibilities TEXT NOT NULL,
  runtime          TEXT NOT NULL,
  model            TEXT,
  change_note      TEXT,
  restored_from    INTEGER,                             -- set when created by a restore
  created_at       TEXT NOT NULL,
  UNIQUE (bot_id, version)
);

CREATE TRIGGER bot_versions_no_update BEFORE UPDATE ON bot_versions
BEGIN
  SELECT RAISE(ABORT, 'bot_versions is append-only');
END;
CREATE TRIGGER bot_versions_no_delete BEFORE DELETE ON bot_versions
BEGIN
  SELECT RAISE(ABORT, 'bot_versions is append-only');
END;

-- Per-bot, per-connector permissions. Reading is OFF by default.
-- Writing is permanently "approval_required": the CHECK makes any other value impossible.
CREATE TABLE bot_permissions (
  bot_id       TEXT NOT NULL REFERENCES bots(id),
  connector    TEXT NOT NULL CHECK (connector IN ('gmail', 'telegram', 'browser')),
  read_enabled INTEGER NOT NULL DEFAULT 0 CHECK (read_enabled IN (0, 1)),
  write_policy TEXT NOT NULL DEFAULT 'approval_required' CHECK (write_policy = 'approval_required'),
  updated_at   TEXT NOT NULL,
  PRIMARY KEY (bot_id, connector)
);

-- A permanent log of every permission change.
CREATE TABLE permission_audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id     TEXT NOT NULL REFERENCES bots(id),
  connector  TEXT NOT NULL,
  field      TEXT NOT NULL,
  old_value  INTEGER NOT NULL,
  new_value  INTEGER NOT NULL,
  actor      TEXT NOT NULL DEFAULT 'local-user',
  created_at TEXT NOT NULL
);

CREATE TRIGGER permission_audit_no_update BEFORE UPDATE ON permission_audit
BEGIN
  SELECT RAISE(ABORT, 'permission_audit is append-only');
END;
CREATE TRIGGER permission_audit_no_delete BEFORE DELETE ON permission_audit
BEGIN
  SELECT RAISE(ABORT, 'permission_audit is append-only');
END;

-- Saved now, unused until Phase 3 (delegation).
CREATE TABLE bot_delegation_targets (
  bot_id        TEXT NOT NULL REFERENCES bots(id),
  target_bot_id TEXT NOT NULL REFERENCES bots(id),
  PRIMARY KEY (bot_id, target_bot_id),
  CHECK (bot_id <> target_bot_id)
);
