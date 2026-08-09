import { describe, expect, it } from 'vitest';
import { fingerprint } from '../src/index.js';

const SPAM = 'Buy cheap followers now at https://deals.top, message telegram for the discount code';

describe('fingerprint', () => {
  it('is stable for the same text', async () => {
    expect(await fingerprint(SPAM)).toBe(await fingerprint(SPAM));
  });

  it('survives reordering, which is the cheapest way to dodge an exact match', async () => {
    const reordered =
      'message telegram for the discount code, buy cheap followers now at https://deals.top';
    expect(await fingerprint(reordered)).toBe(await fingerprint(SPAM));
  });

  it('survives padded letters and lookalike characters', async () => {
    const dressed =
      'Buy cheeeap fоllowers now at https://deals.top, message telegram for the discount code';
    expect(await fingerprint(dressed)).toBe(await fingerprint(SPAM));
  });

  it('separates unrelated text', async () => {
    const other = 'Search the npm registry and read a package page with its download counts';
    expect(await fingerprint(other)).not.toBe(await fingerprint(SPAM));
  });

  it('refuses text too short to fingerprint safely', async () => {
    // Hashing this would ban a sentiment rather than a submission.
    expect(await fingerprint('great tool thanks')).toBeNull();
    expect(await fingerprint('')).toBeNull();
  });
});
