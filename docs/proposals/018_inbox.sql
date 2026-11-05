-- PROPOSAL ONLY (2026-11-05). NOT a migration: this file is deliberately OUTSIDE src/db/migrations/ so the app never applies it.
-- On the owner's explicit approval it is copied unchanged to src/db/migrations/018_inbox.sql (same process as 017: backup, rehearsal on a scratch copy, app stopped).
--
-- Purely ADDITIVE: new tables only. conversations and chat_messages (003) are NOT altered, so their append-only triggers stay as they are.
-- Why not just use them: a conversation cannot be deleted or renamed-with-history, there is no unread/pinned/muted state, and nothing records
-- WHY a bot wrote first. Everything the inbox needs on top is kept here, next to them.

-- Per-conversation state of the OWNER's inbox. One row per conversation, created the first time the owner pins, mutes, archives, renames,
-- hides or reads it. No row = defaults (unpinned, unmuted, visible, nothing read yet).
CREATE TABLE inbox_conversation_state (
  conversation_id       TEXT PRIMARY KEY REFERENCES conversations(id),
  title_override        TEXT CHECK (title_override IS NULL OR length(title_override) BETWEEN 1 AND 120), -- rename; the original title stays in conversations
  pinned                INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  muted                 INTEGER NOT NULL DEFAULT 0 CHECK (muted IN (0, 1)),
  archived              INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  hidden_at             TEXT,                                          -- "delete" = hide from every list; the messages are kept (history is never destroyed)
  last_read_message_id  INTEGER NOT NULL DEFAULT 0 CHECK (last_read_message_id >= 0), -- unread = messages with a greater id from the bot
  updated_at            TEXT NOT NULL
);

-- Why a bot message exists. A bot message in the inbox is ONLY written by code that holds a real event (a finished task, a failed run,
-- an approval request, an explicit "message the owner" action), and that event is recorded here. No row = the owner's own conversation turn.
CREATE TABLE inbox_message_meta (
  message_id    INTEGER PRIMARY KEY REFERENCES chat_messages(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  bot_id        TEXT NOT NULL REFERENCES bots(id),
  initiated     INTEGER NOT NULL CHECK (initiated IN (0, 1)),         -- 1 = the bot wrote first (not a reply to the owner)
  kind          TEXT NOT NULL CHECK (kind IN ('task_result', 'task_failed', 'approval_needed', 'automation_failed', 'clarification', 'report', 'note')),
  importance    TEXT NOT NULL DEFAULT 'normal' CHECK (importance IN ('normal', 'important')),
  source_kind   TEXT NOT NULL CHECK (source_kind IN ('task', 'approval', 'schedule', 'workflow_run', 'trigger', 'bot_action')),
  source_id     TEXT NOT NULL,                                        -- the id of that real event
  created_at    TEXT NOT NULL,
  UNIQUE (source_kind, source_id, kind)                               -- one message per real event and kind: a retry cannot post it twice
);
CREATE INDEX idx_inbox_meta_conv ON inbox_message_meta (conversation_id, message_id);
CREATE INDEX idx_inbox_meta_bot_time ON inbox_message_meta (bot_id, created_at);   -- the anti-spam count per bot and hour

-- Notification choices. bot_id NULL = the default for every bot; a row with a bot_id overrides it for that bot.
CREATE TABLE inbox_preferences (
  bot_id            TEXT REFERENCES bots(id),
  notify            TEXT NOT NULL DEFAULT 'important' CHECK (notify IN ('all', 'important', 'none')),
  max_per_hour      INTEGER NOT NULL DEFAULT 6 CHECK (max_per_hour BETWEEN 1 AND 60),   -- initiated messages per bot per hour; the rest are held back and counted
  updated_at        TEXT NOT NULL
);
CREATE UNIQUE INDEX uq_inbox_preferences_bot ON inbox_preferences (COALESCE(bot_id, ''));

-- Messages a bot wanted to send but the hourly cap held back (kept so nothing is silently lost; shown as "N held back").
CREATE TABLE inbox_held_back (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  bot_id      TEXT NOT NULL REFERENCES bots(id),
  source_kind TEXT NOT NULL,
  source_id   TEXT NOT NULL,
  kind        TEXT NOT NULL,
  reason      TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_inbox_held_bot ON inbox_held_back (bot_id, created_at);
