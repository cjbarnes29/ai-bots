-- Stage 4: the PC agent. What a bot may do on this computer is controlled by five SEPARATE permissions per bot, a short list of allowed
-- folders, an emergency stop, and a permanent log of everything that ran.
CREATE TABLE pc_grants (
  bot_id     TEXT NOT NULL REFERENCES bots(id),
  permission TEXT NOT NULL CHECK (permission IN ('read', 'execute', 'modify', 'install', 'admin')),
  granted_at TEXT NOT NULL,
  PRIMARY KEY (bot_id, permission)
);

CREATE TABLE pc_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Every command and file change, successful or refused. Append-only.
CREATE TABLE pc_executions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at  TEXT NOT NULL,
  bot_id      TEXT,
  action      TEXT NOT NULL,
  cwd         TEXT,
  command     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('ok', 'failed', 'timeout', 'stopped', 'refused')),
  exit_code   INTEGER,
  duration_ms INTEGER,
  output      TEXT
);
CREATE TRIGGER pc_executions_no_update BEFORE UPDATE ON pc_executions
BEGIN
  SELECT RAISE(ABORT, 'the PC execution log is append-only');
END;
CREATE TRIGGER pc_executions_no_delete BEFORE DELETE ON pc_executions
BEGIN
  SELECT RAISE(ABORT, 'the PC execution log is append-only');
END;
