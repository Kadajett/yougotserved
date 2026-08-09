/**
 * Origin fencing.
 *
 * An adapter runs against a browser holding the user's real cookies. The whole
 * point of the project is that `linkedin_search_people` uses a genuine
 * LinkedIn session — which also means a LinkedIn adapter that can navigate
 * anywhere is a LinkedIn adapter that can drive the user's bank.
 *
 * So every adapter declares the origins it needs, and the host refuses
 * navigation and extraction outside them. The declaration is data, checked by
 * the host, not a promise the adapter makes to itself.
 */

export class OriginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OriginError';
  }
}

/**
 * One entry from an adapter's `origins` list, parsed.
 *
 * Matching is explicit on purpose. `linkedin.com` allows exactly
 * `https://linkedin.com`; to include `www.` and the rest, write
 * `*.linkedin.com`. Implicit subdomain matching is where allowlists quietly
 * grow holes.
 */
export interface OriginRule {
  source: string;
  protocol: 'http:' | 'https:';
  host: string;
  port: string;
  includeSubdomains: boolean;
}

const HOST_PATTERN = /^[a-z0-9.-]+$/;

/** Anything that parses as a bare address rather than a name. */
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Suffixes that resolve to something on the user's own machine or network.
 *
 * From RFC 6761 and RFC 6762, plus the conventions container runtimes added on
 * their own. The list is deliberately not every reserved name: `.test`,
 * `.invalid` and `.example` are reserved too, and they route nowhere, so
 * refusing them would buy no safety while breaking the one naming convention
 * test fixtures are supposed to use.
 */
const PRIVATE_SUFFIXES = [
  'localhost',
  'local',
  'localdomain',
  'internal',
  'intranet',
  'lan',
  'home.arpa',
];

/**
 * Link shorteners, refused as origins.
 *
 * An origin fence works by checking a URL before navigation. Point it at a
 * service whose only function is to forward and the check passes, then the
 * browser lands somewhere nobody declared and nobody reviewed. A fence around a
 * redirector is not a weak fence, it is not a fence, which puts this in the same
 * class as "an address is not a site" rather than "we do not care for this
 * domain".
 *
 * Shorteners also do nothing for the reader. Their whole product is hiding where
 * a link goes; an adapter's whole promise is that you can see where it goes
 * before you install it. Both cannot be true at once.
 *
 * This lives in the SDK because the SDK is what both sides run. `validatePack`
 * is called by the registry on publish, so the server refuses these, and by the
 * bridge on install and on every load, so a pack that never went through the
 * registry is refused too. Server-side alone would be the version with the
 * bypass: hand someone a pack as a file and there is no server in the path.
 *
 * `@yougotserved/moderation` carries the same list for a different input. This
 * one decides whether a pack may exist; that one decides whether a description
 * is honest about where its links go. The SDK ships standalone, so it does not
 * import from a workspace package to share them.
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

/**
 * Refuses a host that names somewhere private rather than a site.
 *
 * This is the check that was missing, and it mattered more than it looks. The
 * runtime guard enforces an adapter's declared origins faithfully, which means
 * the declaration is the whole of the security boundary: a pack that declared
 * `192.168.1.1` was granted the user's router admin page, in a browser holding
 * their session, and the guard would have been working exactly as designed.
 *
 * Addresses are refused entirely rather than only the private ranges. A public
 * site has a name; a published pack pointing at a bare address has either got
 * something wrong or is trying to sidestep a name it did not want shown.
 */
function assertPublicHost(host: string, pattern: string): void {
  if (IPV4.test(host) || /^\[|:/.test(host)) {
    throw new OriginError(
      `Origin "${pattern}" is an address, not a site. Adapters run against a browser holding ` +
        `the user's session, so an address can name their own network. Use a hostname.`,
    );
  }

  const labels = host.split('.');
  if (labels.length < 2) {
    throw new OriginError(
      `Origin "${pattern}" has no dot, so it names a machine on the local network rather than ` +
        `a site on the internet.`,
    );
  }

  for (const suffix of PRIVATE_SUFFIXES) {
    if (host === suffix || host.endsWith(`.${suffix}`)) {
      throw new OriginError(
        `Origin "${pattern}" ends in ".${suffix}", which never names a public site.`,
      );
    }
  }
}

/**
 * Refuses a host that only forwards.
 *
 * Not gated behind {@link OriginOptions.allowPrivate}, unlike the checks above.
 * That flag exists so a pack can be developed against a machine on your desk,
 * which is a real thing to want; pointing a fence at bit.ly is not, at any stage.
 */
function assertNotRedirector(host: string, pattern: string): void {
  const labels = host.split('.');
  const registrable = labels.slice(-2).join('.');
  if (!REDIRECTORS.has(host) && !REDIRECTORS.has(registrable)) return;

  throw new OriginError(
    `Origin "${pattern}" is a link shortener, which forwards somewhere this adapter has not ` +
      `declared. Fencing to it fences nothing. Declare the site the links actually lead to.`,
  );
}

export interface OriginOptions {
  /**
   * Allow private and local hosts.
   *
   * For a pack being developed against a machine, never for one being
   * published. The registry does not pass it, and cannot be made to.
   */
  allowPrivate?: boolean;
}

export function parseOriginPattern(pattern: string, options: OriginOptions = {}): OriginRule {
  const raw = pattern.trim().toLowerCase();
  if (!raw) throw new OriginError('An origin pattern cannot be empty.');

  let wildcard = false;
  let candidate = raw;

  // Strip the wildcard before URL parsing; `https://*.example.com` is not a
  // legal URL, so the built-in parser would reject the very syntax we want.
  const wildcardMatch = candidate.match(/^(https?:\/\/)?\*\.(.+)$/);
  if (wildcardMatch) {
    wildcard = true;
    candidate = `${wildcardMatch[1] ?? ''}${wildcardMatch[2]}`;
  }
  if (candidate.includes('*')) {
    throw new OriginError(
      `Origin "${pattern}" is not supported. The only wildcard is a leading "*." ` +
        `(for example "*.linkedin.com").`,
    );
  }

  const withScheme = candidate.includes('://') ? candidate : `https://${candidate}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new OriginError(`Origin "${pattern}" is not a valid host or origin.`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new OriginError(`Origin "${pattern}" must be http or https.`);
  }
  if (!url.hostname || !HOST_PATTERN.test(url.hostname)) {
    throw new OriginError(`Origin "${pattern}" has no usable hostname.`);
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new OriginError(
      `Origin "${pattern}" must not include a path. Fence by origin; match paths inside the tool.`,
    );
  }
  if (!options.allowPrivate) assertPublicHost(url.hostname, pattern);
  assertNotRedirector(url.hostname, pattern);

  return {
    source: pattern.trim(),
    protocol: url.protocol,
    host: url.hostname,
    port: url.port,
    includeSubdomains: wildcard,
  };
}

function matches(rule: OriginRule, url: URL): boolean {
  if (url.protocol !== rule.protocol) return false;
  if (rule.port && url.port !== rule.port) return false;

  const host = url.hostname.toLowerCase();
  if (host === rule.host) return true;
  return rule.includeSubdomains && host.endsWith(`.${rule.host}`);
}

export interface UrlGuard {
  /** The patterns this guard was built from, for error messages and audit. */
  readonly origins: readonly string[];
  allows(url: string): boolean;
  /** Throws {@link OriginError} instead of returning false. */
  assert(url: string, action?: string): void;
}

/**
 * Builds the guard the host wraps around every navigation an adapter attempts.
 */
export function createUrlGuard(patterns: readonly string[], options: OriginOptions = {}): UrlGuard {
  if (patterns.length === 0) {
    throw new OriginError(
      'An adapter must declare at least one origin. Tools run against a logged-in browser, ' +
        'so there is no safe default.',
    );
  }
  const rules = patterns.map((pattern) => parseOriginPattern(pattern, options));
  const sources = rules.map((rule) => rule.source);

  function allows(candidate: string): boolean {
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      return false;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return rules.some((rule) => matches(rule, url));
  }

  return {
    origins: sources,
    allows,
    assert(candidate: string, action = 'navigate to') {
      if (!allows(candidate)) {
        throw new OriginError(
          `Refusing to ${action} ${candidate}: outside this adapter's declared origins ` +
            `(${sources.join(', ')}).`,
        );
      }
    },
  };
}
