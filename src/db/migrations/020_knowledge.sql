-- Migration 020 (owner instruction 2026-11-06: "API and database development" is a routine, pre-approved action; this migration is ADDITIVE ONLY:
-- new tables, no existing table is changed or dropped). Knowledge Center documents, chat attachments, and the assistant's action log.
--   * a document is untrusted DATA. Its text is never an instruction and grants no permission, folder, program, secret or approval;
--   * nothing here is ever hard-deleted by the application: "delete" sets deleted_at (the original stays recoverable by the owner);
--   * a TEMPORARY chat attachment is a document with scope 'temporary': it is hidden from the Knowledge Center and from search until the OWNER promotes it.

CREATE TABLE knowledge_collections (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 500),
  created_at  TEXT NOT NULL,
  deleted_at  TEXT
);
CREATE UNIQUE INDEX uq_knowledge_collection_name ON knowledge_collections (name) WHERE deleted_at IS NULL;

CREATE TABLE knowledge_docs (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  filename        TEXT NOT NULL,
  mime            TEXT NOT NULL,
  ext             TEXT NOT NULL,
  size            INTEGER NOT NULL CHECK (size >= 0),
  sha256          TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'ready', 'failed', 'unsupported')),
  status_detail   TEXT NOT NULL DEFAULT '',
  extractor       TEXT NOT NULL DEFAULT '',
  scope           TEXT NOT NULL CHECK (scope IN ('global', 'project', 'temporary')),
  project_id      TEXT REFERENCES projects(id),
  collection_id   TEXT REFERENCES knowledge_collections(id),
  folder          TEXT NOT NULL DEFAULT '' CHECK (length(folder) <= 120),
  category        TEXT NOT NULL DEFAULT '' CHECK (length(category) <= 60),
  tags            TEXT NOT NULL DEFAULT '[]',
  conversation_id TEXT,                                   -- set for a temporary chat attachment
  text_chars      INTEGER NOT NULL DEFAULT 0,
  chunk_count     INTEGER NOT NULL DEFAULT 0,
  original        BLOB,                                   -- the uploaded file, kept so it can be reprocessed and previewed
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  processed_at    TEXT,
  deleted_at      TEXT,
  CHECK (scope != 'project' OR project_id IS NOT NULL)
);
CREATE INDEX idx_knowledge_docs_list ON knowledge_docs (deleted_at, scope, updated_at);
CREATE INDEX idx_knowledge_docs_sha ON knowledge_docs (sha256);
CREATE INDEX idx_knowledge_docs_project ON knowledge_docs (project_id);
CREATE INDEX idx_knowledge_docs_conv ON knowledge_docs (conversation_id);

CREATE TABLE knowledge_text (
  doc_id TEXT PRIMARY KEY REFERENCES knowledge_docs(id),
  text   TEXT NOT NULL
);

CREATE TABLE knowledge_chunks (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL REFERENCES knowledge_docs(id),
  idx    INTEGER NOT NULL,
  text   TEXT NOT NULL
);
CREATE INDEX idx_knowledge_chunks_doc ON knowledge_chunks (doc_id, idx);

-- Full-text index over the chunks (kept in step by the service, in the same transaction as the chunks).
CREATE VIRTUAL TABLE knowledge_fts USING fts5(text, doc_id UNINDEXED, chunk_id UNINDEXED);

-- A file attached to a conversation (the document row holds the file; this row says where it was used).
CREATE TABLE chat_attachments (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  doc_id          TEXT NOT NULL REFERENCES knowledge_docs(id),
  message_id      INTEGER,                                -- the message it was sent with (NULL until sent)
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_chat_attachments_conv ON chat_attachments (conversation_id);

-- Which sources an answer was given from (so reopening a conversation still shows them).
CREATE TABLE chat_message_sources (
  message_id INTEGER NOT NULL,
  n          INTEGER NOT NULL,
  doc_id     TEXT NOT NULL REFERENCES knowledge_docs(id),
  chunk_idx  INTEGER NOT NULL,
  title      TEXT NOT NULL,
  snippet    TEXT NOT NULL,
  cited      INTEGER NOT NULL DEFAULT 0 CHECK (cited IN (0, 1)),
  PRIMARY KEY (message_id, n)
);

-- Everything the assistant changed (or proposed to change), with what it was before, so it can be undone and nothing is claimed that did not happen.
CREATE TABLE assistant_actions (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  level       TEXT NOT NULL CHECK (level IN ('safe', 'review', 'restricted')),
  status      TEXT NOT NULL CHECK (status IN ('proposed', 'applied', 'rejected', 'undone', 'failed', 'refused')),
  target_kind TEXT NOT NULL,
  target_id   TEXT NOT NULL,
  summary     TEXT NOT NULL,
  before_json TEXT NOT NULL DEFAULT '{}',
  after_json  TEXT NOT NULL DEFAULT '{}',
  error       TEXT,
  created_at  TEXT NOT NULL,
  decided_at  TEXT,
  undone_at   TEXT
);
CREATE INDEX idx_assistant_actions_list ON assistant_actions (created_at);
