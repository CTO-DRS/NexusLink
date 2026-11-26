-- Nexus Link Cloud Mode (optional, opt-in). Cloudflare D1 / SQLite.
-- Privacy by design: no IP addresses, no user agents, no cookies are stored.
CREATE TABLE IF NOT EXISTS pages (
  handle      TEXT PRIMARY KEY,
  token_hash  TEXT NOT NULL,          -- SHA-256 of the owner token (the token itself is never stored)
  json        TEXT NOT NULL,          -- the published page (see index.mjs validatePage)
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  handle    TEXT NOT NULL,
  ts        INTEGER NOT NULL,          -- unix seconds
  kind      TEXT NOT NULL,             -- 'view' | 'click'
  link_id   TEXT,                      -- for clicks
  ref_host  TEXT,                      -- referrer host only, never the full URL
  country   TEXT,                      -- ISO-3166 alpha-2 from the edge, coarse
  hour      INTEGER NOT NULL           -- 0-23 UTC
);
CREATE INDEX IF NOT EXISTS events_handle_ts ON events(handle, ts);
CREATE TABLE IF NOT EXISTS leads (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  handle  TEXT NOT NULL,
  ts      INTEGER NOT NULL,
  value   TEXT NOT NULL                -- email or phone number the visitor chose to submit
);
CREATE INDEX IF NOT EXISTS leads_handle ON leads(handle, ts);
