-- PROPOSAL ONLY, REVISION 3 (2026-11-05; revision 2 is kept as 019_decisions_rev2.sql, revision 1 as 019_decisions_rev1.sql). NOT a migration: deliberately OUTSIDE src/db/migrations/. NOT approved, NOT applied (board P-24: the owner
-- asked for changes to revision 1, kept as docs/proposals/019_decisions_rev1.sql). On approval it is copied unchanged to src/db/migrations/019_decisions.sql.
--
-- Revision 3 closes the gaps the owner's review of revision 2 found by probing the SQL (docs/MIGRATION-019-REVIEW.md, section 'Review of revision 2'):
--   C2 a decision can only be INSERTED as a fresh 'open' decision;  C3 option removal is owner-marked, permanent, never the chosen option;
--   C4 an assignment's task must be a root task of that same bot;  C5 the history also covers creation, title, note, project and participants;
--   R1 progress/question reports are capped;  R2 a view cannot name its own option as the alternative, nor target a removed option.
--   C1 (INSERT OR REPLACE) cannot be fixed in SQL: it needs PRAGMA recursive_triggers = ON in openDatabase (src/db/database.ts), which ships with this migration.
--
-- Revision 2 was written after building the inbox/projects service and the Decisions service against it (docs/MIGRATION-019-REVIEW.md lists every change
-- and why). The aim: the database itself enforces what the owner required, so a bug in the service cannot break it:
--   * the history of a decision is complete and automatic (status changes, choices and option edits are recorded by triggers, not by the service);
--   * only the owner chooses, approves or rejects (columns that can only hold 'owner', owner-only history actions);
--   * a bot cannot approve its own proposal: nothing a bot writes can set those columns;
--   * a task is started at most once per assignment, a report is written at most once per task and kind;
--   * bots may disagree, but only in a bounded, reasoned way (stances with reasons, per-bot and per-decision limits, no replying to oneself).
-- Purely ADDITIVE: new tables only. A decision, an option or a bot's wording is UNTRUSTED TEXT; approving a decision grants no permission, folder,
-- program or secret, and every outside action its tasks need still waits for the normal approval gate.

-- ============================================================ decisions
CREATE TABLE decisions (
  id               TEXT PRIMARY KEY,
  project_id       TEXT REFERENCES projects(id),
  title            TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  question         TEXT NOT NULL DEFAULT '' CHECK (length(question) <= 4000),
  status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'chosen', 'approved', 'in_progress', 'done', 'rejected', 'archived')),
  chosen_option_id TEXT,
  chosen_by        TEXT CHECK (chosen_by IS NULL OR chosen_by = 'owner'),     -- only the owner can fill this
  approved_by      TEXT CHECK (approved_by IS NULL OR approved_by = 'owner'), -- only the owner can fill this
  approved_at      TEXT,
  owner_note       TEXT NOT NULL DEFAULT '' CHECK (length(owner_note) <= 4000),
  raised_by_bot_id TEXT REFERENCES bots(id),                                  -- NULL = the owner raised it
  source_kind      TEXT CHECK (source_kind IS NULL OR source_kind IN ('conversation', 'group', 'task', 'workflow_run', 'schedule', 'manual')),
  source_id        TEXT,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  -- COALESCE matters: a CHECK that evaluates to NULL passes in SQLite, so a missing owner mark must count as a failure.
  CHECK (chosen_option_id IS NULL OR COALESCE(chosen_by, '') = 'owner'),
  CHECK (status NOT IN ('approved', 'in_progress', 'done') OR (chosen_option_id IS NOT NULL AND approved_at IS NOT NULL AND COALESCE(approved_by, '') = 'owner')),
  CHECK (status NOT IN ('chosen') OR chosen_option_id IS NOT NULL)
);
CREATE INDEX idx_decisions_list ON decisions (status, updated_at);
CREATE INDEX idx_decisions_project ON decisions (project_id);
CREATE UNIQUE INDEX uq_decisions_source ON decisions (source_kind, source_id, title) WHERE source_kind IS NOT NULL AND source_id IS NOT NULL;

-- C2: a decision is born 'open' with no choice and no approval. Every later step is an UPDATE, so the allowed-moves rules below always apply.
CREATE TRIGGER trg_decisions_born_open BEFORE INSERT ON decisions
WHEN NEW.status <> 'open' OR NEW.chosen_option_id IS NOT NULL OR NEW.chosen_by IS NOT NULL OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'A decision starts open, with no choice and no approval.'); END;
CREATE TRIGGER trg_decisions_no_delete BEFORE DELETE ON decisions BEGIN SELECT RAISE(ABORT, 'Decisions are archived, never deleted.'); END;
CREATE TRIGGER trg_decisions_fixed BEFORE UPDATE OF id, created_at, raised_by_bot_id, question, source_kind, source_id ON decisions
BEGIN SELECT RAISE(ABORT, 'What was asked, who raised it and where it came from cannot be changed.'); END;

-- The only moves a decision may make. An approved decision never goes back, so what was approved stays what was approved.
CREATE TRIGGER trg_decisions_transitions BEFORE UPDATE OF status ON decisions
WHEN NEW.status <> OLD.status AND NOT (
     (OLD.status = 'open'        AND NEW.status IN ('chosen', 'rejected', 'archived'))
  OR (OLD.status = 'chosen'      AND NEW.status IN ('open', 'approved', 'rejected', 'archived'))
  OR (OLD.status = 'rejected'    AND NEW.status IN ('open', 'archived'))
  OR (OLD.status = 'approved'    AND NEW.status IN ('in_progress', 'done', 'archived'))
  OR (OLD.status = 'in_progress' AND NEW.status IN ('done', 'archived'))
  OR (OLD.status = 'done'        AND NEW.status = 'archived'))
BEGIN SELECT RAISE(ABORT, 'That change of status is not allowed.'); END;

CREATE TRIGGER trg_decisions_chosen_belongs BEFORE UPDATE OF chosen_option_id ON decisions WHEN NEW.chosen_option_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM decision_options o WHERE o.id = NEW.chosen_option_id AND o.decision_id = NEW.id AND o.removed_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'The chosen option must be an active option of this decision.'); END;
CREATE TRIGGER trg_decisions_choice_locked BEFORE UPDATE OF chosen_option_id ON decisions
WHEN OLD.status IN ('approved', 'in_progress', 'done') AND NEW.chosen_option_id IS NOT OLD.chosen_option_id
BEGIN SELECT RAISE(ABORT, 'An approved decision keeps the option that was approved.'); END;

-- Automatic, complete history of the decision itself (the service cannot forget to write it).
CREATE TRIGGER trg_decisions_history_status AFTER UPDATE OF status ON decisions WHEN NEW.status <> OLD.status
BEGIN
  INSERT INTO decision_revisions (decision_id, actor, action, detail, created_at)
  VALUES (NEW.id, CASE WHEN NEW.status IN ('approved', 'rejected') OR (NEW.status = 'chosen') THEN 'owner' ELSE 'system' END,
          CASE NEW.status WHEN 'approved' THEN 'approved' WHEN 'rejected' THEN 'rejected' WHEN 'archived' THEN 'archived' ELSE 'status' END,
          json_object('from', OLD.status, 'to', NEW.status, 'note', NEW.owner_note), NEW.updated_at);
END;
CREATE TRIGGER trg_decisions_history_choice AFTER UPDATE OF chosen_option_id ON decisions WHEN NEW.chosen_option_id IS NOT OLD.chosen_option_id
BEGIN
  INSERT INTO decision_revisions (decision_id, actor, action, detail, created_at)
  VALUES (NEW.id, 'owner', 'chosen', json_object('from', OLD.chosen_option_id, 'to', NEW.chosen_option_id), NEW.updated_at);
END;

CREATE TRIGGER trg_decisions_history_created AFTER INSERT ON decisions
BEGIN
  INSERT INTO decision_revisions (decision_id, actor, action, bot_id, detail, created_at)
  VALUES (NEW.id, CASE WHEN NEW.raised_by_bot_id IS NULL THEN 'owner' ELSE 'bot' END, 'created', NEW.raised_by_bot_id, json_object('title', NEW.title), NEW.created_at);
END;
CREATE TRIGGER trg_decisions_history_title AFTER UPDATE OF title ON decisions WHEN NEW.title <> OLD.title
BEGIN
  INSERT INTO decision_revisions (decision_id, actor, action, detail, created_at)
  VALUES (NEW.id, 'owner', 'retitled', json_object('before', OLD.title, 'after', NEW.title), NEW.updated_at);
END;
CREATE TRIGGER trg_decisions_history_note AFTER UPDATE OF owner_note ON decisions WHEN NEW.owner_note <> OLD.owner_note
BEGIN
  INSERT INTO decision_revisions (decision_id, actor, action, detail, created_at)
  VALUES (NEW.id, 'owner', 'note', json_object('before', OLD.owner_note, 'after', NEW.owner_note), NEW.updated_at);
END;
CREATE TRIGGER trg_decisions_history_project AFTER UPDATE OF project_id ON decisions WHEN NEW.project_id IS NOT OLD.project_id
BEGIN
  INSERT INTO decision_revisions (decision_id, actor, action, detail, created_at)
  VALUES (NEW.id, 'owner', 'project_linked', json_object('before', OLD.project_id, 'after', NEW.project_id), NEW.updated_at);
END;

-- ============================================================ participants: the bots asked to take part
CREATE TABLE decision_participants (
  decision_id  TEXT NOT NULL REFERENCES decisions(id),
  bot_id       TEXT NOT NULL REFERENCES bots(id),
  relevance    INTEGER NOT NULL DEFAULT 0 CHECK (relevance BETWEEN 0 AND 100),
  reason       TEXT NOT NULL DEFAULT '' CHECK (length(reason) <= 500),        -- why this bot was asked (its responsibilities that matched)
  added_by     TEXT NOT NULL CHECK (added_by IN ('system', 'owner')),
  added_at     TEXT NOT NULL,
  PRIMARY KEY (decision_id, bot_id)
);
CREATE INDEX idx_decision_participants_bot ON decision_participants (bot_id);
-- At most 5 bots take part in one decision, whoever adds them.
CREATE TRIGGER trg_decision_participants_cap BEFORE INSERT ON decision_participants
WHEN (SELECT COUNT(*) FROM decision_participants p WHERE p.decision_id = NEW.decision_id) >= 5
BEGIN SELECT RAISE(ABORT, 'At most 5 bots take part in one decision.'); END;
CREATE TRIGGER trg_decision_participants_no_delete BEFORE DELETE ON decision_participants BEGIN SELECT RAISE(ABORT, 'Participants are kept as history.'); END;
-- C5: a participant row is never re-pointed to another bot or rewritten.
CREATE TRIGGER trg_decision_participants_no_update BEFORE UPDATE ON decision_participants BEGIN SELECT RAISE(ABORT, 'A participant cannot be changed.'); END;
CREATE TRIGGER trg_decision_participants_history AFTER INSERT ON decision_participants
BEGIN
  INSERT INTO decision_revisions (decision_id, actor, action, bot_id, detail, created_at)
  VALUES (NEW.decision_id, NEW.added_by, 'participant_added', NEW.bot_id, json_object('reason', NEW.reason, 'relevance', NEW.relevance), NEW.added_at);
END;

-- ============================================================ options
CREATE TABLE decision_options (
  id                 TEXT PRIMARY KEY,
  decision_id        TEXT NOT NULL REFERENCES decisions(id),
  position           INTEGER NOT NULL CHECK (position BETWEEN 1 AND 12),
  title              TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
  details            TEXT NOT NULL DEFAULT '' CHECK (length(details) <= 4000),
  pros               TEXT NOT NULL DEFAULT '' CHECK (length(pros) <= 1000),
  cons               TEXT NOT NULL DEFAULT '' CHECK (length(cons) <= 1000),
  proposed_by_bot_id TEXT REFERENCES bots(id),                                -- NULL = written by the owner
  edited_by_owner    INTEGER NOT NULL DEFAULT 0 CHECK (edited_by_owner IN (0, 1)),
  removed_at         TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  UNIQUE (decision_id, position)
);
CREATE INDEX idx_decision_options_decision ON decision_options (decision_id, removed_at);
CREATE TRIGGER trg_decision_options_no_delete BEFORE DELETE ON decision_options BEGIN SELECT RAISE(ABORT, 'Options are removed (removed_at), not deleted.'); END;
-- A bot can only propose an option when it was asked to take part.
CREATE TRIGGER trg_decision_options_participant BEFORE INSERT ON decision_options WHEN NEW.proposed_by_bot_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM decision_participants p WHERE p.decision_id = NEW.decision_id AND p.bot_id = NEW.proposed_by_bot_id)
BEGIN SELECT RAISE(ABORT, 'Only a bot that was asked to take part can propose an option.'); END;
-- Options can only change while the decision is still being discussed; after approval they are frozen exactly as approved.
CREATE TRIGGER trg_decision_options_open_only_insert BEFORE INSERT ON decision_options
  WHEN (SELECT status FROM decisions d WHERE d.id = NEW.decision_id) NOT IN ('open', 'chosen')
BEGIN SELECT RAISE(ABORT, 'Options can only be added while the decision is open.'); END;
CREATE TRIGGER trg_decision_options_open_only_update BEFORE UPDATE ON decision_options
  WHEN (SELECT status FROM decisions d WHERE d.id = OLD.decision_id) NOT IN ('open', 'chosen')
BEGIN SELECT RAISE(ABORT, 'An approved decision keeps its options exactly as approved.'); END;
CREATE TRIGGER trg_decision_options_fixed BEFORE UPDATE OF id, decision_id, proposed_by_bot_id, created_at ON decision_options
BEGIN SELECT RAISE(ABORT, 'An option cannot be moved or re-attributed.'); END;
-- Only the owner rewrites an option (the service marks the row edited_by_owner = 1 when the owner does it).
CREATE TRIGGER trg_decision_options_owner_edits BEFORE UPDATE OF title, details, pros, cons ON decision_options
WHEN NEW.edited_by_owner = 0 AND (NEW.title <> OLD.title OR NEW.details <> OLD.details OR NEW.pros <> OLD.pros OR NEW.cons <> OLD.cons)
BEGIN SELECT RAISE(ABORT, 'Only the owner can edit an option.'); END;
-- C3: removing an option is the owner's act (marked edited_by_owner = 1), is permanent, and can never remove the option that is chosen.
CREATE TRIGGER trg_decision_options_removal_owner BEFORE UPDATE OF removed_at ON decision_options
WHEN OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL AND NEW.edited_by_owner = 0
BEGIN SELECT RAISE(ABORT, 'Only the owner can remove an option.'); END;
CREATE TRIGGER trg_decision_options_removal_permanent BEFORE UPDATE OF removed_at ON decision_options
WHEN OLD.removed_at IS NOT NULL AND NEW.removed_at IS NOT OLD.removed_at
BEGIN SELECT RAISE(ABORT, 'A removed option stays removed.'); END;
CREATE TRIGGER trg_decision_options_not_chosen BEFORE UPDATE OF removed_at ON decision_options
WHEN NEW.removed_at IS NOT NULL AND EXISTS (SELECT 1 FROM decisions d WHERE d.id = OLD.decision_id AND d.chosen_option_id = OLD.id)
BEGIN SELECT RAISE(ABORT, 'The chosen option cannot be removed. Clear the choice first.'); END;
-- Every edit, addition and removal is written to the history by the database itself, with the text as it was.
CREATE TRIGGER trg_decision_options_history_add AFTER INSERT ON decision_options
BEGIN
  INSERT INTO decision_revisions (decision_id, actor, action, bot_id, detail, created_at)
  VALUES (NEW.decision_id, CASE WHEN NEW.proposed_by_bot_id IS NULL THEN 'owner' ELSE 'bot' END, 'option_added', NEW.proposed_by_bot_id,
          json_object('option', NEW.id, 'title', NEW.title, 'details', NEW.details, 'pros', NEW.pros, 'cons', NEW.cons), NEW.created_at);
END;
CREATE TRIGGER trg_decision_options_history_edit AFTER UPDATE OF title, details, pros, cons ON decision_options
WHEN NEW.title <> OLD.title OR NEW.details <> OLD.details OR NEW.pros <> OLD.pros OR NEW.cons <> OLD.cons
BEGIN
  INSERT INTO decision_revisions (decision_id, actor, action, detail, created_at)
  VALUES (NEW.decision_id, 'owner', 'option_edited',
          json_object('option', NEW.id, 'before', json_object('title', OLD.title, 'details', OLD.details, 'pros', OLD.pros, 'cons', OLD.cons),
                      'after', json_object('title', NEW.title, 'details', NEW.details, 'pros', NEW.pros, 'cons', NEW.cons)), NEW.updated_at);
END;
CREATE TRIGGER trg_decision_options_history_remove AFTER UPDATE OF removed_at ON decision_options WHEN OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL
BEGIN
  INSERT INTO decision_revisions (decision_id, actor, action, detail, created_at)
  VALUES (NEW.decision_id, 'owner', 'option_removed', json_object('option', NEW.id, 'title', NEW.title), NEW.updated_at);
END;

-- ============================================================ views: constructive disagreement between bots
-- A bot says what it thinks of an option, with its reasons. It can support, raise a concern, oppose, or put forward an alternative. It can NEVER
-- decide anything: the owner reads the disagreement and chooses. Limits keep it from becoming a bot-to-bot argument.
CREATE TABLE decision_views (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id           TEXT NOT NULL REFERENCES decisions(id),
  option_id             TEXT NOT NULL REFERENCES decision_options(id),
  bot_id                TEXT NOT NULL REFERENCES bots(id),
  stance                TEXT NOT NULL CHECK (stance IN ('support', 'concern', 'oppose', 'alternative')),
  reasoning             TEXT NOT NULL CHECK (length(reasoning) BETWEEN 20 AND 2000),   -- a reason is required, a bare "no" is refused
  alternative_option_id TEXT REFERENCES decision_options(id),                           -- required exactly when the stance is 'alternative'
  reply_to_view_id      INTEGER REFERENCES decision_views(id),
  round                 INTEGER NOT NULL DEFAULT 1 CHECK (round BETWEEN 1 AND 2),      -- at most two rounds
  created_at            TEXT NOT NULL,
  CHECK ((stance = 'alternative') = (alternative_option_id IS NOT NULL)),
  CHECK (alternative_option_id IS NULL OR alternative_option_id <> option_id)               -- R2: an alternative is a DIFFERENT option
);
CREATE INDEX idx_decision_views_decision ON decision_views (decision_id, id);
CREATE UNIQUE INDEX uq_decision_views_once ON decision_views (decision_id, option_id, bot_id, round);   -- one view per bot, option and round
CREATE TRIGGER trg_decision_views_participant BEFORE INSERT ON decision_views
  WHEN NOT EXISTS (SELECT 1 FROM decision_participants p WHERE p.decision_id = NEW.decision_id AND p.bot_id = NEW.bot_id)
BEGIN SELECT RAISE(ABORT, 'Only a bot that was asked to take part can give a view.'); END;
CREATE TRIGGER trg_decision_views_open BEFORE INSERT ON decision_views
  WHEN (SELECT status FROM decisions d WHERE d.id = NEW.decision_id) NOT IN ('open', 'chosen')
BEGIN SELECT RAISE(ABORT, 'Views can only be given before the decision is approved.'); END;
CREATE TRIGGER trg_decision_views_same_decision BEFORE INSERT ON decision_views
  WHEN (SELECT o.decision_id FROM decision_options o WHERE o.id = NEW.option_id) IS NOT NEW.decision_id
    OR (NEW.alternative_option_id IS NOT NULL AND (SELECT o.decision_id FROM decision_options o WHERE o.id = NEW.alternative_option_id) IS NOT NEW.decision_id)
    OR (NEW.reply_to_view_id IS NOT NULL AND (SELECT v.decision_id FROM decision_views v WHERE v.id = NEW.reply_to_view_id) IS NOT NEW.decision_id)
BEGIN SELECT RAISE(ABORT, 'A view, its alternative and its reply must all belong to the same decision.'); END;
-- R2: no view about, or in favour of, an option that was removed.
CREATE TRIGGER trg_decision_views_active_options BEFORE INSERT ON decision_views
  WHEN (SELECT o.removed_at FROM decision_options o WHERE o.id = NEW.option_id) IS NOT NULL
    OR (NEW.alternative_option_id IS NOT NULL AND (SELECT o.removed_at FROM decision_options o WHERE o.id = NEW.alternative_option_id) IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'A view must be about options that are still on the table.'); END;
CREATE TRIGGER trg_decision_views_not_self BEFORE INSERT ON decision_views
  WHEN NEW.reply_to_view_id IS NOT NULL AND (SELECT v.bot_id FROM decision_views v WHERE v.id = NEW.reply_to_view_id) = NEW.bot_id
BEGIN SELECT RAISE(ABORT, 'A bot cannot reply to its own view.'); END;
-- Loop guard: a decision takes at most 30 views in total.
CREATE TRIGGER trg_decision_views_cap BEFORE INSERT ON decision_views
  WHEN (SELECT COUNT(*) FROM decision_views v WHERE v.decision_id = NEW.decision_id) >= 30
BEGIN SELECT RAISE(ABORT, 'This decision has reached its limit of views.'); END;
CREATE TRIGGER trg_decision_views_no_update BEFORE UPDATE ON decision_views BEGIN SELECT RAISE(ABORT, 'Views are append-only.'); END;
CREATE TRIGGER trg_decision_views_no_delete BEFORE DELETE ON decision_views BEGIN SELECT RAISE(ABORT, 'Views are append-only.'); END;

-- ============================================================ assignments: who does what once the OWNER approved
CREATE TABLE decision_assignments (
  decision_id  TEXT NOT NULL REFERENCES decisions(id),
  bot_id       TEXT NOT NULL REFERENCES bots(id),
  duty         TEXT NOT NULL CHECK (length(duty) BETWEEN 1 AND 1000),
  start_state  TEXT NOT NULL DEFAULT 'not_started' CHECK (start_state IN ('not_started', 'starting', 'started')),
  task_id      TEXT REFERENCES tasks(id),
  created_at   TEXT NOT NULL,
  PRIMARY KEY (decision_id, bot_id),
  CHECK ((start_state = 'started') = (task_id IS NOT NULL))
);
CREATE INDEX idx_decision_assignments_bot ON decision_assignments (bot_id);
CREATE UNIQUE INDEX uq_decision_assignments_task ON decision_assignments (task_id) WHERE task_id IS NOT NULL;   -- one task belongs to one assignment
-- Assigning needs an approved decision and a participant bot.
CREATE TRIGGER trg_decision_assignments_approved BEFORE INSERT ON decision_assignments
  WHEN (SELECT status FROM decisions d WHERE d.id = NEW.decision_id) NOT IN ('approved', 'in_progress')
BEGIN SELECT RAISE(ABORT, 'Work is only assigned for a decision the owner approved.'); END;
CREATE TRIGGER trg_decision_assignments_participant BEFORE INSERT ON decision_assignments
  WHEN NOT EXISTS (SELECT 1 FROM decision_participants p WHERE p.decision_id = NEW.decision_id AND p.bot_id = NEW.bot_id)
BEGIN SELECT RAISE(ABORT, 'Only a participating bot can be assigned.'); END;
-- Starting is claim-then-start: not_started -> starting -> started (task id set once), or back to not_started if the task could not be created.
-- A claim that is never released (a crash) stays 'starting': a retry can never create a second task. The owner is shown it as "stuck".
CREATE TRIGGER trg_decision_assignments_states BEFORE UPDATE OF start_state ON decision_assignments
WHEN NEW.start_state <> OLD.start_state AND NOT (
     (OLD.start_state = 'not_started' AND NEW.start_state = 'starting')
  OR (OLD.start_state = 'starting'    AND NEW.start_state IN ('started', 'not_started')))
BEGIN SELECT RAISE(ABORT, 'A task cannot be started twice for one assignment.'); END;
-- C4: the task of an assignment is a root task (started from outside, not a teammate sub-task) of THAT bot. It cannot be someone else's task.
CREATE TRIGGER trg_decision_assignments_task_is_bots BEFORE UPDATE OF task_id ON decision_assignments
WHEN NEW.task_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tasks t WHERE t.id = NEW.task_id AND t.assignee_bot_id = NEW.bot_id AND t.parent_id IS NULL)
BEGIN SELECT RAISE(ABORT, 'The task of an assignment must be a task of that bot.'); END;
CREATE TRIGGER trg_decision_assignments_task_once BEFORE UPDATE OF task_id ON decision_assignments
WHEN OLD.task_id IS NOT NULL AND NEW.task_id IS NOT OLD.task_id
BEGIN SELECT RAISE(ABORT, 'The task of an assignment cannot be replaced.'); END;
CREATE TRIGGER trg_decision_assignments_fixed BEFORE UPDATE OF decision_id, bot_id, duty ON decision_assignments
BEGIN SELECT RAISE(ABORT, 'An assignment cannot be changed after it was made.'); END;
CREATE TRIGGER trg_decision_assignments_no_delete BEFORE DELETE ON decision_assignments BEGIN SELECT RAISE(ABORT, 'Assignments are kept as history.'); END;
CREATE TRIGGER trg_decision_assignments_history AFTER INSERT ON decision_assignments
BEGIN
  INSERT INTO decision_revisions (decision_id, actor, action, bot_id, detail, created_at)
  VALUES (NEW.decision_id, 'system', 'assigned', NEW.bot_id, json_object('duty', NEW.duty), NEW.created_at);
END;

-- ============================================================ revisions: append-only history
CREATE TABLE decision_revisions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id  TEXT NOT NULL REFERENCES decisions(id),
  actor        TEXT NOT NULL CHECK (actor IN ('owner', 'bot', 'system')),
  bot_id       TEXT REFERENCES bots(id),
  action       TEXT NOT NULL CHECK (action IN ('created', 'option_added', 'option_edited', 'option_removed', 'chosen', 'approved', 'rejected', 'note', 'status', 'assigned', 'archived', 'view', 'started', 'reported', 'retitled', 'project_linked', 'participant_added')),
  detail       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail) AND json_type(detail) = 'object'),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_decision_revisions_decision ON decision_revisions (decision_id, id);
-- Choosing, approving and rejecting are the owner's alone: a revision for them with any other actor is refused.
CREATE TRIGGER trg_decision_revisions_owner_only BEFORE INSERT ON decision_revisions
WHEN NEW.action IN ('chosen', 'approved', 'rejected', 'option_edited', 'option_removed') AND NEW.actor <> 'owner'
BEGIN SELECT RAISE(ABORT, 'Only the owner chooses, approves, rejects or edits.'); END;
CREATE TRIGGER trg_decision_revisions_no_update BEFORE UPDATE ON decision_revisions BEGIN SELECT RAISE(ABORT, 'The decision history is append-only.'); END;
CREATE TRIGGER trg_decision_revisions_no_delete BEFORE DELETE ON decision_revisions BEGIN SELECT RAISE(ABORT, 'The decision history is append-only.'); END;
-- Every view a bot gives is part of the history.
CREATE TRIGGER trg_decision_views_history AFTER INSERT ON decision_views
BEGIN
  INSERT INTO decision_revisions (decision_id, actor, action, bot_id, detail, created_at)
  VALUES (NEW.decision_id, 'bot', 'view', NEW.bot_id, json_object('view', NEW.id, 'option', NEW.option_id, 'stance', NEW.stance, 'round', NEW.round), NEW.created_at);
END;

-- ============================================================ reports: bots reporting back on approved work
CREATE TABLE decision_reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  decision_id  TEXT NOT NULL REFERENCES decisions(id),
  bot_id       TEXT NOT NULL REFERENCES bots(id),
  kind         TEXT NOT NULL CHECK (kind IN ('progress', 'done', 'blocked', 'question')),
  message      TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 8000),
  task_id      TEXT REFERENCES tasks(id),
  created_at   TEXT NOT NULL,
  CHECK (kind NOT IN ('done', 'blocked') OR task_id IS NOT NULL)                         -- a result or a failure always points at a real task
);
CREATE INDEX idx_decision_reports_decision ON decision_reports (decision_id, id);
CREATE UNIQUE INDEX uq_decision_reports_task_kind ON decision_reports (task_id, kind) WHERE task_id IS NOT NULL;   -- one report per real task and kind
CREATE UNIQUE INDEX uq_decision_reports_done ON decision_reports (decision_id, bot_id) WHERE kind = 'done';          -- one "done" per bot and decision
CREATE TRIGGER trg_decision_reports_assigned BEFORE INSERT ON decision_reports
  WHEN NOT EXISTS (SELECT 1 FROM decision_assignments a WHERE a.decision_id = NEW.decision_id AND a.bot_id = NEW.bot_id)
BEGIN SELECT RAISE(ABORT, 'Only a bot assigned to this decision can report on it.'); END;
CREATE TRIGGER trg_decision_reports_task_matches BEFORE INSERT ON decision_reports WHEN NEW.task_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM decision_assignments a WHERE a.decision_id = NEW.decision_id AND a.bot_id = NEW.bot_id AND a.task_id = NEW.task_id)
BEGIN SELECT RAISE(ABORT, 'A report can only point at the task that was started for that bot and decision.'); END;
CREATE TRIGGER trg_decision_reports_approved BEFORE INSERT ON decision_reports
  WHEN (SELECT status FROM decisions d WHERE d.id = NEW.decision_id) NOT IN ('approved', 'in_progress', 'done')
BEGIN SELECT RAISE(ABORT, 'Reports are only accepted for an approved decision.'); END;
-- R1: a bot cannot flood a decision with progress notes or questions (results and failures are already limited to one per task).
CREATE TRIGGER trg_decision_reports_cap BEFORE INSERT ON decision_reports
WHEN NEW.kind IN ('progress', 'question')
  AND (SELECT COUNT(*) FROM decision_reports r WHERE r.decision_id = NEW.decision_id AND r.bot_id = NEW.bot_id AND r.kind IN ('progress', 'question')) >= 20
BEGIN SELECT RAISE(ABORT, 'This bot has reached its limit of progress notes and questions for this decision.'); END;
CREATE TRIGGER trg_decision_reports_no_update BEFORE UPDATE ON decision_reports BEGIN SELECT RAISE(ABORT, 'Reports are append-only.'); END;
CREATE TRIGGER trg_decision_reports_no_delete BEFORE DELETE ON decision_reports BEGIN SELECT RAISE(ABORT, 'Reports are append-only.'); END;
CREATE TRIGGER trg_decision_reports_history AFTER INSERT ON decision_reports
BEGIN
  INSERT INTO decision_revisions (decision_id, actor, action, bot_id, detail, created_at)
  VALUES (NEW.decision_id, 'bot', 'reported', NEW.bot_id, json_object('report', NEW.id, 'kind', NEW.kind, 'task', NEW.task_id), NEW.created_at);
END;
