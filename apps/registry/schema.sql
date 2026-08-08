-- Adapter registry schema (Cloudflare D1).
--
-- A pack is immutable once published. A new pack means a new version row, so
-- an installed digest always resolves to the same bytes.

CREATE TABLE IF NOT EXISTS adapters (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  homepage    TEXT,
  author      TEXT NOT NULL DEFAULT '',
  origins     TEXT NOT NULL,              -- JSON array
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
  adapter_id   TEXT NOT NULL REFERENCES adapters(id) ON DELETE CASCADE,
  version      TEXT NOT NULL,
  digest       TEXT NOT NULL,
  pack         TEXT NOT NULL,             -- canonical JSON, served verbatim
  capabilities TEXT NOT NULL,             -- JSON array
  tool_count   INTEGER NOT NULL DEFAULT 0,
  published_at INTEGER NOT NULL,
  PRIMARY KEY (adapter_id, version)
);

-- One row for each adapter, version and day. Counting rows instead would make
-- the table grow without bound for a popular adapter.
CREATE TABLE IF NOT EXISTS downloads (
  adapter_id TEXT NOT NULL,
  version    TEXT NOT NULL,
  day        TEXT NOT NULL,               -- YYYY-MM-DD, UTC
  count      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (adapter_id, version, day)
);

-- `voter` is a salted hash of the caller's install id. The registry never sees
-- the raw id, and the primary key makes a second vote an update.
CREATE TABLE IF NOT EXISTS ratings (
  adapter_id TEXT NOT NULL,
  voter      TEXT NOT NULL,
  score      INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (adapter_id, voter)
);

CREATE INDEX IF NOT EXISTS idx_versions_adapter  ON versions(adapter_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_downloads_adapter ON downloads(adapter_id);
CREATE INDEX IF NOT EXISTS idx_ratings_adapter   ON ratings(adapter_id);
