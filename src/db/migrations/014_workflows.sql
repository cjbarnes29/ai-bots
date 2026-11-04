-- Stage 6: workflows (drawn as boxes and arrows) and a persistent run queue with checkpoints.
-- A workflow can only start things that already exist (a bot task, a Manager request). It has no power of its own: anything that touches the outside
-- still goes through the approval gate, and a workflow can also stop at a checkpoint and wait for a person.
CREATE TABLE workflows (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  enabled         INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),   -- new workflows start OFF
  archived        INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  version         INTEGER NOT NULL,
  graph           TEXT NOT NULL,
  last_started_ms INTEGER,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE workflow_versions (
  workflow_id TEXT NOT NULL REFERENCES workflows(id),
  version     INTEGER NOT NULL,
  graph       TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL,
  PRIMARY KEY (workflow_id, version)
);
CREATE TRIGGER workflow_versions_no_update BEFORE UPDATE ON workflow_versions
BEGIN
  SELECT RAISE(ABORT, 'workflow versions are permanent');
END;
CREATE TRIGGER workflow_versions_no_delete BEFORE DELETE ON workflow_versions
BEGIN
  SELECT RAISE(ABORT, 'workflow versions are permanent');
END;
CREATE TRIGGER workflows_no_delete BEFORE DELETE ON workflows
BEGIN
  SELECT RAISE(ABORT, 'workflows are archived, never deleted');
END;

CREATE TABLE workflow_runs (
  id               TEXT PRIMARY KEY,
  workflow_id      TEXT NOT NULL REFERENCES workflows(id),
  workflow_version INTEGER NOT NULL,
  graph            TEXT NOT NULL,                   -- the exact graph this run follows (later edits never change a run in progress)
  status           TEXT NOT NULL CHECK (status IN ('queued', 'running', 'waiting', 'completed', 'failed', 'cancelled')),
  trigger          TEXT NOT NULL,                   -- manual | event | schedule
  input            TEXT NOT NULL DEFAULT '',
  input_hash       TEXT NOT NULL DEFAULT '',
  error            TEXT,
  requested_by     TEXT NOT NULL DEFAULT 'owner',
  created_at       TEXT NOT NULL,
  finished_at      TEXT
);
CREATE INDEX idx_workflow_runs_status ON workflow_runs (status, created_at);

CREATE TABLE workflow_steps (
  run_id      TEXT NOT NULL REFERENCES workflow_runs(id),
  node_id     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('pending', 'running', 'waiting', 'completed', 'failed', 'skipped')),
  output      TEXT,
  error       TEXT,
  ref_kind    TEXT,                                 -- task | manager: what this step started (checked again after a restart)
  ref_id      TEXT,
  attempts    INTEGER NOT NULL DEFAULT 0,
  started_at  TEXT,
  finished_at TEXT,
  decided_by  TEXT,
  PRIMARY KEY (run_id, node_id)
);
