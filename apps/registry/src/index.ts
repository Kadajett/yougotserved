/**
 * Adapter registry.
 *
 * The Worker stores and serves packs. It never runs adapter code, and a pack is
 * plain JSON, so this stays a static file server with a search index in front
 * of it. That property is what keeps the extension inside the Chrome Web Store
 * rule against remotely hosted code.
 */

import {
  approveDevice,
  authorizeUrl,
  currentAccount,
  exchangeCode,
  fetchUser,
  isConfigured,
  issueSession,
  makeState,
  pollDevice,
  readState,
  safeReturn,
  sessionCookie,
  signOut,
  startDevice,
  sweep,
  upsertAccount,
  type Account,
} from './auth.js';
import { DEVICE_PAGE, PAGE } from './page.js';
import { confirmTip, formatAmount, isTxHash, requirements, tipConfig } from './tips.js';

export interface Env {
  DB: D1Database;
  /**
   * Publishing tokens, comma separated, one for each maintainer. Separate
   * tokens mean one can be revoked without locking the others out.
   * Set with `wrangler secret put PUBLISH_TOKENS`.
   */
  PUBLISH_TOKENS?: string;
  /** Older single-token name. Still accepted. */
  PUBLISH_TOKEN?: string;
  /** Salt for hashing install ids before they are stored. */
  VOTER_SALT?: string;
  /**
   * Turnstile secret, from the Cloudflare dashboard.
   *
   * Only ever checked for callers that have a browser. An agent posting through
   * the MCP server cannot solve a Turnstile and should not be able to, so it
   * proves itself with work instead. See `proved`.
   */
  TURNSTILE_SECRET?: string;
  /** Signs proof-of-work challenges, sessions, and device grants. Falls back to VOTER_SALT. */
  CHALLENGE_SECRET?: string;
  /**
   * GitHub OAuth app, which is where identity comes from.
   *
   * Unset, every sign-in route answers 503 and the rest of the registry works
   * exactly as before. Anonymous publishing was never open, so nothing that
   * used to work stops working.
   */
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  /**
   * Where tips go. A plain var in wrangler.toml, deliberately not a secret.
   *
   * A receiving address is public by nature, so there is nothing to keep. The
   * risk to a tip jar is substitution rather than disclosure, and an address in
   * version control changes only through a diff somebody can see.
   *
   * Unset, the tip routes answer 404 and the registry never mentions money.
   */
  TIP_ADDRESS?: string;
  TIP_TOKEN?: string;
  TIP_CHAIN_ID?: string;
  TIP_RPC?: string;
}

/**
 * How hard a proof of work has to be, in leading zero bits.
 *
 * Twenty bits is about a million hashes: near enough a second in JavaScript on
 * average, with a tail of several seconds, because the search is memoryless and
 * a run of bad luck costs what it costs. That is the whole trade. One caller
 * pays a second they will not notice; a thousand-node botnet pays a thousand
 * CPU-seconds for every thousand votes, and no amount of address rotation gets
 * it a discount.
 *
 * It is not tuned higher for the same reason it is not tuned lower: the honest
 * caller pays too, and a rating is not worth ten seconds of someone's laptop.
 */
const WORK_BITS = 20;

/** How long a challenge stays good. Long enough to solve, short enough to hoard badly. */
const CHALLENGE_TTL_MS = 10 * 60_000;

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  // Packs are immutable, so a client may cache one forever.
  'access-control-allow-origin': '*',
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function fail(status: number, message: string, hint?: string): Response {
  return json({ error: { message, hint } }, status);
}

/** UTC day key. Download counts bucket by day so the table stays small. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Counts a caller's requests in a fixed window, and says whether to serve them.
 *
 * Address throttling is the weakest control here. It stops a loop from one
 * machine, which is what an unprotected endpoint actually meets, and it does
 * nothing at all against a botnet. Turnstile is the part that scales; this is
 * the part that needs no configuration and works the moment it ships.
 *
 * The address is hashed before it is stored, so the table holds no IPs.
 */
async function throttled(
  request: Request,
  env: Env,
  scope: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const address = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const key = await hashVoter(`${scope}:${window}:${address}`, env.VOTER_SALT ?? 'yougotserved');
  const expires = (window + 1) * windowSeconds * 1000;

  const row = await env.DB.prepare(
    `INSERT INTO throttle (bucket, hits, expires_at) VALUES (?1, 1, ?2)
       ON CONFLICT(bucket) DO UPDATE SET hits = throttle.hits + 1
     RETURNING hits`,
  )
    .bind(key, expires)
    .first<{ hits: number }>();

  const hits = Number(row?.hits ?? 0);

  // Old windows can never be read again, because the key contains the window it
  // belongs to. Sweeping on the first hit of a new bucket keeps the table from
  // growing forever without needing anything scheduled.
  if (hits === 1) {
    await env.DB.prepare('DELETE FROM throttle WHERE expires_at < ?1')
      .bind(Date.now())
      .run()
      .catch(() => undefined);
  }

  return hits > limit;
}

/**
 * Checks a Turnstile token with Cloudflare.
 *
 * Only reached when a caller sent a token, which means a browser. An agent
 * never gets here, and an unconfigured deployment refuses the token rather than
 * waving it through, because a token nobody verified proves less than nothing:
 * it looks like a check and is not one.
 */
async function passedTurnstile(request: Request, env: Env, token?: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET || !token) return false;

  const body = new FormData();
  body.append('secret', env.TURNSTILE_SECRET);
  body.append('response', token);
  const address = request.headers.get('cf-connecting-ip');
  if (address) body.append('remoteip', address);

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    body,
  });
  if (!response.ok) return false;

  const result = (await response.json()) as { success?: boolean };
  return result.success === true;
}

/**
 * Hashes a caller-supplied value before it is stored.
 *
 * The registry needs to know that two votes came from the same machine. It does
 * not need to know which machine, so it never stores the raw id or the address.
 */
async function hashVoter(raw: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${raw}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/* ------------------------------------------------------------------ *
 * Proof of work
 *
 * Turnstile asks "are you a browser", which is the wrong question here. Most
 * writes to this registry come from an agent running on someone's machine, and
 * an agent has no browser to be. Asking it for a Turnstile would either lock
 * out every honest caller or teach them to defeat a bot check, and the second
 * is worse than the first.
 *
 * So an agent proves something else: that it spent CPU. A challenge is signed
 * and thrown away, the caller searches for a nonce that hashes with enough
 * leading zeros, and the server checks it in one hash. One rating costs a
 * second nobody notices. Ten thousand cost ten thousand seconds, spread across
 * however many addresses the sender rents, and the addresses were never the
 * expensive part.
 * ------------------------------------------------------------------ */

async function sign(value: string, env: Env): Promise<string> {
  return hashVoter(value, env.CHALLENGE_SECRET ?? env.VOTER_SALT ?? 'yougotserved');
}

/**
 * Mints a challenge. Nothing is stored: the signature is what makes it ours.
 */
async function issueChallenge(env: Env): Promise<Response> {
  const nonce = [...crypto.getRandomValues(new Uint8Array(12))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const stamp = Date.now();
  const body = `${stamp}.${nonce}`;
  const challenge = `${body}.${await sign(body, env)}`;

  return json({
    challenge,
    bits: WORK_BITS,
    expiresAt: stamp + CHALLENGE_TTL_MS,
    how: `Find a nonce where sha256("<challenge>:<nonce>") starts with ${WORK_BITS} zero bits. Send { challenge, nonce }.`,
  });
}

/** Leading zero bits of a digest. */
function leadingZeroBits(bytes: Uint8Array): number {
  let count = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      count += 8;
      continue;
    }
    count += Math.clz32(byte) - 24;
    break;
  }
  return count;
}

/**
 * Checks a solved challenge and spends it.
 *
 * Three things have to hold: we signed it, it is recent, and the work is there.
 * Then it is marked spent, because a solution that can be replayed is a
 * one-second toll paid once for unlimited writes.
 */
async function solvedWork(env: Env, challenge?: string, nonce?: string): Promise<string | null> {
  if (!challenge || !nonce) return 'Send { challenge, nonce } from /api/challenge.';

  const parts = challenge.split('.');
  if (parts.length !== 3) return 'Malformed challenge.';

  const [stamp, random, signature] = parts as [string, string, string];
  if ((await sign(`${stamp}.${random}`, env)) !== signature) return 'That challenge is not ours.';

  const age = Date.now() - Number(stamp);
  if (!Number.isFinite(age) || age < 0 || age > CHALLENGE_TTL_MS) return 'That challenge expired.';

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${challenge}:${nonce}`),
  );
  if (leadingZeroBits(new Uint8Array(digest)) < WORK_BITS) {
    return `Not enough work: ${WORK_BITS} leading zero bits required.`;
  }

  // The throttle table doubles as the spent list. Its keys already carry their
  // own expiry and get swept, and a challenge is exactly a one-window counter.
  const row = await env.DB.prepare(
    `INSERT INTO throttle (bucket, hits, expires_at) VALUES (?1, 1, ?2)
       ON CONFLICT(bucket) DO UPDATE SET hits = throttle.hits + 1
     RETURNING hits`,
  )
    .bind(`pow:${signature}`, Number(stamp) + CHALLENGE_TTL_MS)
    .first<{ hits: number }>();

  if (Number(row?.hits ?? 0) > 1) return 'That challenge was already spent.';
  return null;
}

/**
 * The one gate every anonymous write goes through.
 *
 * A caller proves themselves however they can: a maintainer with a token, a
 * browser with Turnstile, an agent with work. Any one is enough, and none of
 * them is required of a caller that cannot produce it.
 */
async function proved(
  request: Request,
  env: Env,
  body: { turnstileToken?: string; challenge?: string; nonce?: string },
): Promise<string | null> {
  if (isMaintainer(request, env)) return null;
  if (body.turnstileToken) {
    return (await passedTurnstile(request, env, body.turnstileToken))
      ? null
      : 'That Turnstile token did not check out.';
  }
  return solvedWork(env, body.challenge, body.nonce);
}

/**
 * The handles a request can be banned by.
 *
 * An address is the weakest of these and the only one most systems use. The ASN
 * is what a proxy pool cannot rotate out of cheaply, because the addresses it
 * rotates through belong to the same handful of hosting providers. Everything
 * else has to come from the request body, which is why `banned` takes extras.
 */
async function subjects(request: Request, env: Env): Promise<string[]> {
  const salt = env.VOTER_SALT ?? 'yougotserved';
  const address = request.headers.get('cf-connecting-ip');
  const asn = (request as { cf?: { asn?: number } }).cf?.asn;

  const list: string[] = [];
  if (address) list.push(`address:${await hashVoter(address, salt)}`);
  if (asn) list.push(`asn:${asn}`);
  return list;
}

/**
 * Returns the reason a request is refused, or null if it is not.
 *
 * Expired bans are treated as absent rather than deleted, so a ban that lapses
 * needs no cleanup job and the record of it survives for anyone reviewing what
 * moderation has done.
 */
async function banned(env: Env, list: string[]): Promise<string | null> {
  if (list.length === 0) return null;

  const holes = list.map((_, index) => `?${index + 1}`).join(', ');
  const row = await env.DB.prepare(
    `SELECT kind, reason FROM bans
       WHERE subject IN (${holes})
         AND (expires_at IS NULL OR expires_at > ?${list.length + 1})`,
  )
    .bind(...list, Date.now())
    .first<{ kind: string; reason: string }>();

  if (!row) return null;
  return row.reason || `Refused by a ${row.kind} ban.`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type, authorization',
        },
      });
    }

    try {
      if (path === '/') return new Response(PAGE, { headers: { 'content-type': 'text/html' } });
      if (path === '/api/health') return json({ ok: true });
      if (path === '/api/adapters' && request.method === 'GET') return listAdapters(url, env);
      if (path === '/api/adapters' && request.method === 'POST') return publish(request, env);

      const detail = path.match(/^\/api\/adapters\/([a-z][a-z0-9_]*)$/);
      if (detail?.[1] && request.method === 'GET') return getAdapter(detail[1], env);

      const rate = path.match(/^\/api\/adapters\/([a-z][a-z0-9_]*)\/rate$/);
      if (rate?.[1] && request.method === 'POST') return rateAdapter(rate[1], request, env);

      const pack = path.match(/^\/api\/adapters\/([a-z][a-z0-9_]*)\/([^/]+)\/pack\.json$/);
      if (pack?.[1] && pack[2] && request.method === 'GET') {
        return downloadPack(pack[1], pack[2], env);
      }

      if (path === '/api/resolve' && request.method === 'GET') return resolveHost(url);
      if (path === '/api/challenge' && request.method === 'GET') return issueChallenge(env);

      if (path.startsWith('/api/auth/') || path === '/auth/device') {
        return auth(path, request, url, env);
      }
      if (path.startsWith('/api/tip')) return tip(path, request, url, env);

      // Everything below is a maintainer's, and answers 404 to anyone else.
      // A 401 would confirm the routes exist, which is a map of what to attack.
      if (
        path === '/api/moderation' ||
        path.startsWith('/api/moderation/') ||
        path === '/api/bans'
      ) {
        if (!isMaintainer(request, env))
          return fail(404, `No route for ${request.method} ${path}.`);

        if (path === '/api/moderation' && request.method === 'GET') return heldQueue(env);
        if (path === '/api/bans' && request.method === 'POST') return manageBan(request, env);

        const hold = path.match(/^\/api\/moderation\/([a-z][a-z0-9_]*)$/);
        if (hold?.[1] && request.method === 'POST') return decideHold(hold[1], request, env);
      }

      return fail(404, `No route for ${request.method} ${path}.`);
    } catch (error) {
      return fail(500, error instanceof Error ? error.message : String(error));
    }
  },
};

/* ------------------------------------------------------------------ *
 * Read
 * ------------------------------------------------------------------ */

async function listAdapters(url: URL, env: Env): Promise<Response> {
  const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50) || 50, 100);

  // An uncleared moderation row hides the adapter. Held submissions have to be
  // invisible everywhere a listing is read, or holding them means nothing.
  const HELD = `a.id NOT IN (SELECT adapter_id FROM moderation WHERE cleared_at IS NULL)`;

  // LIKE over three columns is enough at this size. D1 has FTS5 if the row
  // count ever justifies it.
  const where = query
    ? `WHERE ${HELD} AND lower(a.id || a.name || a.description) LIKE ?1`
    : `WHERE ${HELD}`;
  const binds = query ? [`%${query}%`, limit] : [limit];

  const { results } = await env.DB.prepare(
    `SELECT a.id, a.name, a.description, a.author, a.origins,
            v.version, v.digest, v.capabilities, v.tool_count,
            COALESCE(d.total, 0)   AS downloads,
            COALESCE(r.average, 0) AS rating,
            COALESCE(r.votes, 0)   AS votes
       FROM adapters a
       JOIN versions v ON v.adapter_id = a.id
        AND v.published_at = (SELECT MAX(published_at) FROM versions WHERE adapter_id = a.id)
       LEFT JOIN (SELECT adapter_id, SUM(count) total FROM downloads GROUP BY adapter_id) d
              ON d.adapter_id = a.id
       LEFT JOIN (SELECT adapter_id, AVG(score) average, COUNT(*) votes
                    FROM ratings GROUP BY adapter_id) r
              ON r.adapter_id = a.id
       ${where}
       ORDER BY downloads DESC, a.updated_at DESC
       LIMIT ?${query ? 2 : 1}`,
  )
    .bind(...binds)
    .all();

  return json({ adapters: (results ?? []).map(shape) });
}

/**
 * Resolves an origin's addresses, over DNS-over-HTTPS.
 *
 * Shown beside an adapter's origins so someone deciding whether to install it
 * can see where those names point. Read it as a fact about the internet rather
 * than about the pack: a CDN answers differently per region, and the answer
 * changes without anyone republishing anything.
 *
 * The hostname is checked against a strict shape before it reaches the query,
 * because this endpoint makes an outbound request on a caller's say-so.
 */
async function resolveHost(url: URL): Promise<Response> {
  const host = (url.searchParams.get('host') ?? '').toLowerCase();
  if (!/^(?!-)[a-z0-9-]{1,63}(\.(?!-)[a-z0-9-]{1,63})+$/.test(host) || host.length > 253) {
    return fail(400, 'A hostname is required.');
  }

  const ask = async (type: 'A' | 'AAAA'): Promise<string[]> => {
    const answer = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`,
      { headers: { accept: 'application/dns-json' } },
    );
    if (!answer.ok) return [];
    const body = (await answer.json()) as { Answer?: { type: number; data: string }[] };
    const want = type === 'A' ? 1 : 28;
    return (body.Answer ?? []).filter((entry) => entry.type === want).map((entry) => entry.data);
  };

  const [a, aaaa] = await Promise.all([ask('A'), ask('AAAA')]);
  return new Response(JSON.stringify({ host, a, aaaa }), {
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      // An hour. Long enough that clicking around costs nothing, short enough
      // that a moved host does not read as current for the rest of the day.
      'cache-control': 'public, max-age=3600',
    },
  });
}

async function getAdapter(id: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT a.id, a.name, a.description, a.homepage, a.author, a.origins,
            v.version, v.digest, v.capabilities, v.tool_count, v.pack,
            COALESCE(d.total, 0)   AS downloads,
            COALESCE(r.average, 0) AS rating,
            COALESCE(r.votes, 0)   AS votes
       FROM adapters a
       JOIN versions v ON v.adapter_id = a.id
        AND v.published_at = (SELECT MAX(published_at) FROM versions WHERE adapter_id = a.id)
       LEFT JOIN (SELECT adapter_id, SUM(count) total FROM downloads GROUP BY adapter_id) d
              ON d.adapter_id = a.id
       LEFT JOIN (SELECT adapter_id, AVG(score) average, COUNT(*) votes
                    FROM ratings GROUP BY adapter_id) r
              ON r.adapter_id = a.id
      WHERE a.id = ?1`,
  )
    .bind(id)
    .first();

  if (!row) return fail(404, `No adapter called "${id}".`);

  // Held submissions answer as missing rather than as held. Confirming that an
  // id exists but is hidden would turn this endpoint into a way to watch the
  // moderation queue, and to find out which wording gets through.
  if (await isHeld(id, env)) return fail(404, `No adapter called "${id}".`);

  const versions = await env.DB.prepare(
    'SELECT version, digest, published_at FROM versions WHERE adapter_id = ?1 ORDER BY published_at DESC',
  )
    .bind(id)
    .all();

  return json({
    ...shape(row),
    pack: JSON.parse(String(row.pack)),
    versions: versions.results ?? [],
  });
}

/**
 * Serves a pack and counts the pull.
 *
 * The count is written after the read and never blocks it. A lost count is not
 * worth a failed install.
 */
async function downloadPack(id: string, version: string, env: Env): Promise<Response> {
  const row = await env.DB.prepare(
    'SELECT pack, digest FROM versions WHERE adapter_id = ?1 AND version = ?2',
  )
    .bind(id, version)
    .first();

  if (!row) return fail(404, `No version ${version} of "${id}".`);

  // A held adapter is not servable, including versions of it that were fine
  // before. That does break an install pinned to an older version, and it is
  // still the right way round: a clean republish lifts the hold without anyone
  // being asked, so a false positive costs an author minutes, while the other
  // way round costs every machine that pulls the pack.
  if (await isHeld(id, env)) return fail(404, `No version ${version} of "${id}".`);

  await env.DB.prepare(
    `INSERT INTO downloads (adapter_id, version, day, count) VALUES (?1, ?2, ?3, 1)
       ON CONFLICT(adapter_id, version, day) DO UPDATE SET count = count + 1`,
  )
    .bind(id, version, today())
    .run()
    .catch(() => undefined);

  return new Response(String(row.pack), {
    headers: {
      ...JSON_HEADERS,
      // The digest is the content address, so the body can never change.
      'cache-control': 'public, max-age=31536000, immutable',
      etag: `"${row.digest}"`,
    },
  });
}

/* ------------------------------------------------------------------ *
 * Write
 * ------------------------------------------------------------------ */

/**
 * Whether the request carries a maintainer token.
 *
 * The same token gates publishing and moderating. Splitting them would be
 * tidier and would protect nothing while one person holds both.
 */
function isMaintainer(request: Request, env: Env): boolean {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return false;

  return `${env.PUBLISH_TOKENS ?? ''},${env.PUBLISH_TOKEN ?? ''}`
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length >= 16)
    .includes(token);
}

async function publish(request: Request, env: Env): Promise<Response> {
  if (!isMaintainer(request, env)) {
    return fail(
      401,
      'Publishing needs a bearer token.',
      'Set PUBLISH_TOKENS as a Wrangler secret. A token shorter than 16 characters is ignored.',
    );
  }

  const body = (await request.json()) as { pack?: unknown; digest?: string; author?: string };
  if (!body.pack || typeof body.digest !== 'string') {
    return fail(400, 'Send { pack, digest, author }.');
  }

  // Validated in the CLI before upload, and again here. The upload arrives over
  // the network, so the earlier check proves nothing on this side.
  const { validatePack, canonicalJson, packDigest } = await import('@yougotserved/adapter-sdk');

  let pack;
  try {
    pack = validatePack(body.pack);
  } catch (error) {
    return fail(400, error instanceof Error ? error.message : 'Invalid pack.');
  }

  const digest = await packDigest(pack);
  if (digest !== body.digest) {
    return fail(400, `Digest mismatch. Body says ${body.digest}, the pack hashes to ${digest}.`);
  }

  // Everything a pack shows a person is prose the author wrote: its name, its
  // description, and the description and returns line of every tool. The steps
  // are checked by the interpreter and cannot say anything; these can say
  // anything at all, so they are what gets read here.
  const prose: Record<string, string | undefined> = {
    name: pack.name,
    description: pack.description,
    author: body.author,
  };
  for (const [toolId, tool] of Object.entries(pack.tools)) {
    prose[`tools.${toolId}.description`] = tool.description;
    prose[`tools.${toolId}.returns`] = tool.returns;
  }

  const { reviewFields, fingerprint, reviewUrls } = await import('@yougotserved/moderation');
  const verdict = reviewFields(prose);

  // Origins are not prose, and they matter more than prose. The host lets a
  // pack reach exactly what it declared, so the declaration is the security
  // boundary. `validatePack` above has already refused the ones that are unsafe
  // by construction, addresses and local names; this is the reputation pass,
  // which lives here so it can change without shipping a new SDK to every
  // install. A redirector scores high enough to refuse on its own, because an
  // origin fence around one fences nothing.
  const origins = reviewUrls(pack.origins);
  if (origins.findings.length > 0) {
    verdict.findings.push(...origins.findings);
    verdict.score += origins.findings.reduce((total, finding) => total + finding.weight, 0);
    if (verdict.score >= 7) verdict.severity = 'block';
    else if (verdict.score >= 3 && verdict.severity === 'allow') verdict.severity = 'review';
    verdict.field ??= 'origins';
  }

  const print = await fingerprint(Object.values(prose).filter(Boolean).join(' '));
  const refusal = await banned(env, [
    ...(await subjects(request, env)),
    ...(print ? [`fingerprint:${print}`] : []),
  ]);
  if (refusal) return fail(403, refusal);

  if (verdict.severity === 'block') {
    return fail(
      422,
      `Refused: ${verdict.findings.map((f) => f.detail).join('; ')}`,
      `Found in ${verdict.field ?? 'the pack'}. Fix the text and publish again.`,
    );
  }

  const now = Date.now();

  // Whether a hold goes on or comes off. Applied on every accepted publish,
  // including one that changes nothing: a version that was held and then
  // republished byte for byte has to stay held, or clearing a hold once would
  // be a way to make the same text permanently unholdable.
  const record =
    verdict.severity === 'review'
      ? env.DB.prepare(
          `INSERT INTO moderation (adapter_id, version, severity, score, field, findings, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(adapter_id) DO UPDATE SET
               version = ?2, severity = ?3, score = ?4, field = ?5, findings = ?6,
               created_at = ?7,
               -- A decision a moderator already made stands, as long as the new
               -- text scores no worse than what they looked at. Otherwise every
               -- republish would undo the review and the author would be held
               -- again for text somebody already allowed. The gap this leaves
               -- is that different text of the same weight rides the old clear,
               -- which is the price of not re-asking a person the same question.
               cleared_at = CASE
                 WHEN moderation.cleared_at IS NOT NULL AND moderation.score >= ?4
                 THEN moderation.cleared_at ELSE NULL END`,
        ).bind(
          pack.id,
          pack.version,
          verdict.severity,
          verdict.score,
          verdict.field ?? null,
          JSON.stringify(verdict.findings),
          now,
        )
      : env.DB.prepare('DELETE FROM moderation WHERE adapter_id = ?1 AND cleared_at IS NULL').bind(
          pack.id,
        );

  const existing = await env.DB.prepare(
    'SELECT digest FROM versions WHERE adapter_id = ?1 AND version = ?2',
  )
    .bind(pack.id, pack.version)
    .first();

  if (existing) {
    // Republishing the identical bytes is a no-op. Republishing different bytes
    // under the same version would break every pinned install.
    if (existing.digest === digest) {
      await record.run();
      return json({ ok: true, unchanged: true, digest, held: await isHeld(pack.id, env) });
    }
    return fail(409, `${pack.id}@${pack.version} already exists with a different digest.`);
  }

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO adapters (id, name, description, homepage, author, origins, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)
         ON CONFLICT(id) DO UPDATE SET
           name = ?2, description = ?3, homepage = ?4, origins = ?6, updated_at = ?7`,
    ).bind(
      pack.id,
      pack.name,
      pack.description ?? '',
      pack.homepage ?? null,
      (body.author ?? '').slice(0, 64),
      JSON.stringify(pack.origins),
      now,
    ),
    env.DB.prepare(
      `INSERT INTO versions (adapter_id, version, digest, pack, capabilities, tool_count, published_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
    ).bind(
      pack.id,
      pack.version,
      digest,
      canonicalJson(pack),
      JSON.stringify(pack.capabilities),
      Object.keys(pack.tools).length,
      now,
    ),
    // A held pack is stored and hidden rather than refused. The author gets a
    // straight answer, the bytes are there for whoever reviews it, and nothing
    // is lost if the checks were wrong. A clean republish clears the hold,
    // which is the fix path for a false positive that needs no moderator.
    record,
  ]);

  // Read back rather than assume. A hold a moderator already cleared survives
  // a republish of the same text, so the verdict alone does not say whether
  // this adapter ended up hidden, and telling an author it did when it did not
  // sends them off fixing nothing.
  const held = verdict.severity === 'review' && (await isHeld(pack.id, env));

  return json(
    {
      ok: true,
      id: pack.id,
      version: pack.version,
      digest,
      ...(held
        ? {
            held: true,
            why: verdict.findings.map((f) => f.detail),
            field: verdict.field,
            note: 'Published but hidden from listings until someone reviews it.',
          }
        : {}),
    },
    201,
  );
}

async function isHeld(id: string, env: Env): Promise<boolean> {
  const row = await env.DB.prepare(
    'SELECT 1 FROM moderation WHERE adapter_id = ?1 AND cleared_at IS NULL',
  )
    .bind(id)
    .first();
  return Boolean(row);
}

/* ------------------------------------------------------------------ *
 * Tips
 * ------------------------------------------------------------------ */

/**
 * The tip jar.
 *
 * 402 is the status code reserved for payment and never standardised, so it has
 * been sitting unused since 1997. It is used here for its literal meaning and
 * nothing more: this is how to pay, and nothing on this registry is behind it.
 *
 * The descriptor answers 402 because that is the code that means what it means.
 * It is not a refusal, and it says so in the body. Every other route works the
 * same whether anyone tips or not, which is a property worth defending: the
 * moment a rate limit starts pointing at a payment page, a tip jar has quietly
 * become a toll.
 */
async function tip(path: string, request: Request, url: URL, env: Env): Promise<Response> {
  const config = tipConfig(env);
  // 404 rather than 503. An unconfigured deployment should not advertise a tip
  // jar that would collect for whoever wrote the code.
  if (!config) return fail(404, `No route for ${request.method} ${path}.`);

  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(url.host);
  const origin = local ? url.origin : `https://${url.host}`;

  if (path === '/api/tip' && request.method === 'GET') {
    return json(requirements(config, origin), 402);
  }

  if (path === '/api/tip/supporters' && request.method === 'GET') {
    const { results } = await env.DB.prepare(
      `SELECT display, note, amount, verified_at FROM tips
        WHERE verified_at IS NOT NULL
        ORDER BY verified_at DESC LIMIT 50`,
    ).all();

    return json({
      supporters: (results ?? []).map((row) => ({
        display: String(row.display || 'anonymous'),
        note: String(row.note || ''),
        amount: formatAmount(String(row.amount)),
        at: row.verified_at,
      })),
    });
  }

  if (path === '/api/tip/claim' && request.method === 'POST') {
    // This one makes an outbound call on a caller's say-so, so it is throttled
    // whether or not the hash turns out to be real.
    if (await throttled(request, env, 'tip', 20, 3600)) {
      return fail(429, 'Too many claims from here in the last hour.');
    }

    const body = (await request.json().catch(() => ({}))) as {
      txHash?: string;
      display?: string;
      note?: string;
    };
    if (!isTxHash(body.txHash)) {
      return fail(400, 'Send { txHash } for a transaction that has already gone through.');
    }
    const txHash = body.txHash.trim().toLowerCase();

    const seen = await env.DB.prepare('SELECT verified_at FROM tips WHERE tx_hash = ?1')
      .bind(txHash)
      .first<{ verified_at: number | null }>();
    if (seen) return fail(409, 'That transaction has already been counted. Thank you twice over.');

    const confirmed = await confirmTip(config, txHash);
    if (!confirmed) {
      return fail(
        422,
        'That transaction did not move the expected token to the tip address, or has not landed yet.',
        'Wait for it to confirm, then try again.',
      );
    }

    // A tipper may say who they are, and what they say is user text like any
    // other, so it goes through the same checks as a pack description.
    const { reviewFields } = await import('@yougotserved/moderation');
    const said = reviewFields({ display: body.display, note: body.note });
    const clean = said.severity === 'allow';

    const account = await currentAccount(request, env);
    const now = Date.now();

    await env.DB.prepare(
      `INSERT INTO tips (tx_hash, chain, token, amount, from_addr, account_id, display, note, claimed_at, verified_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)`,
    )
      .bind(
        txHash,
        `eip155:${config.chainId}`,
        config.token,
        confirmed.amount,
        confirmed.from,
        account?.id ?? null,
        clean ? (body.display ?? account?.login ?? '').slice(0, 40) : '',
        clean ? (body.note ?? '').slice(0, 200) : '',
        now,
      )
      .run();

    return json({
      ok: true,
      amount: formatAmount(confirmed.amount),
      // Said out loud, because a payment endpoint that quietly grants something
      // is how a tip jar turns into a paywall without anyone deciding to.
      unlocked: 'nothing, on purpose',
      ...(clean ? {} : { note: 'Your message was held for review. The tip counted.' }),
    });
  }

  return fail(404, `No route for ${request.method} ${path}.`);
}

/* ------------------------------------------------------------------ *
 * Sign in
 * ------------------------------------------------------------------ */

/**
 * Every sign-in route.
 *
 * Kept in one function because they only make sense as a sequence, and reading
 * them in order is the fastest way to see that the sequence is sound.
 */
async function auth(path: string, request: Request, url: URL, env: Env): Promise<Response> {
  if (!isConfigured(env)) {
    return fail(
      503,
      'Sign-in is not configured on this deployment.',
      'wrangler secret put GITHUB_CLIENT_ID, then GITHUB_CLIENT_SECRET.',
    );
  }

  // Forced to https for anything that is not a local dev server. `url.origin`
  // reflects whatever scheme the request arrived on, and a sign-in URL handed
  // out over plain http is a sign-in URL that can be rewritten in transit.
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(url.host);
  const origin = local ? url.origin : `https://${url.host}`;
  const redirectUri = `${origin}/api/auth/callback`;

  // Start. The device code rides in the signed state, so approving a waiting
  // agent and signing in are one round trip rather than two.
  if (path === '/api/auth/login' && request.method === 'GET') {
    const state = await makeState(
      env,
      safeReturn(url.searchParams.get('return')),
      (url.searchParams.get('device') ?? '').trim().toUpperCase().slice(0, 9),
    );
    return new Response(null, {
      status: 302,
      headers: { location: authorizeUrl(env, state, redirectUri) },
    });
  }

  if (path === '/api/auth/callback' && request.method === 'GET') {
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) return fail(400, 'That sign-in did not come back complete.');

    const unpacked = await readState(env, state);
    if (!unpacked) return fail(400, 'That sign-in link expired or was not ours. Try again.');

    const accessToken = await exchangeCode(env, code, redirectUri);
    if (!accessToken) return fail(502, 'GitHub would not exchange that code.');

    const user = await fetchUser(accessToken);
    if (!user?.id) return fail(502, 'GitHub would not say who that is.');

    // Checked before the account row is written, so a banned account cannot
    // keep refreshing its own last_seen.
    const refusal = await banned(env, [`account:${user.id}`]);
    if (refusal) return fail(403, refusal);

    const account = await upsertAccount(env, user);
    const session = await issueSession(env, account.id);
    await sweep(env);

    const destination = unpacked.deviceCode
      ? `/auth/device?code=${encodeURIComponent(unpacked.deviceCode)}`
      : unpacked.returnTo;

    return new Response(null, {
      status: 302,
      headers: {
        location: destination,
        'set-cookie': sessionCookie(
          session.secret,
          Math.floor((session.expiresAt - Date.now()) / 1000),
        ),
      },
    });
  }

  if (path === '/api/auth/logout' && request.method === 'POST') {
    await signOut(request, env);
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) });
  }

  if (path === '/api/auth/me' && request.method === 'GET') {
    const account = await currentAccount(request, env);
    return account ? json({ account: shapeAccount(account) }) : json({ account: null });
  }

  /* The device flow, for a caller with no browser. */

  if (path === '/api/auth/device' && request.method === 'POST') {
    // Rate limited on its own, because this is the one write here that costs a
    // row and needs no proof of anything.
    if (await throttled(request, env, 'device', 20, 3600)) {
      return fail(429, 'Too many sign-in attempts from here in the last hour.');
    }

    const grant = await startDevice(env);
    return json({
      userCode: grant.userCode,
      deviceCode: grant.deviceCode,
      verifier: grant.verifier,
      verificationUri: `${origin}/auth/device`,
      expiresAt: grant.expiresAt,
      interval: 5,
    });
  }

  // The page a human lands on to approve a waiting agent. Signed out, it sends
  // them through GitHub first and comes back here.
  if (path === '/auth/device' && request.method === 'GET') {
    const account = await currentAccount(request, env);
    if (!account) {
      const code = (url.searchParams.get('code') ?? '').trim().toUpperCase().slice(0, 9);
      return new Response(null, {
        status: 302,
        headers: { location: `/api/auth/login?device=${encodeURIComponent(code)}` },
      });
    }
    return new Response(DEVICE_PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  }

  if (path === '/api/auth/device/approve' && request.method === 'POST') {
    const account = await currentAccount(request, env);
    if (!account) return fail(401, 'Sign in first.');

    const refusal = await banned(env, [`account:${account.id}`]);
    if (refusal) return fail(403, refusal);

    const body = (await request.json().catch(() => ({}))) as { userCode?: string };
    if (!body.userCode) return fail(400, 'Send the code the agent is showing you.');

    const approved = await approveDevice(env, body.userCode, account.id);
    if (!approved) return fail(404, 'That code is not waiting, or it expired. Ask for a new one.');

    return json({ ok: true, approvedAs: account.login });
  }

  if (path === '/api/auth/device/token' && request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as {
      deviceCode?: string;
      verifier?: string;
    };
    if (!body.deviceCode || !body.verifier) return fail(400, 'Send { deviceCode, verifier }.');

    const result = await pollDevice(env, body.deviceCode, body.verifier);
    if (result.status === 'ready') {
      return json({ status: 'ready', token: result.token, account: shapeAccount(result.account) });
    }
    // 202 for pending, so a polling client can branch on the status line alone.
    return json({ status: result.status }, result.status === 'pending' ? 202 : 400);
  }

  return fail(404, `No route for ${request.method} ${path}.`);
}

/**
 * What the registry says about an account.
 *
 * Age is given as a day count rather than a date. It is the one spam signal
 * that cannot be manufactured on demand, and a count is what a reader of the
 * moderation queue actually wants.
 */
function shapeAccount(account: Account): Record<string, unknown> {
  return {
    id: account.id,
    login: account.login,
    name: account.name ?? undefined,
    avatarUrl: account.avatar_url ?? undefined,
    accountAgeDays: account.github_created_at
      ? Math.floor((Date.now() - account.github_created_at) / 86400_000)
      : undefined,
  };
}

/* ------------------------------------------------------------------ *
 * Moderate
 * ------------------------------------------------------------------ */

/** The queue: everything the checks held that nobody has looked at yet. */
async function heldQueue(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT m.adapter_id, m.version, m.severity, m.score, m.field, m.findings, m.created_at,
            a.name, a.description, a.author
       FROM moderation m
       JOIN adapters a ON a.id = m.adapter_id
      WHERE m.cleared_at IS NULL
      ORDER BY m.score DESC, m.created_at ASC`,
  ).all();

  return json({
    held: (results ?? []).map((row) => ({
      ...row,
      findings: JSON.parse(String(row.findings ?? '[]')),
    })),
  });
}

/**
 * Clears a hold, or drops the adapter outright.
 *
 * Clearing keeps the row with a timestamp rather than deleting it, so the fact
 * that something was held and then allowed stays readable. Republishing the
 * same text will not re-hold it, because the row is no longer uncleared.
 */
async function decideHold(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json().catch(() => ({}))) as { drop?: boolean };

  if (body.drop) {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM versions WHERE adapter_id = ?1').bind(id),
      env.DB.prepare('DELETE FROM adapters WHERE id = ?1').bind(id),
      env.DB.prepare('DELETE FROM moderation WHERE adapter_id = ?1').bind(id),
    ]);
    return json({ ok: true, dropped: id });
  }

  const result = await env.DB.prepare(
    'UPDATE moderation SET cleared_at = ?2 WHERE adapter_id = ?1 AND cleared_at IS NULL',
  )
    .bind(id, Date.now())
    .run();

  if (!result.meta.changes) return fail(404, `Nothing held for "${id}".`);
  return json({ ok: true, cleared: id });
}

/**
 * Adds or lifts a ban.
 *
 * An address ban is offered because it is occasionally the right answer, and it
 * is the weakest thing here. The subjects worth reaching for are `asn`, which a
 * proxy pool cannot leave without paying for it, and `fingerprint`, which
 * refuses the payload no matter who sends it. A fingerprint is lossy on
 * purpose, so read the text before banning one.
 *
 * The reason is shown to whoever is refused, because someone banned by mistake
 * has no way to say so otherwise. Write it for them, not for the log.
 */
async function manageBan(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    kind?: string;
    value?: string;
    reason?: string;
    days?: number;
    lift?: boolean;
  };

  // `account` is the strongest of these by a distance. An address rotates, an
  // install id is chosen by the caller, and a fingerprint describes one message.
  // A GitHub account costs time to age and cannot be minted per request.
  const kinds = ['address', 'asn', 'voter', 'fingerprint', 'account'];
  if (!body.kind || !kinds.includes(body.kind)) {
    return fail(400, `kind must be one of: ${kinds.join(', ')}.`);
  }
  if (!body.value) return fail(400, 'Send the value to ban.');

  // An address is hashed to the same shape the checks compare against, so a
  // moderator can paste a raw address without the table ever holding one.
  const value =
    body.kind === 'address'
      ? await hashVoter(body.value, env.VOTER_SALT ?? 'yougotserved')
      : body.value;
  const subject = `${body.kind}:${value}`;

  if (body.lift) {
    const result = await env.DB.prepare('DELETE FROM bans WHERE subject = ?1').bind(subject).run();
    if (!result.meta.changes) return fail(404, 'No such ban.');
    return json({ ok: true, lifted: subject });
  }

  const expires = body.days ? Date.now() + body.days * 86400_000 : null;
  await env.DB.prepare(
    `INSERT INTO bans (subject, kind, reason, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT(subject) DO UPDATE SET reason = ?3, expires_at = ?5`,
  )
    .bind(subject, body.kind, (body.reason ?? '').slice(0, 200), Date.now(), expires)
    .run();

  return json({ ok: true, subject, expires });
}

/**
 * Records a rating.
 *
 * The identity here is an install id the caller chooses, which is the right
 * shape for privacy and no kind of proof. Hashing it protects the voter and
 * authenticates nobody, so on its own this endpoint will accept as many votes
 * as a loop can send: pick a new id, send a five, repeat. Everything below
 * exists because of that.
 *
 * Three separate limits, because each catches what the others miss. A new
 * voter for an adapter spends a small per-adapter budget, so one address cannot
 * become a crowd. A larger budget covers rating across adapters, so a scripted
 * sweep runs out. And a proof of work puts a real second of CPU behind each
 * vote, which is the only one of the three a sender with a thousand addresses
 * still has to pay a thousand times.
 *
 * Changing your own rating is deliberately cheap. It costs no per-adapter
 * budget, because the row already exists and updating it cannot inflate a
 * count.
 */
async function rateAdapter(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    score?: number;
    installId?: string;
    turnstileToken?: string;
    challenge?: string;
    nonce?: string;
  };
  const score = Number(body.score);

  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return fail(400, 'Score must be a whole number from 1 to 5.');
  }
  if (!body.installId || body.installId.length < 8) {
    return fail(400, 'Send an installId so a rating can be changed later.');
  }

  const salt = env.VOTER_SALT ?? 'yougotserved';
  const voter = await hashVoter(body.installId, salt);

  const refusal = await banned(env, [...(await subjects(request, env)), `voter:${voter}`]);
  if (refusal) return fail(403, refusal);

  const unproved = await proved(request, env, body);
  if (unproved) {
    return fail(
      403,
      unproved,
      'GET /api/challenge, or update ygs-bridge, which does this for you.',
    );
  }

  if (await throttled(request, env, 'rate', 40, 3600)) {
    return fail(429, 'Too many ratings from here in the last hour.');
  }

  const exists = await env.DB.prepare('SELECT 1 FROM adapters WHERE id = ?1').bind(id).first();
  if (!exists) return fail(404, `No adapter called "${id}".`);

  const already = await env.DB.prepare('SELECT 1 FROM ratings WHERE adapter_id = ?1 AND voter = ?2')
    .bind(id, voter)
    .first();

  // Only a vote that adds to the count spends the per-adapter budget. Two is
  // for a household or an office, and the fourth machine on one address has to
  // wait a day, which is a fair trade against a loop that made five in a second.
  if (!already && (await throttled(request, env, `rate:${id}`, 2, 86400))) {
    return fail(
      429,
      `Too many new ratings for "${id}" from here today.`,
      'Changing a rating you already gave is not limited.',
    );
  }

  await env.DB.prepare(
    `INSERT INTO ratings (adapter_id, voter, score, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(adapter_id, voter) DO UPDATE SET score = ?3, created_at = ?4`,
  )
    .bind(id, voter, score, Date.now())
    .run();

  const summary = await env.DB.prepare(
    'SELECT AVG(score) average, COUNT(*) votes FROM ratings WHERE adapter_id = ?1',
  )
    .bind(id)
    .first();

  return json({
    ok: true,
    rating: Number(summary?.average ?? 0),
    votes: Number(summary?.votes ?? 0),
  });
}

function shape(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    homepage: row.homepage ?? undefined,
    author: row.author,
    origins: JSON.parse(String(row.origins ?? '[]')),
    version: row.version,
    digest: row.digest,
    capabilities: JSON.parse(String(row.capabilities ?? '[]')),
    tools: Number(row.tool_count ?? 0),
    downloads: Number(row.downloads ?? 0),
    rating: Math.round(Number(row.rating ?? 0) * 10) / 10,
    votes: Number(row.votes ?? 0),
  };
}
