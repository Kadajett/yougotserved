import { describe, expect, it } from 'vitest';
import { reviewImpersonation, skeleton } from '../src/index.js';

const rules = (input: Parameters<typeof reviewImpersonation>[0]) =>
  reviewImpersonation(input).map((f) => f.rule);

const weight = (input: Parameters<typeof reviewImpersonation>[0]) =>
  reviewImpersonation(input).reduce((total, f) => total + f.weight, 0);

describe('skeleton', () => {
  it('folds the ASCII lookalikes a Latin-only filter misses', () => {
    expect(skeleton('linkedln.com')).toBe(skeleton('linkedin.com'));
    expect(skeleton('1inkedin.com')).toBe(skeleton('linkedin.com'));
    expect(skeleton('rnicrosoft.com')).toBe(skeleton('microsoft.com'));
    expect(skeleton('g00gle.com')).toBe(skeleton('google.com'));
    expect(skeleton('linked-in.com')).toBe(skeleton('linkedin.com'));
  });

  it('keeps genuinely different names apart', () => {
    expect(skeleton('github.com')).not.toBe(skeleton('gitlab.com'));
    expect(skeleton('lever.co')).not.toBe(skeleton('linkedin.com'));
  });
});

describe('reviewImpersonation', () => {
  it('says nothing about a pack that is what it says it is', () => {
    expect(
      rules({
        origins: ['https://www.linkedin.com'],
        prose: 'Search LinkedIn for people and read a profile.',
      }),
    ).toEqual([]);
  });

  it('says nothing about the adapters already shipped', () => {
    const shipped: Array<[string, string]> = [
      ['https://github.com', 'Search GitHub repositories and star one.'],
      ['https://mail.google.com', 'Read a Gmail thread and save it.'],
      ['https://jobs.lever.co', 'Read a Lever job posting and apply to it.'],
      ['https://*.myworkdayjobs.com', 'Read a Workday job posting.'],
      ['https://news.ycombinator.com', 'Read the top Hacker News stories.'],
      ['https://old.reddit.com', 'Read a Reddit thread and save a comment.'],
    ];
    for (const [origin, prose] of shipped) {
      expect(rules({ origins: [origin], prose })).toEqual([]);
    }
  });

  it('refuses a domain that reads as a real one', () => {
    // The whole point. Every character here is ordinary ASCII.
    const found = rules({
      origins: ['https://linkedln.com'],
      prose: 'Search LinkedIn for people.',
    });
    expect(found).toContain('lookalike-domain');
    expect(
      weight({ origins: ['https://linkedln.com'], prose: 'Search LinkedIn for people.' }),
    ).toBeGreaterThanOrEqual(7);
  });

  it('refuses a brand parked in a subdomain', () => {
    expect(
      rules({ origins: ['https://linkedin.com.jobs-apply.co'], prose: 'Apply on LinkedIn.' }),
    ).toContain('brand-as-subdomain');
  });

  it('asks about a one-character miss rather than deciding', () => {
    const found = reviewImpersonation({ origins: ['https://githubb.com'], prose: 'A code tool.' });
    expect(found.map((f) => f.rule)).toContain('near-miss-domain');
    expect(found.find((f) => f.rule === 'near-miss-domain')?.weight).toBeLessThan(7);
  });

  it('catches prose that names somewhere the fence does not go', () => {
    // The deception a person actually falls for: the description is the part
    // they read, and it says LinkedIn.
    const found = rules({
      origins: ['https://totally-unrelated.xyz'],
      prose: 'Search LinkedIn for people, save profiles, and export your LinkedIn network.',
    });
    expect(found).toContain('claims-elsewhere');
  });

  it('does not fire when the brand named is the site fenced', () => {
    expect(
      rules({
        origins: ['https://mail.google.com'],
        prose: 'Read Gmail. Google account required.',
      }),
    ).toEqual([]);
  });

  it('uses what the registry already serves, not only its own list', () => {
    // No list needs curating for this: every published origin is a name
    // somebody might imitate.
    expect(
      rules({
        origins: ['https://crates-io.com'],
        prose: 'Search Rust crates.',
        known: ['crates.io'],
      }),
    ).toContain('brand-in-domain');
  });

  it('catches a brand carried into another domain', () => {
    // Skeleton equality cannot see these: the suffix differs, which is the
    // whole trick.
    expect(rules({ origins: ['https://linkedin-jobs.com'], prose: 'Apply to jobs.' })).toContain(
      'brand-in-domain',
    );
  });

  it('does not flag a short brand name found inside an ordinary word', () => {
    // "lever" lives inside "clever", and a registry that refuses that is
    // refusing real adapters.
    expect(rules({ origins: ['https://clever-tools.com'], prose: 'A build tool.' })).toEqual([]);
  });
});
