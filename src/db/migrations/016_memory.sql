-- Stage 8: memory and knowledge.
-- A note is either PRIVATE to one bot or SHARED. Only the owner creates or promotes shared notes; a bot can only ask (with approval) to remember something privately.
CREATE TABLE memory_notes (
  id         TEXT PRIMARY KEY,
  scope      TEXT NOT NULL CHECK (scope IN ('bot', 'shared')),
  bot_id     TEXT REFERENCES bots(id),
  title      TEXT NOT NULL,
  content    TEXT NOT NULL,
  tags       TEXT NOT NULL DEFAULT '[]',
  source     TEXT NOT NULL CHECK (source IN ('owner', 'bot', 'import')),
  pinned     INTEGER NOT NULL DEFAULT 0,
  archived   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK ((scope = 'bot' AND bot_id IS NOT NULL) OR (scope = 'shared' AND bot_id IS NULL))
);
CREATE INDEX idx_memory_scope ON memory_notes (scope, bot_id, archived);

-- Full-text search over the notes (kept in step by the service, in the same transaction).
CREATE VIRTUAL TABLE memory_fts USING fts5(title, content, tags, note_id UNINDEXED);

-- Per bot: may it use its own notes (default yes) and the shared knowledge (default NO)?
CREATE TABLE memory_bots (
  bot_id      TEXT PRIMARY KEY REFERENCES bots(id),
  use_private INTEGER NOT NULL DEFAULT 1,
  use_shared  INTEGER NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL
);
