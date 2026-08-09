/**
 * Is this origin somewhere an adapter has no business being?
 *
 * Two questions with two different answers behind them. Gambling, phishing and
 * redirectors come from a held corpus, refreshed weekly, because nobody
 * publishes a resolver for those. Porn and malware come from Cloudflare's
 * filtering resolver, live, because they do, and asking is cheaper and fresher
 * than holding half a million more domains.
 *
 * Neither list is ours and neither is written here. A registry that tried to
 * enumerate the internet's casinos would have a list that was wrong the week it
 * shipped.
 */

import type { Env } from './index.js';

/**
 * Held for the life of the isolate.
 *
 * The blob is a couple of megabytes and parsing it is the expensive part, so it
 * happens once per isolate rather than once per request. A cold start pays one
 * KV read.
 */
let loaded: { blob: string; list: unknown } | null = null;

async function corpus(
  env: Env,
): Promise<InstanceType<typeof import('@yougotserved/blocklist').Blocklist> | null> {
  if (!env.BLOCKLIST) return null;

  const blob = await env.BLOCKLIST.get('domains');
  if (!blob) return null;

  if (!loaded || loaded.blob !== blob) {
    const { Blocklist } = await import('@yougotserved/blocklist');
    loaded = { blob, list: new Blocklist(blob) };
  }
  return loaded.list as InstanceType<typeof import('@yougotserved/blocklist').Blocklist>;
}

export interface Categorised {
  host: string;
  category: string;
}

/**
 * Categorises every origin a pack declares.
 *
 * Both sources fail open. A KV miss or a DNS hiccup should not refuse an honest
 * adapter, and this is one signal among several rather than the whole decision.
 */
export async function categoriseOrigins(
  env: Env,
  origins: readonly string[],
): Promise<Categorised[]> {
  const { resolverCategory } = await import('@yougotserved/blocklist');
  const list = await corpus(env);

  const hosts = [
    ...new Set(
      origins
        .map((origin) =>
          origin
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, '')
            .replace(/^\*\./, '')
            .replace(/[/:].*$/, ''),
        )
        .filter(Boolean),
    ),
  ];

  const found: Categorised[] = [];

  for (const host of hosts) {
    const held = list?.categoryOf(host);
    if (held) {
      found.push({ host, category: held });
      continue;
    }

    const live = await resolverCategory(host);
    if (live) found.push({ host, category: live });
  }

  return found;
}

/**
 * Rebuilds the held corpus. Runs on a schedule, never in a request.
 *
 * A source that fails is skipped rather than failing the refresh, and the
 * previous value keeps answering until a complete-enough one replaces it.
 */
export async function refreshBlocklist(env: Env): Promise<Record<string, unknown>> {
  if (!env.BLOCKLIST) return { skipped: 'no KV namespace bound' };

  const { fetchAll } = await import('@yougotserved/blocklist');
  const { blob, counts, failed } = await fetchAll();

  // A refresh that lost most of its sources would quietly turn the check off.
  // Better to keep last week's answers than to install an empty list.
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  if (total < 10_000)
    return { refused: 'too few domains, keeping the previous list', counts, failed };

  await env.BLOCKLIST.put('domains', blob);
  await env.BLOCKLIST.put('updated', String(Date.now()));
  return { ok: true, counts, failed, total };
}
