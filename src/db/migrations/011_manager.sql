-- Stage 2: the Manager AI. A run is one request from the owner that the Manager plans, carries out (itself or through specialist bots),
-- checks, and combines into one result. Runs and their steps are kept so progress can be seen and nothing is done twice.
CREATE TABLE manager_runs (
  id              TEXT PRIMARY KEY,
  goal            TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('planning', 'running', 'completed', 'failed', 'cancelled', 'budget_exhausted', 'interrupted')),
  mode            TEXT CHECK (mode IS NULL OR mode IN ('direct', 'plan')),
  result          TEXT,
  error           TEXT,
  model_calls     INTEGER NOT NULL DEFAULT 0,
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  budget_calls    INTEGER NOT NULL,
  budget_tokens   INTEGER NOT NULL,
  budget_steps    INTEGER NOT NULL,
  revisions       INTEGER NOT NULL DEFAULT 0,
  requested_by    TEXT NOT NULL DEFAULT 'owner',
  created_at      TEXT NOT NULL,
  finished_at     TEXT
);
CREATE INDEX idx_manager_runs_created ON manager_runs (created_at);

CREATE TABLE manager_steps (
  run_id            TEXT NOT NULL REFERENCES manager_runs(id),
  step_id           TEXT NOT NULL,
  title             TEXT NOT NULL,
  specialist_bot_id TEXT REFERENCES bots(id),
  instruction       TEXT NOT NULL,
  depends_on        TEXT NOT NULL DEFAULT '[]',
  status            TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  task_id           TEXT,
  output            TEXT,
  error             TEXT,
  attempts          INTEGER NOT NULL DEFAULT 0,
  started_at        TEXT,
  finished_at       TEXT,
  PRIMARY KEY (run_id, step_id)
);

CREATE TABLE manager_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
