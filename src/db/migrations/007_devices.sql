-- Phase 11: paired devices (a phone that may use the dashboard remotely).
-- Only a hash of each device's secret is stored, never the secret itself.
CREATE TABLE devices (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  user_agent   TEXT,
  created_at   TEXT NOT NULL,
  created_ms   INTEGER NOT NULL,
  last_seen_ms INTEGER NOT NULL,
  revoked_at   TEXT
);

-- A revoked device stays in the list (as history) and can never be revived or renamed to something else.
CREATE TRIGGER devices_no_delete BEFORE DELETE ON devices
BEGIN
  SELECT RAISE(ABORT, 'devices cannot be deleted, only revoked');
END;

CREATE TRIGGER devices_no_revive BEFORE UPDATE OF revoked_at ON devices
WHEN OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at
BEGIN
  SELECT RAISE(ABORT, 'a revoked device cannot be revived');
END;

CREATE TRIGGER devices_token_fixed BEFORE UPDATE OF token_hash ON devices
BEGIN
  SELECT RAISE(ABORT, 'a device secret cannot be changed');
END;
