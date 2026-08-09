/**
 * Domain categories, from lists other people maintain.
 *
 * Deciding whether a hostname is a porn site, a casino, or a phishing page is
 * not a problem worth solving here, and an attempt would produce a list that
 * was wrong the week it shipped. Somebody already maintains these, continuously
 * and at a scale nobody in this repository is going to match.
 *
 * So this file contains no domains. It knows how to read lists, reduce them to
 * something a Worker can hold, and answer a question about a hostname. The
 * corpus is a dependency, and updating it is a scheduled fetch rather than a
 * commit.
 *
 * Two sources, chosen for different reasons:
 *
 *   Cloudflare's filtering resolver answers about porn and malware live, with
 *   nothing stored on our side at all. It is free, it needs no key, and it is
 *   already what a great many people's DNS points at.
 *
 *   The Blocklist Project covers what that resolver does not, gambling in
 *   particular, and is public domain. It has to be fetched and held, which is
 *   the cost of the categories Cloudflare declines to take a position on.
 */

/** Where the held categories come from. Public domain, one file per category. */
export const SOURCES: Record<string, string> = {
  gambling: 'https://raw.githubusercontent.com/blocklistproject/Lists/master/gambling.txt',
  phishing: 'https://raw.githubusercontent.com/blocklistproject/Lists/master/phishing.txt',
  scam: 'https://raw.githubusercontent.com/blocklistproject/Lists/master/scam.txt',
  // Supersedes any hand-written list of URL shorteners. An origin fence around
  // a redirector fences nothing, and there are ninety thousand of them.
  redirect: 'https://raw.githubusercontent.com/blocklistproject/Lists/master/redirect.txt',
};

export type Category = keyof typeof SOURCES | 'porn' | 'malware';

/**
 * Reduces a hosts file to registrable domains.
 *
 * The lists carry every subdomain a category has been seen on, which is right
 * for a DNS sinkhole and wrong here: an adapter declares a site, and a site is
 * its registrable domain. Reducing cuts 342,000 gambling hosts to 338,000
 * domains and, more usefully, makes a subdomain nobody listed still match.
 *
 * "Registrable" is the last two labels, which is not correct for
 * `example.co.uk` and is close enough for a check whose answer is "ask a
 * person". Getting it exactly right means shipping the public suffix list,
 * which is another corpus, to gain very little.
 */
export function parseHosts(text: string): Set<string> {
  const domains = new Set<string>();

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // `0.0.0.0 example.com`, the hosts-file form every one of these uses.
    const parts = trimmed.split(/\s+/);
    const host = (parts.length > 1 ? parts[1] : parts[0])?.toLowerCase().replace(/^\.+/, '');
    if (!host || !host.includes('.')) continue;

    const labels = host.split('.');
    domains.add(labels.slice(-2).join('.'));
  }

  return domains;
}

/** One line per domain, prefixed by category. Small, and diffable by eye. */
export function buildBlob(byCategory: Record<string, Set<string>>): string {
  const lines: string[] = [];
  for (const [category, domains] of Object.entries(byCategory)) {
    for (const domain of domains) lines.push(`${category} ${domain}`);
  }
  return lines.sort().join('\n');
}

export function parseBlob(blob: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of blob.split('\n')) {
    const space = line.indexOf(' ');
    if (space < 1) continue;
    map.set(line.slice(space + 1), line.slice(0, space));
  }
  return map;
}

/**
 * Fetches every source and reduces it.
 *
 * Run on a schedule, never in a request. A source that fails is skipped rather
 * than failing the build: three categories out of four is better than none, and
 * the previous blob keeps answering until this one replaces it.
 */
export async function fetchAll(
  sources: Record<string, string> = SOURCES,
): Promise<{ blob: string; counts: Record<string, number>; failed: string[] }> {
  const byCategory: Record<string, Set<string>> = {};
  const failed: string[] = [];

  for (const [category, url] of Object.entries(sources)) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(String(response.status));
      byCategory[category] = parseHosts(await response.text());
    } catch {
      failed.push(category);
    }
  }

  const counts: Record<string, number> = {};
  for (const [category, domains] of Object.entries(byCategory)) counts[category] = domains.size;

  return { blob: buildBlob(byCategory), counts, failed };
}

/**
 * A loaded blocklist.
 *
 * Held as a plain Map, which for half a million entries is a few tens of
 * megabytes of Worker memory and a lookup too fast to measure. Built once per
 * isolate and reused.
 */
export class Blocklist {
  private readonly domains: Map<string, string>;

  constructor(blob: string) {
    this.domains = parseBlob(blob);
  }

  get size(): number {
    return this.domains.size;
  }

  /**
   * The category a hostname falls in, or null.
   *
   * Walks up the labels, so `promo.casino.example` matches a listed
   * `casino.example` without the list having to carry every subdomain.
   */
  categoryOf(host: string): string | null {
    const labels = host.toLowerCase().replace(/^\*\./, '').split('.');
    for (let index = 0; index < labels.length - 1; index++) {
      const candidate = labels.slice(index).join('.');
      const category = this.domains.get(candidate);
      if (category) return category;
    }
    return null;
  }
}

/**
 * Asks Cloudflare's filtering resolver about porn and malware.
 *
 * `family` sinkholes adult content and malware to 0.0.0.0; `security` covers
 * malware alone. Using the resolver rather than a list means nothing is stored,
 * nothing goes stale, and the judgement is Cloudflare's rather than ours, which
 * for a category this large is the point.
 *
 * A resolver that does not answer returns null. This check failing open is
 * correct: it is one signal among several, and a DNS hiccup should not refuse
 * an honest adapter.
 */
export async function resolverCategory(host: string): Promise<'porn' | 'malware' | null> {
  const ask = async (endpoint: string): Promise<boolean | null> => {
    try {
      const response = await fetch(
        `https://${endpoint}/dns-query?name=${encodeURIComponent(host)}&type=A`,
        { headers: { accept: 'application/dns-json' } },
      );
      if (!response.ok) return null;

      const body = (await response.json()) as { Answer?: Array<{ data?: string }> };
      const answers = (body.Answer ?? []).map((a) => a.data);
      if (answers.length === 0) return null;
      return answers.includes('0.0.0.0');
    } catch {
      return null;
    }
  };

  const blockedByFamily = await ask('family.cloudflare-dns.com');
  if (blockedByFamily !== true) return null;

  // Family blocks adult content and malware together, so ask the malware-only
  // resolver which of the two it is. A category shown to a moderator should say
  // what was actually found.
  const blockedBySecurity = await ask('security.cloudflare-dns.com');
  return blockedBySecurity === true ? 'malware' : 'porn';
}
