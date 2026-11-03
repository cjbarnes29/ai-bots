-- Phase 2: test chat history. Messages are never edited or deleted.

CREATE TABLE conversations (
  id         TEXT PRIMARY KEY,
  bot_id     TEXT NOT NULL REFERENCES bots(id),
  title      TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_conversations_bot ON conversations (bot_id, created_at);

CREATE TABLE chat_messages (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id  TEXT NOT NULL REFERENCES conversations(id),
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content          TEXT NOT NULL,
  bot_version      INTEGER NOT NULL,            -- which version of the bot this message used
  provider_id      TEXT,
  model_id         TEXT,
  input_tokens     INTEGER,
  output_tokens    INTEGER,
  tokens_estimated INTEGER,
  created_at       TEXT NOT NULL
);
CREATE INDEX idx_chat_messages_conv ON chat_messages (conversation_id, id);

CREATE TRIGGER chat_messages_no_update BEFORE UPDATE ON chat_messages
BEGIN
  SELECT RAISE(ABORT, 'chat_messages is append-only');
END;
CREATE TRIGGER chat_messages_no_delete BEFORE DELETE ON chat_messages
BEGIN
  SELECT RAISE(ABORT, 'chat_messages is append-only');
END;
CREATE TRIGGER conversations_no_delete BEFORE DELETE ON conversations
BEGIN
  SELECT RAISE(ABORT, 'conversations cannot be deleted');
END;
