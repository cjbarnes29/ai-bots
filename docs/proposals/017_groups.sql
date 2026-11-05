-- PROPOSAL ONLY (revision 2, 2026-11-04, after the independent review in docs/MIGRATION-PROPOSAL-GROUPS.md section 10).
-- NOT a migration yet: this file is deliberately OUTSIDE src/db/migrations/ so the app never applies it.
-- On the owner's explicit approval it is copied unchanged to src/db/migrations/017_groups.sql and applied by the existing migration runner
-- (one transaction, recorded in schema_migrations; a failure rolls everything back and the app refuses to start).
--
-- Purely ADDITIVE: new tables, indexes and triggers only. No existing table, column, row, index, trigger or constraint is changed or removed.
-- The triggers below only fire on the NEW tables. They enforce in the database itself the rules the review found missing:
-- one active membership per bot and group, only active members (not observers) send, mentions and direct recipients are active members,
-- the coordinator is an active member, replies and events stay inside their own group, history is kept (no deletes, no rewrites),
-- and the search index cannot drift from the messages.

-- ============================================================ groups
CREATE TABLE bot_groups (
  id                    TEXT PRIMARY KEY,
  name                  TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description           TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 1000),
  avatar                TEXT NOT NULL DEFAULT '' CHECK (length(avatar) <= 16),          -- an emoji or short label; no uploads
  coordinator_bot_id    TEXT REFERENCES bots(id),                                          -- must be an ACTIVE member (trigger); NULL = the owner decides
  participation_mode    TEXT NOT NULL DEFAULT 'mention_only'
                        CHECK (participation_mode IN ('mention_only', 'relevant_bot', 'group_discussion', 'manager_coordinates', 'all_invited')),
  model_ref             TEXT CHECK (model_ref IS NULL OR length(model_ref) BETWEEN 3 AND 200), -- "provider/model" or "auto/<class>"; NULL = each bot's own
  max_rounds            INTEGER NOT NULL DEFAULT 6 CHECK (max_rounds BETWEEN 1 AND 20),   -- bot replies allowed after one owner message (loop guard)
  memory_mode           TEXT NOT NULL DEFAULT 'none' CHECK (memory_mode IN ('none', 'group')),
  paused                INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
  archived              INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  last_read_message_id  INTEGER CHECK (last_read_message_id IS NULL OR last_read_message_id >= 0), -- the owner's read marker (unread counts, notifications)
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);
CREATE INDEX idx_bot_groups_active ON bot_groups (archived, updated_at);

-- Groups are archived, never deleted (like bots).
CREATE TRIGGER trg_bot_groups_no_delete BEFORE DELETE ON bot_groups
BEGIN SELECT RAISE(ABORT, 'Groups are archived, never deleted.'); END;
-- A coordinator can only be named once it is a member: a new group starts without one.
CREATE TRIGGER trg_bot_groups_coordinator_insert BEFORE INSERT ON bot_groups WHEN NEW.coordinator_bot_id IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'Add the coordinator as a member first, then set it.'); END;
CREATE TRIGGER trg_bot_groups_coordinator_update BEFORE UPDATE OF coordinator_bot_id ON bot_groups
WHEN NEW.coordinator_bot_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM group_members m WHERE m.group_id = NEW.id AND m.bot_id = NEW.coordinator_bot_id AND m.removed_at IS NULL AND m.role <> 'observer')
BEGIN SELECT RAISE(ABORT, 'The coordinator must be an active member of the group (not an observer).'); END;

-- ============================================================ members (history kept: removal sets removed_at)
CREATE TABLE group_members (
  group_id    TEXT NOT NULL REFERENCES bot_groups(id),
  bot_id      TEXT NOT NULL REFERENCES bots(id),
  role        TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'reviewer', 'observer')), -- observer: may read, never posts
  added_at    TEXT NOT NULL,
  removed_at  TEXT CHECK (removed_at IS NULL OR removed_at >= added_at),
  PRIMARY KEY (group_id, bot_id, added_at)
);
-- At most ONE active membership per bot and group (a removed bot can be added again as a new row).
CREATE UNIQUE INDEX uq_group_members_active ON group_members (group_id, bot_id) WHERE removed_at IS NULL;
CREATE INDEX idx_group_members_bot ON group_members (bot_id, removed_at);
CREATE INDEX idx_group_members_group ON group_members (group_id, removed_at);

CREATE TRIGGER trg_group_members_no_delete BEFORE DELETE ON group_members
BEGIN SELECT RAISE(ABORT, 'Membership history is kept: set removed_at instead of deleting.'); END;
CREATE TRIGGER trg_group_members_fixed BEFORE UPDATE OF group_id, bot_id, added_at ON group_members
BEGIN SELECT RAISE(ABORT, 'A membership row cannot be moved to another group, bot or date.'); END;
CREATE TRIGGER trg_group_members_no_reopen BEFORE UPDATE OF removed_at ON group_members WHEN OLD.removed_at IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'A removed membership stays removed: add the bot again as a new membership.'); END;
-- The coordinator cannot be removed or turned into an observer while it is the coordinator.
CREATE TRIGGER trg_group_members_coordinator_stays BEFORE UPDATE OF removed_at, role ON group_members
WHEN (NEW.removed_at IS NOT NULL OR NEW.role = 'observer')
  AND EXISTS (SELECT 1 FROM bot_groups g WHERE g.id = NEW.group_id AND g.coordinator_bot_id = NEW.bot_id)
BEGIN SELECT RAISE(ABORT, 'Choose another coordinator (or none) before removing this bot or making it an observer.'); END;

-- ============================================================ messages (kept; only the owner can blank one, e.g. a pasted secret)
CREATE TABLE group_messages (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id          TEXT NOT NULL REFERENCES bot_groups(id),
  sender_kind       TEXT NOT NULL CHECK (sender_kind IN ('user', 'bot', 'system')),
  sender_bot_id     TEXT REFERENCES bots(id),
  visibility        TEXT NOT NULL DEFAULT 'group' CHECK (visibility IN ('group', 'direct')),
  recipient_bot_id  TEXT REFERENCES bots(id),                                          -- only for a direct message to one bot
  reply_to          INTEGER REFERENCES group_messages(id),
  kind              TEXT NOT NULL DEFAULT 'message'
                    CHECK (kind IN ('message', 'handoff', 'review', 'challenge', 'clarification', 'escalation', 'task_result', 'summary', 'notice')),
  content           TEXT NOT NULL CHECK (length(content) <= 50000),
  attachments       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(attachments) AND json_type(attachments) = 'array'), -- references to files in approved folders, never file contents
  task_id           TEXT REFERENCES tasks(id),
  provider_id       TEXT,
  model_id          TEXT,
  redacted_at       TEXT,                                                              -- set when the owner blanked the content
  created_at        TEXT NOT NULL,
  CHECK ((sender_kind = 'bot' AND sender_bot_id IS NOT NULL) OR (sender_kind <> 'bot' AND sender_bot_id IS NULL)),
  CHECK ((visibility = 'direct' AND recipient_bot_id IS NOT NULL) OR (visibility = 'group' AND recipient_bot_id IS NULL)),
  CHECK (recipient_bot_id IS NULL OR sender_bot_id IS NULL OR recipient_bot_id <> sender_bot_id)
);
CREATE INDEX idx_group_messages_group ON group_messages (group_id, id);
CREATE INDEX idx_group_messages_task ON group_messages (task_id);
CREATE INDEX idx_group_messages_reply ON group_messages (reply_to);
CREATE INDEX idx_group_messages_recipient ON group_messages (recipient_bot_id, id) WHERE recipient_bot_id IS NOT NULL;

CREATE TRIGGER trg_group_messages_sender BEFORE INSERT ON group_messages WHEN NEW.sender_kind = 'bot' AND NOT EXISTS (
  SELECT 1 FROM group_members m WHERE m.group_id = NEW.group_id AND m.bot_id = NEW.sender_bot_id AND m.removed_at IS NULL AND m.role <> 'observer')
BEGIN SELECT RAISE(ABORT, 'Only active members of the group (not observers) can post in it.'); END;
CREATE TRIGGER trg_group_messages_recipient BEFORE INSERT ON group_messages WHEN NEW.recipient_bot_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM group_members m WHERE m.group_id = NEW.group_id AND m.bot_id = NEW.recipient_bot_id AND m.removed_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'A direct message can only go to an active member of the group.'); END;
CREATE TRIGGER trg_group_messages_reply_same_group BEFORE INSERT ON group_messages WHEN NEW.reply_to IS NOT NULL
  AND (SELECT r.group_id FROM group_messages r WHERE r.id = NEW.reply_to) IS NOT NEW.group_id
BEGIN SELECT RAISE(ABORT, 'A reply must be to a message in the same group.'); END;
CREATE TRIGGER trg_group_messages_no_delete BEFORE DELETE ON group_messages
BEGIN SELECT RAISE(ABORT, 'Group messages are kept. The owner can blank one (redact) instead.'); END;
-- The only change allowed: the owner blanks the content once (for example a secret pasted by mistake). Nothing else can be rewritten.
CREATE TRIGGER trg_group_messages_only_redact BEFORE UPDATE ON group_messages WHEN NOT (
  OLD.redacted_at IS NULL AND NEW.redacted_at IS NOT NULL AND NEW.content = '[removed by the owner]' AND NEW.attachments = '[]'
  AND NEW.id = OLD.id AND NEW.group_id IS OLD.group_id AND NEW.sender_kind IS OLD.sender_kind AND NEW.sender_bot_id IS OLD.sender_bot_id
  AND NEW.visibility IS OLD.visibility AND NEW.recipient_bot_id IS OLD.recipient_bot_id AND NEW.reply_to IS OLD.reply_to
  AND NEW.kind IS OLD.kind AND NEW.task_id IS OLD.task_id AND NEW.provider_id IS OLD.provider_id AND NEW.model_id IS OLD.model_id
  AND NEW.created_at IS OLD.created_at)
BEGIN SELECT RAISE(ABORT, 'Group messages cannot be rewritten. The owner can only blank one, once.'); END;

-- Search: an FTS5 index over the message table itself, kept in step by triggers, so it can never drift (and a blanked message leaves the index).
CREATE VIRTUAL TABLE group_messages_fts USING fts5(content, content = 'group_messages', content_rowid = 'id');
CREATE TRIGGER trg_group_messages_fts_insert AFTER INSERT ON group_messages
BEGIN INSERT INTO group_messages_fts (rowid, content) VALUES (NEW.id, NEW.content); END;
CREATE TRIGGER trg_group_messages_fts_redact AFTER UPDATE OF content ON group_messages
BEGIN
  INSERT INTO group_messages_fts (group_messages_fts, rowid, content) VALUES ('delete', OLD.id, OLD.content);
  INSERT INTO group_messages_fts (rowid, content) VALUES (NEW.id, NEW.content);
END;

-- Who a message mentions (@Bot). A table, not a JSON list, so every mention is a real, ACTIVE member of that group, and "messages mentioning bot X" is an index lookup.
CREATE TABLE group_message_mentions (
  message_id  INTEGER NOT NULL REFERENCES group_messages(id),
  bot_id      TEXT NOT NULL REFERENCES bots(id),
  PRIMARY KEY (message_id, bot_id)
);
CREATE INDEX idx_group_mentions_bot ON group_message_mentions (bot_id, message_id);
CREATE TRIGGER trg_group_mentions_member BEFORE INSERT ON group_message_mentions WHEN NOT EXISTS (
  SELECT 1 FROM group_messages msg JOIN group_members m ON m.group_id = msg.group_id
  WHERE msg.id = NEW.message_id AND m.bot_id = NEW.bot_id AND m.removed_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'Only an active member of the group can be mentioned.'); END;
CREATE TRIGGER trg_group_mentions_no_delete BEFORE DELETE ON group_message_mentions
BEGIN SELECT RAISE(ABORT, 'Mentions are part of the kept conversation.'); END;
CREATE TRIGGER trg_group_mentions_no_update BEFORE UPDATE ON group_message_mentions
BEGIN SELECT RAISE(ABORT, 'Mentions cannot be rewritten.'); END;

-- ============================================================ group memory (visible to ONE group's members only; enforced by the service)
CREATE TABLE group_memory (
  id           TEXT PRIMARY KEY,
  group_id     TEXT NOT NULL REFERENCES bot_groups(id),
  title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 100),
  content      TEXT NOT NULL CHECK (length(content) <= 4000),
  tags         TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags) AND json_type(tags) = 'array'),
  source       TEXT NOT NULL CHECK (source IN ('owner', 'bot')),
  approval_id  TEXT REFERENCES approval_requests(id),                                  -- a note a bot proposed exists only after the owner approved it
  pinned       INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  archived     INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  CHECK (source = 'owner' OR approval_id IS NOT NULL)
);
CREATE INDEX idx_group_memory_group ON group_memory (group_id, archived);
CREATE TRIGGER trg_group_memory_no_delete BEFORE DELETE ON group_memory
BEGIN SELECT RAISE(ABORT, 'Group notes are archived, not deleted.'); END;

-- ============================================================ bot-to-bot events (append-only audit of handoffs, reviews, escalations, guards)
CREATE TABLE group_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id     TEXT NOT NULL REFERENCES bot_groups(id),
  kind         TEXT NOT NULL CHECK (kind IN (
                 'assign', 'transfer', 'review', 'challenge', 'escalate', 'clarify', 'handoff_accepted', 'handoff_declined',
                 'blocked_loop', 'blocked_duplicate', 'blocked_permission', 'member_added', 'member_removed', 'coordinator_changed',
                 'settings_changed', 'memory_added', 'memory_archived', 'paused', 'resumed', 'stopped')),
  from_bot_id  TEXT REFERENCES bots(id),
  to_bot_id    TEXT REFERENCES bots(id),                                               -- NULL when escalating to the Manager AI or the owner
  task_id      TEXT REFERENCES tasks(id),
  message_id   INTEGER REFERENCES group_messages(id),
  detail       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail) AND json_type(detail) = 'object'),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_group_events_group ON group_events (group_id, id);
CREATE INDEX idx_group_events_task ON group_events (task_id);
CREATE TRIGGER trg_group_events_message_same_group BEFORE INSERT ON group_events WHEN NEW.message_id IS NOT NULL
  AND (SELECT msg.group_id FROM group_messages msg WHERE msg.id = NEW.message_id) IS NOT NEW.group_id
BEGIN SELECT RAISE(ABORT, 'An event can only point at a message of the same group.'); END;
-- Bots named in an event must have been members of that group at some time (history allows events about a bot that was later removed).
CREATE TRIGGER trg_group_events_bots_belong BEFORE INSERT ON group_events
WHEN (NEW.from_bot_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = NEW.group_id AND m.bot_id = NEW.from_bot_id))
  OR (NEW.to_bot_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM group_members m WHERE m.group_id = NEW.group_id AND m.bot_id = NEW.to_bot_id))
BEGIN SELECT RAISE(ABORT, 'An event can only name bots that belong (or belonged) to the group.'); END;
CREATE TRIGGER trg_group_events_no_delete BEFORE DELETE ON group_events
BEGIN SELECT RAISE(ABORT, 'Group events are an append-only record.'); END;
CREATE TRIGGER trg_group_events_no_update BEFORE UPDATE ON group_events
BEGIN SELECT RAISE(ABORT, 'Group events are an append-only record.'); END;
