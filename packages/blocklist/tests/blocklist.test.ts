import { describe, expect, it } from 'vitest';
import { Blocklist, buildBlob, parseBlob, parseHosts } from '../src/index.js';

describe('parseHosts', () => {
  it('reads the hosts-file form every source uses', () => {
    const domains = parseHosts(`
# Title: gambling
# comment

0.0.0.0 casino.example
0.0.0.0 www.bet.example
    `);
    expect([...domains].sort()).toEqual(['bet.example', 'casino.example']);
  });

  it('reduces subdomains to the site, which is what an adapter declares', () => {
    const domains = parseHosts(
      ['0.0.0.0 a.slots.example', '0.0.0.0 b.slots.example', '0.0.0.0 slots.example'].join('\n'),
    );
    expect([...domains]).toEqual(['slots.example']);
  });

  it('skips comments, blanks, and anything without a dot', () => {
    expect(parseHosts('#x\n\n0.0.0.0 localhost\n0.0.0.0 ok.example').size).toBe(1);
  });

  it('accepts a bare domain list as well as a hosts file', () => {
    expect([...parseHosts('bare.example\nother.example')].sort()).toEqual([
      'bare.example',
      'other.example',
    ]);
  });
});

describe('blob', () => {
  it('round-trips', () => {
    const blob = buildBlob({
      gambling: new Set(['casino.example']),
      scam: new Set(['fake.example']),
    });
    const map = parseBlob(blob);
    expect(map.get('casino.example')).toBe('gambling');
    expect(map.get('fake.example')).toBe('scam');
  });
});

describe('Blocklist', () => {
  const list = new Blocklist(
    buildBlob({
      gambling: new Set(['casino.example', 'slots.example']),
      redirect: new Set(['short.example']),
    }),
  );

  it('finds a listed domain', () => {
    expect(list.categoryOf('casino.example')).toBe('gambling');
    expect(list.categoryOf('short.example')).toBe('redirect');
  });

  it('finds a subdomain the list never carried', () => {
    // The reduction to registrable domains is what buys this.
    expect(list.categoryOf('promo.casino.example')).toBe('gambling');
    expect(list.categoryOf('a.b.c.slots.example')).toBe('gambling');
  });

  it('handles the wildcard form an origin pattern uses', () => {
    expect(list.categoryOf('*.casino.example')).toBe('gambling');
  });

  it('says nothing about a site that is not listed', () => {
    expect(list.categoryOf('github.com')).toBeNull();
    expect(list.categoryOf('linkedin.com')).toBeNull();
  });

  it('does not match on a suffix that is not a label boundary', () => {
    // "notcasino.example" ends with "casino.example" as a string and is a
    // different site. Matching on characters rather than labels is how an
    // allowlist grows a hole, and a blocklist grows a false positive.
    expect(list.categoryOf('notcasino.example')).toBeNull();
  });
});
