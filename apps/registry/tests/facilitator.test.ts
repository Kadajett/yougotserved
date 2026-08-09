/**
 * The settlement path, and mostly the two ways it could be abused.
 *
 * Everything here broadcasts real money on success, so the interesting tests are
 * the refusals. `chosen` is the whole gate: it decides which of our published
 * options a payload is paying, and whether the money is even coming to us.
 */

import { describe, expect, it } from 'vitest';
import { chosen, cdpToken, readPayment, settlementHeader } from '../src/facilitator.js';
import { requirements, tipConfig } from '../src/tips.js';
import type { Env } from '../src/index.js';

const OURS = '0x465cb27a4896053803b5Be450EE403af294ac3fb';
const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

const config = tipConfig({
  TIP_ADDRESS: OURS,
  TIP_TOKEN: USDC,
  TIP_CHAIN_ID: '8453',
} as unknown as Env)!;

const accepts = requirements(config, 'https://registry.yougotserved.dev').accepts as Array<
  Record<string, unknown>
>;

const payload = (accepted: Record<string, unknown>) => ({
  x402Version: 2,
  accepted,
  payload: { signature: '0xdead', authorization: {} },
});

describe('chosen', () => {
  it('matches a payload that is paying one of the published options', () => {
    const match = chosen(
      accepts,
      payload({ network: 'eip155:8453', asset: USDC, amount: '5000000' }),
      OURS,
    );
    expect(match?.amount).toBe('5000000');
  });

  // The reason requirements are read from our own list rather than from the
  // payload. Trusting the payload's `accepted` would settle a cent against an
  // option that asked for twenty-five dollars.
  it('refuses an amount we never published', () => {
    expect(
      chosen(accepts, payload({ network: 'eip155:8453', asset: USDC, amount: '1' }), OURS),
    ).toBeNull();
  });

  // The one that stops this being an open money relay. Without it, any signed
  // authorisation aimed at any wallet could be pushed through this endpoint.
  it('refuses a payload addressed somewhere that is not us', () => {
    const elsewhere = accepts.map((option) => ({ ...option, payTo: '0x' + '11'.repeat(20) }));
    expect(
      chosen(elsewhere, payload({ network: 'eip155:8453', asset: USDC, amount: '1000000' }), OURS),
    ).toBeNull();
  });

  it('refuses another chain or another token at the same amount', () => {
    expect(
      chosen(accepts, payload({ network: 'eip155:1', asset: USDC, amount: '1000000' }), OURS),
    ).toBeNull();
    expect(
      chosen(
        accepts,
        payload({ network: 'eip155:8453', asset: '0x' + '22'.repeat(20), amount: '1000000' }),
        OURS,
      ),
    ).toBeNull();
  });

  it('compares addresses without caring about EIP-55 capitalisation', () => {
    const match = chosen(
      accepts,
      payload({ network: 'eip155:8453', asset: USDC.toUpperCase(), amount: '1000000' }),
      OURS.toLowerCase(),
    );
    expect(match).not.toBeNull();
  });
});

describe('readPayment', () => {
  it('returns null for anything that is not a payload, rather than throwing', () => {
    expect(readPayment(null)).toBeNull();
    expect(readPayment('not base64 !!')).toBeNull();
    expect(readPayment(btoa('{"nope":true}'))).toBeNull(); // parses, but carries no payload
    expect(readPayment(btoa('[]'))).toBeNull();
  });

  it('reads a real one', () => {
    const encoded = btoa(JSON.stringify(payload({ amount: '1000000' })));
    expect(readPayment(encoded)?.accepted).toEqual({ amount: '1000000' });
  });
});

describe('cdpToken', () => {
  /** A CDP secret is 32 bytes of seed followed by its 32-byte public key. */
  async function fakeCredentials() {
    const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;

    const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
    const fromB64Url = (value: string) =>
      Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

    const secret = new Uint8Array(64);
    secret.set(fromB64Url(jwk.d!), 0);
    secret.set(fromB64Url(jwk.x!), 32);
    return { secret: btoa(String.fromCharCode(...secret)), publicKey: pair.publicKey };
  }

  it('signs a token the key actually verifies, with the claims CDP wants', async () => {
    const { secret, publicKey } = await fakeCredentials();
    const keyName = 'organizations/abc/apiKeys/def';

    const token = await cdpToken(
      { base: 'https://api.cdp.coinbase.com/platform/v2/x402', keyName, secret },
      'POST',
      'api.cdp.coinbase.com',
      '/platform/v2/x402/settle',
    );

    const [header, claims, signature] = token.split('.');
    const decode = (part: string) =>
      JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as Record<string, unknown>;

    expect(decode(header)).toMatchObject({ alg: 'EdDSA', typ: 'JWT', kid: keyName });
    expect(decode(header).nonce).toMatch(/^[0-9a-f]{16}$/);
    expect(decode(claims)).toMatchObject({
      sub: keyName,
      iss: 'cdp',
      aud: ['cdp_service'],
      // Scoped to one method and path, so a leaked token cannot be replayed
      // against a different endpoint.
      uri: 'POST api.cdp.coinbase.com/platform/v2/x402/settle',
    });

    const expiry = decode(claims).exp as number;
    const notBefore = decode(claims).nbf as number;
    expect(expiry - notBefore).toBeLessThanOrEqual(120); // CDP rejects anything longer

    const valid = await crypto.subtle.verify(
      { name: 'Ed25519' },
      publicKey,
      Uint8Array.from(atob(signature.replace(/-/g, '+').replace(/_/g, '/')), (c) =>
        c.charCodeAt(0),
      ),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
  });

  it('refuses a secret that is not 64 bytes rather than signing with nonsense', async () => {
    await expect(
      cdpToken({ base: 'https://x', keyName: 'k', secret: btoa('short') }, 'POST', 'h', '/p'),
    ).rejects.toThrow(/expected 64/);
  });
});

describe('settlementHeader', () => {
  it('round-trips to a SettlementResponse a client can read', () => {
    const encoded = settlementHeader({
      transaction: '0xabc',
      network: 'eip155:8453',
      payer: '0xdef',
      amount: '1000000',
    });
    expect(JSON.parse(atob(encoded))).toEqual({
      success: true,
      transaction: '0xabc',
      network: 'eip155:8453',
      payer: '0xdef',
      amount: '1000000',
    });
  });
});
