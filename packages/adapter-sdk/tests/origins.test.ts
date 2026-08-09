import { describe, expect, it } from 'vitest';
import { createUrlGuard, OriginError, parseOriginPattern } from '../src/origins.js';

describe('parseOriginPattern', () => {
  it('defaults a bare host to https', () => {
    const rule = parseOriginPattern('linkedin.com');
    expect(rule.protocol).toBe('https:');
    expect(rule.host).toBe('linkedin.com');
    expect(rule.includeSubdomains).toBe(false);
  });

  it('understands a leading wildcard', () => {
    expect(parseOriginPattern('*.linkedin.com').includeSubdomains).toBe(true);
    expect(parseOriginPattern('https://*.linkedin.com').host).toBe('linkedin.com');
  });

  it('rejects paths, so a fence cannot be mistaken for a route matcher', () => {
    expect(() => parseOriginPattern('https://linkedin.com/feed')).toThrow(
      /must not include a path/,
    );
  });

  it('rejects schemes that are not http', () => {
    expect(() => parseOriginPattern('file://etc')).toThrow(OriginError);
    expect(() => parseOriginPattern('chrome-extension://abc')).toThrow(OriginError);
  });

  it('rejects wildcards anywhere but the front', () => {
    expect(() => parseOriginPattern('linked*.com')).toThrow(/only wildcard/);
  });

  // The declaration is the whole security boundary: the guard enforces it
  // exactly, so whatever a pack may declare, a pack may reach. These used to be
  // accepted, which handed an installed adapter the user's own network.
  it('rejects addresses, which can name the user’s own network', () => {
    for (const pattern of ['127.0.0.1', '192.168.1.1', '10.0.0.5', '169.254.169.254', '0.0.0.0']) {
      expect(() => parseOriginPattern(pattern)).toThrow(/is an address, not a site/);
    }
  });

  it('rejects hosts with no dot, which resolve on the local network', () => {
    expect(() => parseOriginPattern('router')).toThrow(/no dot/);
    expect(() => parseOriginPattern('intranet')).toThrow(/no dot/);
  });

  it('rejects suffixes that never name a public site', () => {
    for (const pattern of [
      'localhost',
      'app.localhost',
      'printer.local',
      'host.docker.internal',
      'box.home.arpa',
      'thing.lan',
    ]) {
      expect(() => parseOriginPattern(pattern)).toThrow(OriginError);
    }
  });

  it('still allows a real site', () => {
    expect(parseOriginPattern('https://*.myworkdayjobs.com').host).toBe('myworkdayjobs.com');
    expect(parseOriginPattern('news.ycombinator.com').host).toBe('news.ycombinator.com');
  });

  it('lets a pack under development opt in, which the registry never does', () => {
    expect(parseOriginPattern('localhost:3000', { allowPrivate: true }).host).toBe('localhost');
    expect(parseOriginPattern('127.0.0.1', { allowPrivate: true }).host).toBe('127.0.0.1');
  });
});

describe('createUrlGuard', () => {
  it('refuses an adapter with no origins', () => {
    expect(() => createUrlGuard([])).toThrow(/at least one origin/);
  });

  it('matches the exact host only, without a wildcard', () => {
    const guard = createUrlGuard(['https://www.linkedin.com']);
    expect(guard.allows('https://www.linkedin.com/feed')).toBe(true);
    expect(guard.allows('https://linkedin.com/feed')).toBe(false);
    expect(guard.allows('https://evil.www.linkedin.com/feed')).toBe(false);
  });

  it('matches the apex and its subdomains with a wildcard', () => {
    const guard = createUrlGuard(['*.linkedin.com']);
    expect(guard.allows('https://linkedin.com/feed')).toBe(true);
    expect(guard.allows('https://www.linkedin.com/feed')).toBe(true);
    expect(guard.allows('https://api.linkedin.com/v2')).toBe(true);
  });

  it('does not let a lookalike host through', () => {
    const guard = createUrlGuard(['*.linkedin.com']);
    expect(guard.allows('https://linkedin.com.evil.test/feed')).toBe(false);
    expect(guard.allows('https://notlinkedin.com/feed')).toBe(false);
    expect(guard.allows('https://xlinkedin.com/feed')).toBe(false);
  });

  it('holds the scheme', () => {
    const guard = createUrlGuard(['https://www.linkedin.com']);
    expect(guard.allows('http://www.linkedin.com/feed')).toBe(false);
  });

  it('rejects non-http schemes and garbage', () => {
    const guard = createUrlGuard(['*.linkedin.com']);
    expect(guard.allows('javascript:alert(1)')).toBe(false);
    expect(guard.allows('file:///etc/passwd')).toBe(false);
    expect(guard.allows('not a url')).toBe(false);
  });

  it('names the declared origins when it refuses', () => {
    const guard = createUrlGuard(['*.linkedin.com']);
    expect(() => guard.assert('https://bank.test/transfer')).toThrow(/\*\.linkedin\.com/);
  });
});
