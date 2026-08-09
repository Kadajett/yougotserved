import { describe, expect, it } from 'vitest';
import { hostOf, review, reviewUrls } from '../src/index.js';

const rules = (values: string[]) => reviewUrls(values).findings.map((f) => f.rule);

describe('hostOf', () => {
  it('reads a bare host, a wildcard pattern, and a full URL the same way', () => {
    expect(hostOf('github.com')).toBe('github.com');
    expect(hostOf('*.wikipedia.org')).toBe('wikipedia.org');
    expect(hostOf('https://jobs.lever.co/acme')).toBe('jobs.lever.co');
  });

  it('returns null rather than throwing on nonsense', () => {
    expect(hostOf('not a url at all !!')).toBeNull();
  });
});

describe('reviewUrls', () => {
  it('passes the origins every shipped adapter actually uses', () => {
    expect(
      rules([
        'https://github.com',
        'https://news.ycombinator.com',
        'https://*.wikipedia.org',
        'https://*.myworkdayjobs.com',
        'https://jobs.eu.lever.co',
      ]),
    ).toEqual([]);
  });

  it('flags a redirector hard enough to refuse on its own', () => {
    // An origin fence around a shortener fences nothing: the check passes and
    // then the browser lands somewhere nobody declared.
    const verdict = reviewUrls(['bit.ly']);
    expect(verdict.findings.map((f) => f.rule)).toContain('redirector');
    expect(verdict.findings[0]?.weight).toBeGreaterThanOrEqual(7);
  });

  it('catches a redirector written as a full URL', () => {
    expect(rules(['https://tinyurl.com/abcdef'])).toContain('redirector');
  });

  it('holds a host with non-Latin lookalikes', () => {
    // Cyrillic "е" in what reads as github.com.
    expect(rules(['https://githуb.com'])).toContain('lookalike-host');
  });

  it('asks about punycode rather than deciding', () => {
    const found = reviewUrls(['xn--80ak6aa92e.com']);
    expect(found.findings.map((f) => f.rule)).toContain('punycode-host');
    expect(found.findings[0]?.weight).toBeLessThan(7);
  });

  it('notes a throwaway-friendly domain without refusing it', () => {
    const found = reviewUrls(['https://deals.xyz']);
    expect(found.findings.map((f) => f.rule)).toContain('cheap-tld');
    expect(found.findings.reduce((t, f) => t + f.weight, 0)).toBeLessThan(7);
  });
});

describe('review, with links judged as well as counted', () => {
  it('refuses one link to a redirector, which counting never would', () => {
    const verdict = review('Handy tool, docs at https://bit.ly/abc for the field names.');
    expect(verdict.severity).toBe('block');
    expect(verdict.findings.map((f) => f.rule)).toContain('redirector');
  });

  it('still allows one ordinary link', () => {
    expect(review('Docs at https://example.com for the field names.').severity).toBe('allow');
  });
});
