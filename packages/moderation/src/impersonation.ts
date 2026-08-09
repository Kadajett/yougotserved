/**
 * Catching a pack that claims to be somewhere it is not.
 *
 * The scam this project actually has to worry about is not a link in a
 * description. It is an adapter called "LinkedIn people search" whose declared
 * origin is `linkedln.com`, with an l where the i goes. Someone reads the
 * description, installs it, and hands a lookalike site a browser holding their
 * real LinkedIn session. Everything downstream works exactly as designed.
 *
 * The existing confusable check does not see this, and could not: it folds
 * non-Latin characters onto Latin ones, and every character in `linkedln.com`
 * is already Latin. `rn` for `m`, `l` for `i`, `0` for `o` are attacks made of
 * ordinary ASCII, which is what makes them cheap.
 *
 * So there are two questions here, and the second is the sharper one:
 *
 *   Does this hostname look like a hostname we know?
 *   Does this pack's prose name a place its origins do not go?
 *
 * The second is what a person is actually deceived by. A pack whose description
 * says LinkedIn eleven times and whose fence points somewhere else is not an
 * accident, whatever the domain is spelled like.
 */

import { normalise } from './normalize.js';
import type { Finding } from './spam.js';
import { hostOf } from './urls.js';

/**
 * Sequences that render close enough to be read as each other.
 *
 * Ordered longest-first, because `rn` has to be folded before `r` and `n` are
 * considered on their own. This is the ASCII half of the Unicode confusables
 * skeleton, which is the half a Latin-only filter misses.
 */
const SHAPES: Array<[RegExp, string]> = [
  [/rn/g, 'm'],
  [/vv/g, 'w'],
  [/cl/g, 'd'],
  [/[1il|!]/g, 'i'],
  [/0/g, 'o'],
  [/5/g, 's'],
  [/8/g, 'b'],
  [/2/g, 'z'],
  [/9/g, 'g'],
  [/6/g, 'b'],
  [/\$/g, 's'],
];

/**
 * The visual shape of a hostname, with the differences that do not show removed.
 *
 * Two hosts with the same skeleton are, to a reader glancing at an address bar,
 * the same host. Hyphens and dots go too, so `linked-in.com` and `linkedin.com`
 * land together.
 */
export function skeleton(host: string): string {
  let shaped = normalise(host).text.replace(/[^a-z0-9]/g, '');
  for (const [pattern, replacement] of SHAPES) shaped = shaped.replace(pattern, replacement);
  return shaped;
}

/** The registrable part, near enough: the last two labels. */
function registrable(host: string): string {
  const labels = host.split('.');
  return labels.slice(-2).join('.');
}

/** Levenshtein, capped. Only ever called on two short domain strings. */
function distance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;

  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length] ?? 3;
}

/**
 * Sites where a stolen session is worth having.
 *
 * Deliberately short. The list that matters more is the one the registry
 * already holds: every origin it has published is a name somebody might
 * imitate, and that list maintains itself. This covers the targets worth
 * imitating before a real adapter for them exists.
 */
export const HIGH_VALUE = [
  'linkedin.com',
  'github.com',
  'gitlab.com',
  'google.com',
  'gmail.com',
  'mail.google.com',
  'microsoft.com',
  'live.com',
  'outlook.com',
  'apple.com',
  'icloud.com',
  'amazon.com',
  'paypal.com',
  'stripe.com',
  'coinbase.com',
  'binance.com',
  'facebook.com',
  'instagram.com',
  'x.com',
  'twitter.com',
  'reddit.com',
  'discord.com',
  'slack.com',
  'notion.so',
  'dropbox.com',
  'okta.com',
  'workday.com',
  'greenhouse.io',
  'lever.co',
];

/**
 * How a brand is written in prose, against every domain it legitimately uses.
 *
 * A list rather than one name, because a brand having several real domains is
 * the common case, and getting it wrong is a false positive on an honest pack.
 * Workday job boards live on myworkdayjobs.com, not workday.com, and an adapter
 * for them is not impersonating anybody.
 */
const BRAND_WORDS: Record<string, string[]> = {
  linkedin: ['linkedin.com'],
  github: ['github.com', 'githubusercontent.com'],
  gitlab: ['gitlab.com'],
  gmail: ['google.com', 'gmail.com'],
  google: ['google.com', 'youtube.com', 'gmail.com'],
  microsoft: ['microsoft.com', 'live.com', 'office.com', 'azure.com'],
  outlook: ['live.com', 'outlook.com', 'office.com'],
  apple: ['apple.com', 'icloud.com'],
  icloud: ['apple.com', 'icloud.com'],
  amazon: ['amazon.com'],
  paypal: ['paypal.com'],
  stripe: ['stripe.com'],
  coinbase: ['coinbase.com'],
  binance: ['binance.com'],
  facebook: ['facebook.com', 'fb.com'],
  instagram: ['instagram.com'],
  reddit: ['reddit.com', 'redd.it'],
  discord: ['discord.com', 'discord.gg'],
  slack: ['slack.com'],
  notion: ['notion.so', 'notion.com'],
  dropbox: ['dropbox.com'],
  okta: ['okta.com'],
  workday: ['workday.com', 'myworkdayjobs.com', 'myworkday.com'],
  greenhouse: ['greenhouse.io'],
  lever: ['lever.co'],
  ashby: ['ashbyhq.com'],
  workable: ['workable.com'],
  rippling: ['rippling.com'],
  wikipedia: ['wikipedia.org', 'wikimedia.org'],
  arxiv: ['arxiv.org'],
  pypi: ['pypi.org', 'python.org'],
  npm: ['npmjs.com', 'npmjs.org'],
};

/** True when `host` is `known`, or a subdomain of it. */
function isOrUnder(host: string, known: string): boolean {
  return host === known || host.endsWith(`.${known}`);
}

export interface ImpersonationInput {
  /** The pack's declared origins, as written. */
  origins: readonly string[];
  /** Name, description, tool descriptions: everything a person reads. */
  prose: string;
  /** Hostnames the registry already serves. Self-maintaining, and the best list. */
  known?: readonly string[];
}

/**
 * Reads a pack for the shape of an impersonation.
 *
 * Returns findings on the same scale as every other check, so one caller adds
 * them up. A skeleton collision refuses on its own. A near miss, or prose that
 * names somewhere the fence does not go, asks a person: both have honest
 * explanations, and a registry that refuses those loses real adapters.
 */
export function reviewImpersonation(input: ImpersonationInput): Finding[] {
  const findings: Finding[] = [];

  const hosts = input.origins
    .map((origin) => hostOf(origin))
    .filter((h): h is string => Boolean(h));
  if (hosts.length === 0) return findings;

  const targets = [...new Set([...HIGH_VALUE, ...(input.known ?? [])])];

  // Every domain any known brand legitimately answers on, plus everything the
  // registry already serves. Checked before any shape comparison, because a
  // real domain will often look like the brand it belongs to: myworkdayjobs.com
  // contains "workday" for the good reason that it is Workday.
  const legitimate = new Set([...targets, ...Object.values(BRAND_WORDS).flat()]);

  for (const host of hosts) {
    if ([...legitimate].some((known) => isOrUnder(host, known))) continue;

    const domain = registrable(host);
    const shape = skeleton(domain);

    for (const target of targets) {
      const targetShape = skeleton(target);

      // Identical to the eye, different to a resolver. There is no honest
      // reason to register this and point an adapter at it.
      if (shape === targetShape && domain !== target) {
        findings.push({
          rule: 'lookalike-domain',
          detail: `"${host}" reads as "${target}" but is not it`,
          weight: 8,
        });
        break;
      }

      // The brand as a label somewhere other than the end: linkedin.com.evil.co
      // reads left to right as LinkedIn and resolves to evil.co.
      const brandLabel = target.split('.')[0] ?? '';
      const labels = host.split('.').slice(0, -2);
      if (
        brandLabel.length >= 5 &&
        labels.some((label) => skeleton(label) === skeleton(brandLabel))
      ) {
        findings.push({
          rule: 'brand-as-subdomain',
          detail: `"${host}" puts "${brandLabel}" where a reader expects the site, but resolves to "${domain}"`,
          weight: 8,
        });
        break;
      }

      // One character out. Could be a typo squat, could be a real company with
      // a similar name, so this asks rather than decides.
      if (domain.length >= 7 && distance(shape, targetShape) === 1) {
        findings.push({
          rule: 'near-miss-domain',
          detail: `"${host}" is one character from "${target}"`,
          weight: 4,
        });
        break;
      }

      // The brand's name carried into a different domain: crates-io.com,
      // linkedin-jobs.com, githubb.com. Skeleton equality cannot see these
      // because the suffix differs, which is exactly why the trick works.
      //
      // Six characters minimum, or short names start matching inside ordinary
      // words: "lever" would flag "clever-tools.com". Even so this only asks,
      // because a genuine third-party tool names the site it serves.
      const brandName = skeleton(target.split('.')[0] ?? '');
      const ourName = skeleton(domain.split('.')[0] ?? '');
      if (brandName.length >= 6 && ourName !== brandName && ourName.includes(brandName)) {
        findings.push({
          rule: 'brand-in-domain',
          detail: `"${host}" carries "${target.split('.')[0]}" into a domain that is not ${target}`,
          weight: 4,
        });
        break;
      }
    }
  }

  // The sharper question. What a person is deceived by is the description, not
  // the domain: they read "LinkedIn", they install, and the fence goes
  // somewhere else entirely.
  const words = new Set(normalise(input.prose).text.match(/[a-z]{3,}/g) ?? []);
  for (const [word, homes] of Object.entries(BRAND_WORDS)) {
    if (!words.has(word)) continue;
    if (hosts.some((host) => homes.some((home) => isOrUnder(host, home)))) continue;

    findings.push({
      rule: 'claims-elsewhere',
      detail: `says "${word}" but no origin is ${homes.join(' or ')}: ${hosts.join(', ')}`,
      weight: 5,
    });
  }

  return findings;
}
