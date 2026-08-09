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

  it('refuses a public URL shortener, which is a constant and not a corpus', () => {
    // The blocklist's `redirect` category is malicious redirect domains, a
    // different and much larger problem that does not contain bit.ly. Both
    // checks are needed; neither replaces the other.
    expect(rules(['bit.ly'])).toContain('redirector');
    expect(rules(['https://tinyurl.com/abcdef'])).toContain('redirector');
    expect(reviewUrls(['bit.ly']).findings[0]?.weight).toBeGreaterThanOrEqual(7);
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

  it('no longer guesses from the suffix', () => {
    // A .xyz domain is not evidence of anything. That rule was a guess standing
    // in for a corpus, and the corpus exists now.
    expect(rules(['https://deals.xyz'])).toEqual([]);
  });
});

describe('review, with links judged as well as counted', () => {
  it('still counts a wall of links', () => {
    const verdict = review(
      'deals https://a.example https://b.example https://c.example https://d.example',
    );
    expect(verdict.findings.map((f) => f.rule)).toContain('links');
  });

  it('still allows one ordinary link', () => {
    expect(review('Docs at https://example.com for the field names.').severity).toBe('allow');
  });
});
