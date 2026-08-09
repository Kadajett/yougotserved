/**
 * Identity, borrowed from GitHub.
 *
 * The registry needs to know who submitted something, for two reasons that pull
 * in the same direction. Public submissions need an author who can be held to
 * them, and a ban needs a subject that survives an address change. Everything
 * else here is downstream of those two.
 *
 * GitHub rather than our own accounts, because our own accounts means holding
 * passwords, and a registry of browser adapters has no business doing that.
 * GitHub rather than Cloudflare, because Cloudflare sells no free way to hold
 * consumer accounts: Access is for gating your own team, not for letting the
 * public sign up. And GitHub specifically, because this is a developer tool
 * whose authors already have accounts there, carrying an age we would otherwise
 * have to establish ourselves.
 *
 * Two flows out of one OAuth app. A browser gets redirected and comes back with
 * a session cookie. An agent has no browser to be redirected in, so it gets the
 * device flow: ask for a code, show a human a short one to type, then poll.
 * Chosen over a loopback redirect because it works over SSH and inside a
 * container, which is where these agents actually run.
 */

import type { Env } from './index.js';

/** How long a browser session lasts before it has to be re-established. */
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;

/** How long someone has to finish typing a device code. */
const DEVICE_TTL_MS = 15 * 60_000;

/** How long an agent token lasts. Long, because re-authing an agent is friction. */
const AGENT_TOKEN_TTL_MS = 365 * 24 * 60 * 60_000;

/** How long a login round trip may take. Short: it is one redirect. */
const STATE_TTL_MS = 10 * 60_000;

/**
 * The letters a device code is drawn from.
 *
 * No 0/O, no 1/I/L. A human reads this off one screen and types it into
 * another, and the characters that get confused there are not the ones that get
 * confused in a font.
 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export interface Account {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string | null;
  github_created_at: number | null;
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function randomCode(length: number): string {
  const picks = crypto.getRandomValues(new Uint8Array(length));
  // Modulo over a 31-letter alphabet is very slightly biased. It does not
  // matter here: the code lives fifteen minutes and is one of 31^8.
  return [...picks].map((n) => CODE_ALPHABET[n % CODE_ALPHABET.length]).join('');
}

/** SHA-256, hex, full width. Used wherever a secret is stored rather than held. */
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function secretOf(env: Env): string {
  return env.CHALLENGE_SECRET ?? env.VOTER_SALT ?? 'yougotserved';
}

/** Constant-time compare, so a signature check cannot be walked one byte at a time. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  return diff === 0;
}

export function isConfigured(env: Env): boolean {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

/* ------------------------------------------------------------------ *
 * The redirect round trip
 * ------------------------------------------------------------------ */

/**
 * Signs where the user was going, so the callback can send them back.
 *
 * The state carries the return path and an expiry, signed. Nothing is stored,
 * which means a login attempt costs no row and a flood of them costs no table.
 */
async function makeState(env: Env, returnTo: string, deviceCode: string): Promise<string> {
  const body = `${Date.now()}.${returnTo}.${deviceCode}`;
  return `${body}.${await sha256(`${secretOf(env)}:${body}`)}`;
}

async function readState(
  env: Env,
  state: string,
): Promise<{ returnTo: string; deviceCode: string } | null> {
  const parts = state.split('.');
  if (parts.length !== 4) return null;

  const [stamp, returnTo, deviceCode, signature] = parts as [string, string, string, string];
  const expected = await sha256(`${secretOf(env)}:${stamp}.${returnTo}.${deviceCode}`);
  if (!sameSecret(expected, signature)) return null;

  const age = Date.now() - Number(stamp);
  if (!Number.isFinite(age) || age < 0 || age > STATE_TTL_MS) return null;

  return { returnTo, deviceCode };
}

/**
 * Only our own paths are accepted as a destination.
 *
 * An open redirect on a login endpoint is how a phishing link borrows your
 * domain: the user checks the hostname, which is genuinely ours, and lands
 * somewhere else. So the return is a path, never a URL.
 */
function safeReturn(raw: string | null): string {
  if (!raw) return '/';
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/';
  return raw;
}

/* ------------------------------------------------------------------ *
 * Sessions
 * ------------------------------------------------------------------ */

export interface Issued {
  /** The raw value, handed out once and never stored. */
  secret: string;
  expiresAt: number;
}

async function issueSession(env: Env, accountId: number): Promise<Issued> {
  const secret = randomHex(32);
  const expiresAt = Date.now() + SESSION_TTL_MS;

  await env.DB.prepare(
    'INSERT INTO sessions (token, account_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)',
  )
    .bind(await sha256(`${secretOf(env)}:${secret}`), accountId, Date.now(), expiresAt)
    .run();

  return { secret, expiresAt };
}

export function sessionCookie(secret: string, maxAgeSeconds: number): string {
  // HttpOnly so a script cannot read it, Secure so it never crosses plain http,
  // Lax so an ordinary link into the site still arrives signed in while a
  // cross-site form post does not.
  return [
    `ygs_session=${secret}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;

  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=') || null;
  }
  return null;
}

/**
 * Who is calling, by cookie or by agent token.
 *
 * Returns null for anonymous rather than throwing, because most routes here are
 * readable by anyone and only some care.
 */
export async function currentAccount(request: Request, env: Env): Promise<Account | null> {
  const bearer = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const cookie = cookieValue(request, 'ygs_session');
  const now = Date.now();

  if (cookie) {
    const row = await env.DB.prepare(
      `SELECT a.id, a.login, a.name, a.avatar_url, a.github_created_at
         FROM sessions s JOIN accounts a ON a.id = s.account_id
        WHERE s.token = ?1 AND s.expires_at > ?2`,
    )
      .bind(await sha256(`${secretOf(env)}:${cookie}`), now)
      .first<Account>();
    if (row) return row;
  }

  // An agent token looks like any other bearer. Publish tokens are checked
  // elsewhere and are not accounts, so a miss here is not an error.
  if (bearer) {
    const hashed = await sha256(`${secretOf(env)}:${bearer}`);
    const row = await env.DB.prepare(
      `SELECT a.id, a.login, a.name, a.avatar_url, a.github_created_at
         FROM agent_tokens t JOIN accounts a ON a.id = t.account_id
        WHERE t.token = ?1 AND (t.expires_at IS NULL OR t.expires_at > ?2)`,
    )
      .bind(hashed, now)
      .first<Account>();

    if (row) {
      await env.DB.prepare('UPDATE agent_tokens SET last_used = ?2 WHERE token = ?1')
        .bind(hashed, now)
        .run()
        .catch(() => undefined);
      return row;
    }
  }

  return null;
}

export async function signOut(request: Request, env: Env): Promise<void> {
  const cookie = cookieValue(request, 'ygs_session');
  if (!cookie) return;

  await env.DB.prepare('DELETE FROM sessions WHERE token = ?1')
    .bind(await sha256(`${secretOf(env)}:${cookie}`))
    .run()
    .catch(() => undefined);
}

/* ------------------------------------------------------------------ *
 * GitHub
 * ------------------------------------------------------------------ */

export function authorizeUrl(env: Env, state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID ?? '',
    redirect_uri: redirectUri,
    // No scopes. The registry wants to know who someone is, not to read their
    // code. An empty scope still returns the public profile, which is all of
    // what is used below.
    scope: '',
    state,
    allow_signup: 'true',
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

interface GitHubUser {
  id: number;
  login: string;
  name?: string | null;
  avatar_url?: string | null;
  created_at?: string;
}

async function exchangeCode(env: Env, code: string, redirectUri: string): Promise<string | null> {
  const response = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!response.ok) return null;

  const body = (await response.json()) as { access_token?: string };
  return body.access_token ?? null;
}

async function fetchUser(accessToken: string): Promise<GitHubUser | null> {
  const response = await fetch('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${accessToken}`,
      accept: 'application/vnd.github+json',
      // GitHub refuses a request with no user agent.
      'user-agent': 'yougotserved-registry',
    },
  });
  if (!response.ok) return null;
  return (await response.json()) as GitHubUser;
}

async function upsertAccount(env: Env, user: GitHubUser): Promise<Account> {
  const now = Date.now();
  const created = user.created_at ? Date.parse(user.created_at) : null;

  await env.DB.prepare(
    `INSERT INTO accounts (id, login, name, avatar_url, github_created_at, first_seen, last_seen)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
       ON CONFLICT(id) DO UPDATE SET
         login = ?2, name = ?3, avatar_url = ?4, github_created_at = ?5, last_seen = ?6`,
  )
    .bind(
      user.id,
      user.login,
      user.name ?? null,
      user.avatar_url ?? null,
      Number.isFinite(created) ? created : null,
      now,
    )
    .run();

  return {
    id: user.id,
    login: user.login,
    name: user.name ?? null,
    avatar_url: user.avatar_url ?? null,
    github_created_at: Number.isFinite(created) ? (created as number) : null,
  };
}

/* ------------------------------------------------------------------ *
 * The device flow
 * ------------------------------------------------------------------ */

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verifier: string;
  expiresAt: number;
}

/**
 * Opens a device flow.
 *
 * The caller keeps the verifier and never sends it until it polls, so a device
 * code read off someone's screen is not enough to claim the token that comes
 * out of it.
 */
export async function startDevice(env: Env): Promise<DeviceStart> {
  const deviceCode = randomHex(32);
  const verifier = randomHex(32);
  const userCode = `${randomCode(4)}-${randomCode(4)}`;
  const expiresAt = Date.now() + DEVICE_TTL_MS;

  await env.DB.prepare(
    `INSERT INTO device_grants (device_code, user_code, verifier_hash, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(
      await sha256(`${secretOf(env)}:${deviceCode}`),
      userCode,
      await sha256(`${secretOf(env)}:${verifier}`),
      Date.now(),
      expiresAt,
    )
    .run();

  return { deviceCode, userCode, verifier, expiresAt };
}

/** Attaches a signed-in account to a pending device code. */
export async function approveDevice(
  env: Env,
  userCode: string,
  accountId: number,
): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE device_grants SET account_id = ?2
       WHERE user_code = ?1 AND account_id IS NULL AND expires_at > ?3`,
  )
    .bind(userCode.trim().toUpperCase(), accountId, Date.now())
    .run();

  return Boolean(result.meta.changes);
}

export type DevicePoll =
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'ready'; token: string; account: Account };

/**
 * Polls a device flow, and issues the agent token once.
 *
 * The grant is marked claimed in the same step that reads it, so two polls
 * racing each other cannot both walk away with a token.
 */
export async function pollDevice(
  env: Env,
  deviceCode: string,
  verifier: string,
): Promise<DevicePoll> {
  const hashed = await sha256(`${secretOf(env)}:${deviceCode}`);
  const row = await env.DB.prepare(
    'SELECT verifier_hash, account_id, expires_at, claimed_at FROM device_grants WHERE device_code = ?1',
  )
    .bind(hashed)
    .first<{
      verifier_hash: string;
      account_id: number | null;
      expires_at: number;
      claimed_at: number | null;
    }>();

  if (!row) return { status: 'expired' };
  if (!sameSecret(row.verifier_hash, await sha256(`${secretOf(env)}:${verifier}`))) {
    return { status: 'denied' };
  }
  if (row.expires_at < Date.now() || row.claimed_at) return { status: 'expired' };
  if (!row.account_id) return { status: 'pending' };

  const claimed = await env.DB.prepare(
    'UPDATE device_grants SET claimed_at = ?2 WHERE device_code = ?1 AND claimed_at IS NULL',
  )
    .bind(hashed, Date.now())
    .run();
  if (!claimed.meta.changes) return { status: 'expired' };

  const account = await env.DB.prepare(
    'SELECT id, login, name, avatar_url, github_created_at FROM accounts WHERE id = ?1',
  )
    .bind(row.account_id)
    .first<Account>();
  if (!account) return { status: 'expired' };

  const token = `ygsa_${randomHex(32)}`;
  await env.DB.prepare(
    `INSERT INTO agent_tokens (token, account_id, label, created_at, expires_at)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
  )
    .bind(
      await sha256(`${secretOf(env)}:${token}`),
      account.id,
      'device flow',
      Date.now(),
      Date.now() + AGENT_TOKEN_TTL_MS,
    )
    .run();

  return { status: 'ready', token, account };
}

/** Drops expired sessions and grants. Cheap, and keeps two tables bounded. */
export async function sweep(env: Env): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(now),
    env.DB.prepare('DELETE FROM device_grants WHERE expires_at < ?1').bind(now),
  ]).catch(() => undefined);
}

export { exchangeCode, fetchUser, upsertAccount, issueSession, makeState, readState, safeReturn };
