-- Phone alerts (Web Push). A subscription is just the address of the browser's push service for one device.
-- Alerts carry NO content: the phone is only told "something needs you" and then asks the app (with its own sign-in) what.
CREATE TABLE push_subscriptions (
  id         TEXT PRIMARY KEY,
  device_id  TEXT REFERENCES devices(id),     -- the paired phone, or NULL for the PC itself
  endpoint   TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);
