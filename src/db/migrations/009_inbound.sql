-- Inbound messages: Telegram / Gmail messages that become text events (which can start bots through triggers).
-- Every source is created OFF, belongs to ONE bot (whose read permission is what authorises the reading), and polls slowly.
CREATE TABLE inbound_sources (
  id                   TEXT PRIMARY KEY,
  connector            TEXT NOT NULL CHECK (connector IN ('telegram', 'gmail')),
  bot_id               TEXT NOT NULL REFERENCES bots(id),
  event_name           TEXT NOT NULL,
  interval_minutes     INTEGER NOT NULL CHECK (interval_minutes >= 30 AND interval_minutes <= 1440),
  enabled              INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  last_poll_ms         INTEGER,
  last_new_count       INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  disabled_reason      TEXT,
  created_at           TEXT NOT NULL,
  UNIQUE (connector, bot_id)
);

-- Which messages were already handled, so a message is turned into an event once.
CREATE TABLE inbound_seen (
  source_id TEXT NOT NULL REFERENCES inbound_sources(id) ON DELETE CASCADE,
  item_key  TEXT NOT NULL,
  seen_ms   INTEGER NOT NULL,
  PRIMARY KEY (source_id, item_key)
);
