/**
 * Judging the links themselves, rather than counting them.
 *
 * The spam rules score how many links a piece of text has. That catches a wall
 * of them and says nothing about one. This says something about one.
 *
 * It matters most for an adapter's declared origins, which are not prose at
 * all. Origins are the security boundary: the host lets a pack reach exactly
 * what it declared, so a bad declaration is not a cosmetic problem. The SDK
 * refuses the ones that are unsafe by construction, addresses and local names.
 * What is left is the ones that are unsafe by reputation, and reputation is a
 * registry policy that should be able to change without shipping a new SDK to
 * every install. So it lives here.
 */

import { normalise } from './normalize.js';
import type { Finding } from './spam.js';

/**
 * Hosts whose entire purpose is to forward somewhere else.
 *
 * This one stays a constant, and the distinction is worth stating because I got
 * it wrong once. Gambling is a corpus: hundreds of thousands of domains, new
 * ones daily, impossible to enumerate here and pointless to try. Public URL
 * shorteners are not. There are a couple of dozen anyone actually uses, the set
 * has barely moved in a decade, and a new one appearing is a news event rather
 * than a Tuesday.
 *
 * The Blocklist Project's `redirect` list is not this list. It carries malicious
 * redirect domains, which is a different and much larger problem, and it does
 * not contain bit.ly for the good reason that bit.ly is not malware. Both
 * checks are needed and neither replaces the other.
 *
 * An origin fence around any of these fences nothing: the check passes and the
 * browser lands somewhere nobody declared. So it refuses on its own.
 */
const REDIRECTORS = new Set([
  'bit.ly',
  'tinyurl.com',
  't.co',
  'goo.gl',
  'ow.ly',
  'buff.ly',
  'is.gd',
  'cutt.ly',
  'rebrand.ly',
  'shorturl.at',
  'rb.gy',
  'bit.do',
  'tiny.cc',
  'lnkd.in',
  't.ly',
  'shorte.st',
  'adf.ly',
  'bc.vc',
  'linktr.ee',
  'trib.al',
  'dlvr.it',
  'ift.tt',
  'shrtco.de',
  'short.io',
  'snip.ly',
]);

/*
 * The cheap-TLD list that used to sit here is gone with nothing replacing it.
 * It was a guess standing in for a corpus we did not have, and it flagged
 * honest adapters on .xyz for no better reason than the suffix. Now that the
 * actual bad domains are known by name, guessing at them by suffix is worse
 * than not guessing.
 */

/** Pulls the host out of a URL or a bare hostname pattern. */
export function hostOf(value: string): string | null {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/^\*\./, '')
    .replace(/^(https?:\/\/)?/, 'https://');
  try {
    return new URL(cleaned).hostname || null;
  } catch {
    return null;
  }
}

export interface UrlVerdict {
  findings: Finding[];
  /** Hosts that were understood, for a moderator to read back. */
  hosts: string[];
}

/**
 * Reviews a list of hostnames or URLs.
 *
 * Used for an adapter's origins, and for the links found in its prose. Returns
 * findings on the same scale as everything else, so one caller can add them up.
 */
export function reviewUrls(values: readonly string[]): UrlVerdict {
  const findings: Finding[] = [];
  const hosts: string[] = [];

  const redirectors = new Set<string>();
  const punycode = new Set<string>();
  const lookalike = new Set<string>();

  for (const value of values) {
    const host = hostOf(value);
    if (!host) continue;
    hosts.push(host);

    const labels = host.split('.');
    if (REDIRECTORS.has(host) || REDIRECTORS.has(labels.slice(-2).join('.'))) {
      redirectors.add(host);
    }

    // `xn--` is a real internationalised name much of the time. It is also the
    // shape of a homograph attack, and the two are indistinguishable from the
    // string alone, so this asks a person rather than deciding.
    if (labels.some((label) => label.startsWith('xn--'))) punycode.add(host);

    // A host that still holds non-Latin lookalikes after normalisation was
    // written to be misread. Checked on the raw value, since `hostOf` has
    // already been through URL parsing, which does its own folding.
    const folded = normalise(value);
    if (folded.confusables > 0) lookalike.add(host);
  }

  if (redirectors.size > 0) {
    findings.push({
      rule: 'redirector',
      detail: `forwards elsewhere: ${[...redirectors].join(', ')}`,
      weight: 7,
    });
  }
  if (lookalike.size > 0) {
    findings.push({
      rule: 'lookalike-host',
      detail: `non-Latin lookalike characters in: ${[...lookalike].join(', ')}`,
      weight: 7,
    });
  }
  if (punycode.size > 0) {
    findings.push({
      rule: 'punycode-host',
      detail: `internationalised, worth reading: ${[...punycode].join(', ')}`,
      weight: 3,
    });
  }
  return { findings, hosts };
}
