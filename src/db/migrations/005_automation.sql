-- Phase 4: automation. Schedules and text triggers start tasks through the normal task engine.
-- Everything here is text only. New schedules and triggers start switched OFF.

-- Where a task came from (existing tasks are all from the user).
ALTER TABLE tasks ADD COLUMN origin TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('user', 'schedule', 'trigger'));
ALTER TABLE tasks ADD COLUMN origin_id TEXT;
ALTER TABLE tasks ADD COLUMN origin_label TEXT;
ALTER TABLE tasks ADD COLUMN origin_depth INTEGER NOT NULL DEFAULT 0 CHECK (origin_depth >= 0);
CREATE INDEX idx_tasks_origin ON tasks (origin_id);

CREATE TABLE schedules (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  bot_id               TEXT NOT NULL REFERENCES bots(id),
  instruction          TEXT NOT NULL,
  kind                 TEXT NOT NULL CHECK (kind IN ('interval', 'daily', 'once')),
  interval_minutes     INTEGER CHECK (interval_minutes IS NULL OR interval_minutes >= 1),
  time_of_day          TEXT,                                   -- "HH:MM", local time (daily)
  days                 TEXT NOT NULL DEFAULT '0,1,2,3,4,5,6',  -- 0 = Sunday ... 6 = Saturday (daily)
  run_at               INTEGER,                                -- milliseconds since 1970 (once)
  enabled              INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  next_run_at          INTEGER,
  last_run_at          INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  disabled_reason      TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE TABLE triggers (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,
  source               TEXT NOT NULL CHECK (source IN ('event', 'task_result')),
  event_name           TEXT,                                   -- for source = 'event'
  watch_bot_id         TEXT REFERENCES bots(id),               -- for source = 'task_result'
  contains             TEXT NOT NULL DEFAULT '',               -- text that must appear (empty = anything)
  bot_id               TEXT NOT NULL REFERENCES bots(id),      -- the bot that gets the new task
  instruction_template TEXT NOT NULL,
  cooldown_seconds     INTEGER NOT NULL DEFAULT 300 CHECK (cooldown_seconds >= 1),
  enabled              INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  last_fired_at        INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  disabled_reason      TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

-- A permanent record of every automatic run, skipped run and refused event.
CREATE TABLE automation_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at  TEXT NOT NULL,
  created_ms  INTEGER NOT NULL,
  day         TEXT NOT NULL,                                 -- local date, YYYY-MM-DD
  source      TEXT NOT NULL CHECK (source IN ('schedule', 'trigger', 'event')),
  source_id   TEXT,
  source_name TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('started', 'skipped', 'failed')),
  reason      TEXT,
  task_id     TEXT
);
CREATE INDEX idx_automation_runs_day ON automation_runs (day, source_id);

CREATE TRIGGER automation_runs_no_update BEFORE UPDATE ON automation_runs
BEGIN
  SELECT RAISE(ABORT, 'automation_runs is append-only');
END;
CREATE TRIGGER automation_runs_no_delete BEFORE DELETE ON automation_runs
BEGIN
  SELECT RAISE(ABORT, 'automation_runs is append-only');
END;

CREATE TABLE automation_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
