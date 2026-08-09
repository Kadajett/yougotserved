import { describe, expect, it } from 'vitest';
import { normalise, review, reviewFields } from '../src/index.js';

describe('normalise', () => {
  it('folds Cyrillic lookalikes onto Latin', () => {
    // The whole reason normalisation runs first. Every character here is
    // non-Latin, and a filter comparing code points sees an unrelated string.
    expect(normalise('раssword').text).toBe('password');
  });

  it('counts and strips invisible characters', () => {
    const result = normalise('he​llo');
    expect(result.text).toBe('hello');
    expect(result.invisible).toBe(1);
  });

  it('folds fullwidth and mathematical alphabets', () => {
    expect(normalise('ｈｅｌｌｏ').text).toBe('hello');
    expect(normalise('𝐡𝐞𝐥𝐥𝐨').text).toBe('hello');
  });

  it('leaves ordinary text alone', () => {
    const result = normalise('A normal description.');
    expect(result.text).toBe('a normal description.');
    expect(result.confusables).toBe(0);
    expect(result.invisible).toBe(0);
  });
});

describe('review', () => {
  it('allows an ordinary adapter description', () => {
    const verdict = review('Search the npm registry and read a package page.');
    expect(verdict.severity).toBe('allow');
    expect(verdict.findings).toEqual([]);
  });

  it('allows a description with one link', () => {
    expect(review('Docs at https://example.com for the field names.').severity).toBe('allow');
  });

  it('holds text that stacks several weak signals', () => {
    const verdict = review('BUY NOW!!! https://a.xyz https://b.top https://c.click cheap deals');
    expect(verdict.severity).not.toBe('allow');
    expect(verdict.findings.map((f) => f.rule)).toContain('links');
  });

  it('blocks a wallet address with links', () => {
    const verdict = review(
      'send to 0x1234567890abcdef1234567890abcdef12345678 via https://a.xyz https://b.xyz https://c.xyz',
    );
    expect(verdict.severity).toBe('block');
    expect(verdict.findings.map((f) => f.rule)).toContain('wallet');
  });

  it('flags off-platform contact', () => {
    const verdict = review('message me on telegram for the full version');
    expect(verdict.findings.map((f) => f.rule)).toContain('off-platform');
  });

  it('flags invisible characters, which have no honest use here', () => {
    const verdict = review('cle​an descr​iption of a tool');
    expect(verdict.findings.map((f) => f.rule)).toContain('invisible');
  });

  it('catches profanity written with lookalike characters', () => {
    // Fails on any filter that matches before normalising.
    const plain = review('this is shit');
    const dressed = review('this is ѕhіt');
    expect(plain.findings.map((f) => f.rule)).toContain('profanity');
    expect(dressed.findings.map((f) => f.rule)).toContain('profanity');
  });

  it('catches profanity padded with repeated letters', () => {
    expect(review('shiiiiiit').findings.map((f) => f.rule)).toContain('profanity');
  });

  it('does not invent words from ordinary doubled letters', () => {
    expect(review('heello there, a greeting').severity).toBe('allow');
  });

  it('flags keyword stuffing', () => {
    const verdict = review('cheap cheap cheap cheap cheap viagra deals now today online here');
    expect(verdict.findings.map((f) => f.rule)).toContain('repetition');
  });

  it('flags shouting', () => {
    const verdict = review('THIS IS ENTIRELY UPPERCASE TEXT SHOUTING AT YOU');
    expect(verdict.findings.map((f) => f.rule)).toContain('shouting');
  });

  it('can be told to refuse profanity outright', () => {
    expect(review('this is shit', { strictProfanity: true }).severity).toBe('block');
  });

  it('always says why', () => {
    const verdict = review('0x1234567890abcdef1234567890abcdef12345678');
    expect(verdict.findings.length).toBeGreaterThan(0);
    for (const finding of verdict.findings) {
      expect(finding.rule).toBeTruthy();
      expect(finding.detail).toBeTruthy();
    }
  });

  it('handles empty and missing input without throwing', () => {
    expect(review('').severity).toBe('allow');
    expect(review(undefined as unknown as string).severity).toBe('allow');
  });
});

describe('reviewFields', () => {
  it('reports the worst field, not the first', () => {
    const verdict = reviewFields({
      name: 'npm',
      description: 'Search the npm registry.',
      toolDescription: 'send 0x1234567890abcdef1234567890abcdef12345678 to unlock',
    });
    expect(verdict.severity).not.toBe('allow');
    expect(verdict.field).toBe('toolDescription');
  });

  it('passes a wholly clean submission', () => {
    const verdict = reviewFields({
      name: 'crates.io',
      description: 'Search the Rust crate registry and read a crate page.',
    });
    expect(verdict.severity).toBe('allow');
  });
});
