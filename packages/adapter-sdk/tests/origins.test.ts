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
