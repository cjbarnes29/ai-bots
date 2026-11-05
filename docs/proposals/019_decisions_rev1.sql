-- PROPOSAL ONLY (2026-11-05). NOT a migration: deliberately OUTSIDE src/db/migrations/. Needs the owner's explicit approval (board P-24).
-- On approval: copied unchanged to src/db/migrations/019_decisions.sql (same procedure as 017/018: backup, scratch rehearsal, apply).
--
-- The DECISION BOARD ("chalkboard"): when the owner asks something, the bots whose responsibilities fit offer OPTIONS. The owner can pin the question
-- to the board, edit the options, choose one, and APPROVE it as a project; the bots assigned to it then report back. Purely ADDITIVE: new tables only.
-- A decision, an option or a bot's wording is UNTRUSTED TEXT: approving a decision creates/links a project and assignments; it can never grant a
-- permission, a folder, a program or a secret, and every outside action it leads to still waits for the normal approval gate.

CREATE TABLE decisions (
  id               TEXT PRIMARY KEY,
  project_id       TEXT REFERENCES projects(id),                        -- set when it is approved as (or attached to) a project
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  question         TEXT NOT NULL DEFAULT '' CHECK (length(question) <= 4000),   -- what the owner asked, as written
  status           TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'chosen', 'approved', 'in_progress', 'done', 'rejected', 'archived')),
  chosen_option_id TEXT,                                                -- must be one of THIS decision's options (trigger below)
  owner_note       TEXT NOT NULL DEFAULT '' CHECK (length(owner_note) <= 4000),
  raised_by_bot_id TEXT REFERENCES bots(id),                            -- NULL = the owner raised it
  source_kind      TEXT CHECK (source_kind IS NULL OR source_kind IN ('conversation', 'group', 'task', 'workflow_run', 'schedule', 'manual')),
  source_id        TEXT,                                                -- the real conversation/event it came from
  approved_at      TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  CHECK (status NOT IN ('approved', 'in_progress', 'done') OR (chosen_option_id IS NOT NULL AND approved_at IS NOT NULL))  -- never approved without a chosen option
);
CREATE INDEX idx_decisions_list ON decisions (status, updated_at);
CREATE INDEX idx_decisions_project ON decisions (project_id);
CREATE UNIQUE INDEX uq_decisions_source ON decisions (source_kind, source_id, title) WHERE source_kind IS NOT NULL AND source_id IS NOT NULL;  -- a retry cannot post the same question twice

CREATE TRIGGER trg_decisions_no_delete BEFORE DELETE ON decisions
BEGIN SELECT RAISE(ABORT, 'Decisions are archived, never deleted.'); END;

-- The options offered. Bots propose; ONLY the owner edits the text afterwards (edited_by_owner), and every edit is kept in decision_revisions.
CREATE TABLE decision_options (
  id                TEXT PRIMARY KEY,
  decision_id       TEXT NOT NULL REFERENCES decisions(id),
  position          INTEGER NOT NULL CHECK (position BETWEEN 1 AND 12),
  title             TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  details           TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 4000),
  pros              TEXT NOT NULL DEFAULT '' CHECK (length(pros) <= 1000),
  cons              TEXT NOT NULL DEFAULT '' CHECK (length(cons) <= 1000),
  proposed_by_bot_id TEXT REFERENCES bots(id),                          -- NULL = added by the owner
  edited_by_owner   INTEGER NOT NULL DEFAULT 0 CHECK (edited_by_owner IN (0, 1)),
  removed_at        TEXT,                                               -- options are removed, not deleted
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (decision_id, position)
);
CREATE INDEX idx_decision_options_decision ON decision_options (decision_id, removed_at);
CREATE TRIGGER trg_decision_options_no_delete BEFORE DELETE ON decision_options
BEGIN SELECT RAISE(ABORT, 'Options are removed (removed_at), not deleted.'); END;

-- The chosen option must belong to the same decision and not be removed.
CREATE TRIGGER trg_decisions_chosen_belongs BEFORE UPDATE OF chosen_option_id ON decisions WHEN NEW.chosen_option_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM decision_options o WHERE o.id = NEW.chosen_option_id AND o.decision_id = NEW.id AND o.removed_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'The chosen option must be an active option of this decision.'); END;

-- Who must act and report: the bots assigned once a decision is approved. Assignment is a TASK for the bot; it grants nothing.
CREATE TABLE decision_assignments (
  decision_id  TEXT NOT NULL REFERENCES decisions(id),
  bot_id       TEXT NOT NULL REFERENCES bots(id),
  duty         TEXT NOT NULL CHECK (length(duty) BETWEEN 1 AND 1000),   -- what this bot is to do (from its responsibilities; edited by the owner)
  task_id      TEXT REFERENCES tasks(id),                               -- the real task started through the normal task engine, once the owner approved
  created_at   TEXT NOT NULL,
  PRIMARY KEY (decision_id, bot_id)
);
CREATE INDEX idx_decision_assignments_bot ON decision_assignments (bot_id);

-- Append-only: every owner edit, choice and approval (what changed, before and after), so the board is a trustworthy record.
CREATE TABLE decision_revisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id  TEXT NOT NULL REFERENCES decisions(id),
  actor        TEXT NOT NULL CHECK (actor IN ('owner', 'bot', 'system')),
  bot_id       TEXT REFERENCES bots(id),
  action       TEXT NOT NULL CHECK (action IN ('created', 'option_added', 'option_edited', 'option_removed', 'chosen', 'approved', 'rejected', 'note', 'status', 'assigned', 'archived')),
  detail       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail) AND json_type(detail) = 'object'),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_decision_revisions_decision ON decision_revisions (decision_id, id);
CREATE TRIGGER trg_decision_revisions_no_update BEFORE UPDATE ON decision_revisions BEGIN SELECT RAISE(ABORT, 'The decision history is append-only.'); END;
CREATE TRIGGER trg_decision_revisions_no_delete BEFORE DELETE ON decision_revisions BEGIN SELECT RAISE(ABORT, 'The decision history is append-only.'); END;

-- Bots reporting back on an approved decision (progress, done, blocked). Append-only; tied to the real task when there is one.
CREATE TABLE decision_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id  TEXT NOT NULL REFERENCES decisions(id),
  bot_id       TEXT NOT NULL REFERENCES bots(id),
  kind         TEXT NOT NULL CHECK (kind IN ('progress', 'done', 'blocked', 'question')),
  message      TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 8000),
  task_id      TEXT REFERENCES tasks(id),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_decision_reports_decision ON decision_reports (decision_id, id);
CREATE UNIQUE INDEX uq_decision_reports_task ON decision_reports (task_id, kind) WHERE task_id IS NOT NULL;   -- one report per real task and kind
CREATE TRIGGER trg_decision_reports_assigned BEFORE INSERT ON decision_reports
  WHEN NOT EXISTS (SELECT 1 FROM decision_assignments a WHERE a.decision_id = NEW.decision_id AND a.bot_id = NEW.bot_id)
BEGIN SELECT RAISE(ABORT, 'Only a bot assigned to this decision can report on it.'); END;
CREATE TRIGGER trg_decision_reports_approved BEFORE INSERT ON decision_reports
  WHEN (SELECT status FROM decisions d WHERE d.id = NEW.decision_id) NOT IN ('approved', 'in_progress', 'done')
BEGIN SELECT RAISE(ABORT, 'Reports are only accepted for an approved decision.'); END;
CREATE TRIGGER trg_decision_reports_no_update BEFORE UPDATE ON decision_reports BEGIN SELECT RAISE(ABORT, 'Reports are append-only.'); END;
CREATE TRIGGER trg_decision_reports_no_delete BEFORE DELETE ON decision_reports BEGIN SELECT RAISE(ABORT, 'Reports are append-only.'); END;
