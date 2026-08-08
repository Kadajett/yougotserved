/**
 * Adapter registry.
 *
 * The Worker stores and serves packs. It never runs adapter code, and a pack is
 * plain JSON, so this stays a static file server with a search index in front
 * of it. That property is what keeps the extension inside the Chrome Web Store
 * rule against remotely hosted code.
 */

import { PAGE } from './page.js';

export interface Env {
  DB: D1Database;
  /** Shared secret for publishing. Set with `wrangler secret put PUBLISH_TOKEN`. */
  PUBLISH_TOKEN?: string;
  /** Salt for hashing install ids before they are stored. */
  VOTER_SALT?: string;
}

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
 * Hashes an install id before it is stored.
 *
 * The registry needs to know that two votes came from the same machine. It does
 * not need to know which machine, so it never stores the raw id.
 */
async function hashVoter(raw: string, salt: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${salt}:${raw}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
      if (pack?.[1] && pack[2]) return downloadPack(pack[1], pack[2], env);

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

  // LIKE over three columns is enough at this size. D1 has FTS5 if the row
  // count ever justifies it.
  const where = query ? 'WHERE lower(a.id || a.name || a.description) LIKE ?1' : '';
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

async function publish(request: Request, env: Env): Promise<Response> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!env.PUBLISH_TOKEN || token !== env.PUBLISH_TOKEN) {
    return fail(401, 'Publishing needs a bearer token.', 'Set PUBLISH_TOKEN as a Wrangler secret.');
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

  const existing = await env.DB.prepare(
    'SELECT digest FROM versions WHERE adapter_id = ?1 AND version = ?2',
  )
    .bind(pack.id, pack.version)
    .first();

  if (existing) {
    // Republishing the identical bytes is a no-op. Republishing different bytes
    // under the same version would break every pinned install.
    if (existing.digest === digest) return json({ ok: true, unchanged: true, digest });
    return fail(409, `${pack.id}@${pack.version} already exists with a different digest.`);
  }

  const now = Date.now();
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
  ]);

  return json({ ok: true, id: pack.id, version: pack.version, digest }, 201);
}

async function rateAdapter(id: string, request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as { score?: number; installId?: string };
  const score = Number(body.score);

  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return fail(400, 'Score must be a whole number from 1 to 5.');
  }
  if (!body.installId || body.installId.length < 8) {
    return fail(400, 'Send an installId so a rating can be changed later.');
  }

  const exists = await env.DB.prepare('SELECT 1 FROM adapters WHERE id = ?1').bind(id).first();
  if (!exists) return fail(404, `No adapter called "${id}".`);

  const voter = await hashVoter(body.installId, env.VOTER_SALT ?? 'yougotserved');
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
