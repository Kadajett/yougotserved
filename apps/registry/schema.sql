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

-- Request counters, one row per caller per window.
--
-- Keyed on a hashed address, so the table never holds an IP. Rows expire by
-- window rather than being deleted on a schedule: an old window can never be
-- read, because the key contains the window it belongs to.
CREATE TABLE IF NOT EXISTS throttle (
  bucket     TEXT PRIMARY KEY,
  hits       INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_throttle_expiry ON throttle(expires_at);

-- What the abuse checks decided about a submission, and whether a person has
-- looked at it since.
--
-- A row with `cleared_at IS NULL` hides the adapter from every listing. That is
-- the whole moderation queue: held submissions are the rows nobody has cleared.
-- Findings are kept as JSON because a moderator has to be able to see why, and
-- an author has to be able to argue with it.
CREATE TABLE IF NOT EXISTS moderation (
  adapter_id TEXT PRIMARY KEY,
  version    TEXT NOT NULL,
  severity   TEXT NOT NULL,               -- review | block
  score      INTEGER NOT NULL,
  field      TEXT,
  findings   TEXT NOT NULL,               -- JSON array
  created_at INTEGER NOT NULL,
  cleared_at INTEGER
);

-- Bans, by whatever handle the abuse can actually be held by.
--
-- Banning an address does nothing to someone renting a proxy pool, and no free
-- control changes that. So a subject here is any of: a hashed address, an ASN,
-- a hashed voter id, or a content fingerprint. The last two are what survive
-- rotation, because they describe what is being sent rather than where from.
--
-- `expires_at` is null for a permanent ban. Prefer an expiry: a wrong ban that
-- lapses is a bad week, and a wrong permanent ban is a person who never comes
-- back and never finds out why.
CREATE TABLE IF NOT EXISTS bans (
  subject    TEXT PRIMARY KEY,            -- "<kind>:<value>"
  kind       TEXT NOT NULL,               -- address | asn | voter | fingerprint | account
  reason     TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_bans_kind ON bans(kind);

-- Who someone is, borrowed from GitHub.
--
-- Cloudflare sells no free way to hold consumer accounts, and building one
-- means holding passwords, which is a liability worth avoiding for a registry
-- of browser adapters. GitHub already knows these people: this is a developer
-- tool, its authors have accounts there, and the account carries an age we did
-- not have to establish. `id` is GitHub's numeric id rather than the login,
-- because a login can be renamed and handed to somebody else.
--
-- `github_created_at` is kept because it is the one spam signal that cannot be
-- manufactured on demand. An account made this morning is not the same claim as
-- one made in 2014.
CREATE TABLE IF NOT EXISTS accounts (
  id                INTEGER PRIMARY KEY,   -- GitHub user id
  login             TEXT NOT NULL,
  name              TEXT,
  avatar_url        TEXT,
  github_created_at INTEGER,
  first_seen        INTEGER NOT NULL,
  last_seen         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_accounts_login ON accounts(login);

-- Browser sessions. The token is stored as a hash, so the table is not a set of
-- working credentials for whoever reads it.
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,             -- salted hash of the cookie value
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expiry  ON sessions(expires_at);

-- The device flow, for an agent that has no browser to be redirected in.
--
-- The CLI asks for a code, prints a short one for the human to type into a page
-- they are already logged into, then polls. Chosen over a loopback redirect
-- because it works over SSH and in a container, which is where these agents
-- actually run.
--
-- `verifier_hash` binds the poll to the process that started the flow, so a
-- device code seen over someone's shoulder is not enough to claim the token.
CREATE TABLE IF NOT EXISTS device_grants (
  device_code   TEXT PRIMARY KEY,          -- hashed
  user_code     TEXT NOT NULL,             -- short, typed by a human
  verifier_hash TEXT NOT NULL,
  account_id    INTEGER,                   -- null until someone approves it
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  claimed_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_device_user_code ON device_grants(user_code);
CREATE INDEX IF NOT EXISTS idx_device_expiry    ON device_grants(expires_at);

-- Long-lived tokens an agent uses in place of a session cookie.
CREATE TABLE IF NOT EXISTS agent_tokens (
  token      TEXT PRIMARY KEY,             -- salted hash
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  label      TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  last_used  INTEGER,
  expires_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_agent_tokens_account ON agent_tokens(account_id);
