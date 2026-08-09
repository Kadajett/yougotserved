/**
 * Spam heuristics.
 *
 * Deterministic on purpose. Every rule here can be read, argued with, and
 * unit tested, and it returns the same answer today and next year. A model
 * would catch more and explain less, and this runs at the edge for nothing.
 *
 * Each rule returns a weight rather than a verdict. One link is not spam. One
 * link plus a wallet address plus shouting is. Scoring lets the caller draw the
 * line, and lets a moderation queue show why something was held.
 */

import type { Normalised } from './normalize.js';

export interface Finding {
  /** Stable identifier, safe to store and count. */
  rule: string;
  /** One line a human moderator can act on. */
  detail: string;
  weight: number;
}

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

/** Bare domains, for text that lists a site without a scheme. */
const BARE_DOMAIN = /\b[a-z0-9-]+\.(?:com|net|org|io|xyz|top|ru|cn|link|click|shop|live)\b/gi;

/** Wallet-shaped strings. Almost never legitimate in a description. */
const WALLET = /\b(?:0x[a-f0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{25,62})\b/gi;

/** Where spam asks you to continue the conversation. */
const OFF_PLATFORM = /\b(?:t\.me|telegram|whats?app|wechat|skype|discord\.gg)\b/gi;

const EMOJI = /\p{Extended_Pictographic}/gu;

export interface SpamOptions {
  /** Links allowed before it counts against the text. */
  maxLinks?: number;
}

export function scoreSpam(source: Normalised, options: SpamOptions = {}): Finding[] {
  const { text } = source;
  const findings: Finding[] = [];
  const maxLinks = options.maxLinks ?? 2;

  const links = [...(text.match(URL_PATTERN) ?? []), ...(text.match(BARE_DOMAIN) ?? [])];
  if (links.length > maxLinks) {
    findings.push({
      rule: 'links',
      detail: `${links.length} links, limit ${maxLinks}`,
      weight: Math.min(4, links.length - maxLinks),
    });
  }

  const wallets = text.match(WALLET) ?? [];
  if (wallets.length > 0) {
    findings.push({
      rule: 'wallet',
      detail: `${wallets.length} wallet-shaped string(s)`,
      weight: 5,
    });
  }

  const offPlatform = text.match(OFF_PLATFORM) ?? [];
  if (offPlatform.length > 0) {
    findings.push({
      rule: 'off-platform',
      detail: `points elsewhere: ${[...new Set(offPlatform)].join(', ')}`,
      weight: 3,
    });
  }

  // Hidden characters have no honest use in a description. Their only purpose
  // is to look like one thing to a reader and another to a matcher.
  if (source.invisible > 0) {
    findings.push({
      rule: 'invisible',
      detail: `${source.invisible} invisible character(s)`,
      weight: 4,
    });
  }
  if (source.confusables > 2) {
    findings.push({
      rule: 'confusables',
      detail: `${source.confusables} non-Latin lookalike character(s)`,
      weight: 3,
    });
  }
  if (source.combining > 8) {
    findings.push({
      rule: 'combining',
      detail: `${source.combining} stacked marks`,
      weight: 3,
    });
  }

  // Read off the source rather than `text`, which is already lowercased.
  if (source.letters >= 12 && source.caps > 0.6) {
    findings.push({
      rule: 'shouting',
      detail: `${Math.round(source.caps * 100)}% capitals`,
      weight: 2,
    });
  }

  const runs = text.match(/(.)\1{5,}/gu) ?? [];
  if (runs.length > 0) {
    findings.push({ rule: 'runs', detail: `${runs.length} long repeated run(s)`, weight: 2 });
  }

  const emoji = (text.match(EMOJI) ?? []).length;
  if (emoji > 8) {
    findings.push({ rule: 'emoji', detail: `${emoji} emoji`, weight: 2 });
  }

  // The same word over and over, which is keyword stuffing rather than writing.
  const words = text.match(/[a-z]{3,}/g) ?? [];
  if (words.length >= 10) {
    const counts = new Map<string, number>();
    for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
    const [top, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
    if (count / words.length > 0.3) {
      findings.push({
        rule: 'repetition',
        detail: `"${top}" is ${Math.round((count / words.length) * 100)}% of the words`,
        weight: 3,
      });
    }
  }

  return findings;
}
