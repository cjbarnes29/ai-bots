-- Stage 3: the Skill Library and tool assignments.
-- A skill is a reusable block of instructions (and a list of tools it needs) that can be given to bots. Every edit is a new, permanent version.
CREATE TABLE skills (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL UNIQUE,
  enabled         INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  archived        INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  imported        INTEGER NOT NULL DEFAULT 0 CHECK (imported IN (0, 1)),
  current_version INTEGER NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL
);

CREATE TABLE skill_versions (
  skill_id       TEXT NOT NULL REFERENCES skills(id),
  version        INTEGER NOT NULL,
  name           TEXT NOT NULL,
  description    TEXT NOT NULL,
  instructions   TEXT NOT NULL,
  required_tools TEXT NOT NULL DEFAULT '[]',
  tags           TEXT NOT NULL DEFAULT '[]',
  change_note    TEXT,
  restored_from  INTEGER,
  created_at     TEXT NOT NULL,
  PRIMARY KEY (skill_id, version)
);

-- Old versions can never be edited or removed.
CREATE TRIGGER skill_versions_no_update BEFORE UPDATE ON skill_versions
BEGIN
  SELECT RAISE(ABORT, 'skill versions are permanent');
END;
CREATE TRIGGER skill_versions_no_delete BEFORE DELETE ON skill_versions
BEGIN
  SELECT RAISE(ABORT, 'skill versions are permanent');
END;
CREATE TRIGGER skills_no_delete BEFORE DELETE ON skills
BEGIN
  SELECT RAISE(ABORT, 'skills are archived, never deleted');
END;

CREATE TABLE bot_skills (
  bot_id      TEXT NOT NULL REFERENCES bots(id),
  skill_id    TEXT NOT NULL REFERENCES skills(id),
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (bot_id, skill_id)
);

-- Which of the tools that need explicit access a bot may use (connectors such as Gmail keep using each bot's Permissions switches).
CREATE TABLE bot_tools (
  bot_id      TEXT NOT NULL REFERENCES bots(id),
  tool_id     TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (bot_id, tool_id)
);
