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
 * An origin fence works by checking a URL before navigation. Point it at a
 * redirector and the check passes, then the browser lands somewhere nobody
 * declared. That makes a shortener origin not a smell but a bypass, which is
 * why these score high enough to refuse on their own.
 *
 * This cannot be complete. Any site with an open redirect does the same thing,
 * and there is no list of those. It covers the ones whose only function is
 * this, which is the difference between closing a door and pretending there is
 * only one.
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
]);

/**
 * Where throwaway domains are cheapest.
 *
 * Real sites live on these too, so this is worth a look rather than a refusal.
 */
const CHEAP_TLDS = new Set([
  'xyz',
  'top',
  'click',
  'link',
  'shop',
  'live',
  'icu',
  'cyou',
  'sbs',
  'rest',
  'quest',
  'monster',
  'buzz',
  'work',
  'fit',
]);

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
  const cheap = new Set<string>();
  const punycode = new Set<string>();
  const lookalike = new Set<string>();

  for (const value of values) {
    const host = hostOf(value);
    if (!host) continue;
    hosts.push(host);

    const labels = host.split('.');
    const tld = labels[labels.length - 1] ?? '';
    const registrable = labels.slice(-2).join('.');

    if (REDIRECTORS.has(host) || REDIRECTORS.has(registrable)) redirectors.add(host);
    if (CHEAP_TLDS.has(tld)) cheap.add(host);

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
      // On its own, enough to refuse. An origin fence around a redirector
      // fences nothing.
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
  if (cheap.size > 0) {
    findings.push({
      rule: 'cheap-tld',
      detail: `throwaway-friendly domain: ${[...cheap].join(', ')}`,
      weight: 2,
    });
  }

  return { findings, hosts };
}
