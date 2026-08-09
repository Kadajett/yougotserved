/**
 * The 402 body, checked against the x402 v2 spec rather than against itself.
 *
 * These assertions are copied from the spec's own required-field table, so what
 * they are really pinning is "a v2 client can read this". The first version of
 * this file emitted a v1-shaped object with invented top-level keys, which
 * looked fine in isolation and would have been unreadable to anything that
 * actually speaks the protocol. That is the failure this catches.
 */

import { describe, expect, it } from 'vitest';
import { formatAmount, requirements, requirementsHeader, tipConfig } from '../src/tips.js';
import type { Env } from '../src/index.js';

const env = {
  TIP_ADDRESS: '0x465cb27a4896053803b5Be450EE403af294ac3fb',
  TIP_TOKEN: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  TIP_CHAIN_ID: '8453',
  TIP_RPC: 'https://mainnet.base.org',
} as unknown as Env;

const config = tipConfig(env)!;
const body = requirements(config, 'https://registry.yougotserved.dev') as Record<string, any>;

describe('tipConfig', () => {
  it('is off unless an address is set, so a fork does not collect for us', () => {
    expect(tipConfig({} as Env)).toBeNull();
    expect(tipConfig({ TIP_ADDRESS: 'not-an-address' } as unknown as Env)).toBeNull();
  });

  // Two forms of one address, and the split is the point. The chain comparison
  // needs lowercase; a person copying it needs the EIP-55 capitalisation, which
  // is a checksum and the only thing that catches a mistyped character.
  it('keeps a lowercase form for the chain and the configured form for readers', () => {
    expect(config.address).toBe('0x465cb27a4896053803b5be450ee403af294ac3fb');
    expect(config.payTo).toBe('0x465cb27a4896053803b5Be450EE403af294ac3fb');
  });
});

describe('x402 v2 payment requirements', () => {
  it('declares v2', () => {
    expect(body.x402Version).toBe(2);
  });

  // Required by the spec and absent from the first draft of this.
  it('carries the required top-level fields', () => {
    expect(body.resource).toBeTypeOf('object');
    expect(body.resource.url).toBe('https://registry.yougotserved.dev/api/tip');
    expect(Array.isArray(body.accepts)).toBe(true);
    expect(body.accepts.length).toBeGreaterThan(0);
  });

  it('gives every accepts entry the fields the spec marks required', () => {
    for (const entry of body.accepts) {
      expect(entry.scheme).toBe('exact');
      expect(entry.network).toBe('eip155:8453'); // CAIP-2, which is what v2 wants
      expect(entry.asset).toBe('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913');
      expect(entry.payTo).toBe('0x465cb27a4896053803b5Be450EE403af294ac3fb');
      expect(entry.maxTimeoutSeconds).toBeTypeOf('number');
      // A string, not a number. A JSON number would lose precision on a large
      // amount, which is the one bug a payment field must not have.
      expect(entry.amount).toBeTypeOf('string');
      expect(entry.amount).toMatch(/^\d+$/);
    }
  });

  // `exact` has no way to say "any amount", so a variable tip becomes several
  // fixed options rather than one entry with a field the spec does not define.
  it('turns each suggested tip into its own exact option', () => {
    expect(body.accepts.map((entry: any) => entry.amount)).toEqual([
      '1000000',
      '5000000',
      '25000000',
    ]);
  });

  it('signs against the token domain version the contract actually reports', () => {
    expect(body.accepts[0].extra).toMatchObject({ name: 'USDC', version: '2', decimals: 6 });
  });

  // The whole point of this endpoint, and the part x402 has no field for.
  it('puts the non-standard part under a reverse-DNS extension key', () => {
    expect(Object.keys(body)).not.toContain('optional');
    expect(body.extensions['dev.yougotserved.tip'].optional).toBe(true);
    expect(body.extensions['dev.yougotserved.tip'].gates).toEqual([]);
  });
});

describe('requirementsHeader', () => {
  it('round-trips through base64 to the same object', () => {
    expect(JSON.parse(atob(requirementsHeader(body)))).toEqual(body);
  });

  it('survives a character btoa alone would throw on', () => {
    expect(() => requirementsHeader({ note: 'a tip, thanks — really' })).not.toThrow();
  });
});

describe('formatAmount', () => {
  it('reads smallest units back without going through a float', () => {
    expect(formatAmount('1000000')).toBe('1');
    expect(formatAmount('25000000')).toBe('25');
    expect(formatAmount('1500000')).toBe('1.5');
    expect(formatAmount('1')).toBe('0.000001');
    // The case a float gets wrong, which is why this is BigInt end to end.
    expect(formatAmount('123456789012345678')).toBe('123456789012.345678');
  });
});
