/**
 * Settling an x402 payment, through somebody else's machine.
 *
 * A client that reads a 402 does not send money. It signs an EIP-3009
 * authorisation, which is permission for anyone to move its USDC once, and
 * hands that over. Somebody then has to broadcast it and pay the gas, and until
 * they do, nothing has happened at all.
 *
 * That somebody is a facilitator, and the arrangement is better than it sounds.
 * The funds go straight from payer to payTo; the facilitator never holds them
 * and cannot redirect them, because the destination is inside the signature it
 * is relaying. So this registry accepts payments while holding no key, which was
 * the constraint, rather than in spite of it.
 *
 * Two checks here matter more than the rest, both in `chosen`:
 *
 *   1. The requirements sent for settlement are ours, read from our own list.
 *      A payload arrives carrying what the client believes it agreed to, and
 *      trusting that field would let a caller settle one cent against a request
 *      that asked for twenty-five dollars.
 *   2. payTo is compared against our configured address before anything is
 *      broadcast. Relaying a stranger's payment to a stranger's wallet would
 *      make this an open money mule with our name on it.
 */

import type { Env } from './index.js';

/** Base mainnet settles through CDP. The x402.org one is testnet only. */
const DEFAULT_FACILITATOR = 'https://api.cdp.coinbase.com/platform/v2/x402';

/** CDP rejects anything older. Kept well inside it. */
const TOKEN_TTL_SECONDS = 110;

export interface FacilitatorConfig {
  base: string;
  /** A plain bearer token, which is what most facilitators want. */
  bearer?: string;
  /** CDP's key name and Ed25519 secret, for its per-request JWT scheme instead. */
  keyName?: string;
  secret?: string;
}

/**
 * Reads the facilitator's configuration, or null when there is none.
 *
 * Deliberately not welded to one provider. Facilitators are interchangeable by
 * design: they broadcast a signed transfer whose destination they cannot alter,
 * so switching is a URL change and not a migration. Coinbase's is the default
 * only because it is the one that has always been there, and picking a different
 * one should not mean editing this file.
 *
 * Two auth styles, because the ecosystem has two. Most want a static bearer
 * token; CDP signs a short-lived JWT per request. A facilitator wanting neither
 * works too: set the URL and leave the rest empty.
 *
 * Null is not a failure. It means inline settlement is off, tips still arrive by
 * direct transfer and `/api/tip/claim`, and the 402 says as much rather than
 * letting a client sign into a wall.
 */
export function facilitatorConfig(env: Env): FacilitatorConfig | null {
  const base = (env.X402_FACILITATOR ?? '').trim().replace(/\/+$/, '');
  const bearer = (env.X402_FACILITATOR_KEY ?? '').trim();
  const keyName = (env.CDP_API_KEY_ID ?? '').trim();
  const secret = (env.CDP_API_KEY_SECRET ?? '').trim();

  const cdp = Boolean(keyName && secret);
  if (!base && !cdp) return null;

  return {
    base: base || DEFAULT_FACILITATOR,
    ...(bearer ? { bearer } : {}),
    ...(cdp ? { keyName, secret } : {}),
  };
}

function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeBase64(value: string): Uint8Array {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalised);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

/**
 * Imports a CDP Ed25519 secret for signing.
 *
 * The secret is 64 bytes: a 32-byte seed followed by its public key. WebCrypto
 * will not take that pair raw, so it goes in as a JWK, which is the one format
 * that carries both halves and needs no DER assembly.
 */
async function signingKey(secret: string): Promise<CryptoKey> {
  const bytes = decodeBase64(secret);
  if (bytes.length !== 64) {
    throw new Error(`CDP_API_KEY_SECRET decodes to ${bytes.length} bytes, expected 64.`);
  }

  return crypto.subtle.importKey(
    'jwk',
    {
      kty: 'OKP',
      crv: 'Ed25519',
      d: base64url(bytes.subarray(0, 32)),
      x: base64url(bytes.subarray(32)),
    },
    { name: 'Ed25519' },
    false,
    ['sign'],
  );
}

/**
 * Mints a bearer token for one request.
 *
 * Scoped to a single method and path through the `uri` claim, so a token that
 * leaked could not be replayed against a different endpoint, and expiring in
 * under two minutes because CDP will not accept more.
 */
export async function cdpToken(
  config: { keyName?: string; secret?: string },
  method: string,
  host: string,
  path: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const nonce = [...crypto.getRandomValues(new Uint8Array(8))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  if (!config.keyName || !config.secret) throw new Error('No CDP credentials to sign with.');
  const header = { alg: 'EdDSA', typ: 'JWT', kid: config.keyName, nonce };
  const claims = {
    sub: config.keyName,
    iss: 'cdp',
    aud: ['cdp_service'],
    nbf: now,
    exp: now + TOKEN_TTL_SECONDS,
    uri: `${method} ${host}${path}`,
  };

  const encoder = new TextEncoder();
  const signingInput = `${base64url(encoder.encode(JSON.stringify(header)))}.${base64url(
    encoder.encode(JSON.stringify(claims)),
  )}`;

  const signature = await crypto.subtle.sign(
    { name: 'Ed25519' },
    await signingKey(config.secret),
    encoder.encode(signingInput),
  );

  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

export interface PaymentPayload {
  x402Version?: number;
  accepted?: Record<string, unknown>;
  payload?: unknown;
  extensions?: unknown;
  resource?: unknown;
}

/** Reads the PAYMENT-SIGNATURE header, or null if it is not a payload at all. */
export function readPayment(header: string | null): PaymentPayload | null {
  if (!header) return null;
  try {
    const decoded = new TextDecoder().decode(decodeBase64(header.trim()));
    const parsed = JSON.parse(decoded) as PaymentPayload;
    return parsed && typeof parsed === 'object' && parsed.payload ? parsed : null;
  } catch {
    return null;
  }
}

export interface VerifyResult {
  isValid?: boolean;
  invalidReason?: string;
  payer?: string;
}

export interface SettleResult {
  success?: boolean;
  errorReason?: string;
  payer?: string;
  transaction?: string;
  network?: string;
  amount?: string;
}

/** Whichever of the two auth styles this facilitator uses, or neither. */
async function authorization(
  config: FacilitatorConfig,
  method: string,
  host: string,
  path: string,
): Promise<Record<string, string>> {
  if (config.bearer) return { authorization: `Bearer ${config.bearer}` };
  if (config.keyName && config.secret) {
    return { authorization: `Bearer ${await cdpToken(config, method, host, path)}` };
  }
  return {};
}

async function call<T>(
  config: FacilitatorConfig,
  route: '/verify' | '/settle',
  body: unknown,
): Promise<T> {
  const url = new URL(`${config.base}${route}`);

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(await authorization(config, 'POST', url.host, url.pathname)),
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Facilitator ${route} returned ${response.status}: ${text.slice(0, 200)}`);
  }
  return JSON.parse(text) as T;
}

/**
 * Picks which of our own payment options this payload is paying.
 *
 * Matched on network, asset and amount, and never taken from the payload's own
 * `accepted` field. What the client believes it agreed to is a claim; what we
 * published is a fact, and the facilitator settles against whichever of the two
 * it is handed.
 *
 * The payTo comparison is the one that stops this being an open relay. Without
 * it, any signed authorisation aimed anywhere could be pushed through here.
 */
export function chosen(
  accepts: Array<Record<string, unknown>>,
  payload: PaymentPayload,
  payTo: string,
): Record<string, unknown> | null {
  const claimed = payload.accepted ?? {};
  const wanted = payTo.toLowerCase();

  const match = accepts.find(
    (option) =>
      String(option.network) === String(claimed.network) &&
      String(option.asset).toLowerCase() === String(claimed.asset ?? '').toLowerCase() &&
      String(option.amount) === String(claimed.amount),
  );
  if (!match) return null;
  if (String(match.payTo).toLowerCase() !== wanted) return null;

  return match;
}

export interface Settled {
  transaction: string;
  network: string;
  payer: string;
  amount: string;
}

/**
 * Verifies, then settles, and says what actually moved.
 *
 * Verification first because it costs nothing and catches the ordinary cases,
 * a bad signature or an empty wallet, before anything is broadcast. Settlement
 * is the irreversible half, so it only runs on a payload somebody else already
 * agreed is good.
 */
export async function settle(
  config: FacilitatorConfig,
  payload: PaymentPayload,
  requirements: Record<string, unknown>,
): Promise<{ ok: true; settled: Settled } | { ok: false; reason: string }> {
  const body = {
    x402Version: 2,
    paymentPayload: payload,
    paymentRequirements: requirements,
  };

  const verified = await call<VerifyResult>(config, '/verify', body);
  if (!verified.isValid) {
    return { ok: false, reason: verified.invalidReason ?? 'The facilitator rejected the payment.' };
  }

  const result = await call<SettleResult>(config, '/settle', body);
  if (!result.success || !result.transaction) {
    return { ok: false, reason: result.errorReason ?? 'Settlement did not go through.' };
  }

  return {
    ok: true,
    settled: {
      transaction: result.transaction.toLowerCase(),
      network: result.network ?? String(requirements.network),
      payer: (result.payer ?? verified.payer ?? '').toLowerCase(),
      // The facilitator may report the amount; if not, it settled what we asked
      // for, because that is the object it was handed.
      amount: result.amount ?? String(requirements.amount),
    },
  };
}

/** The SettlementResponse a client reads back, base64 for the header. */
export function settlementHeader(settled: Settled): string {
  const payload = {
    success: true,
    transaction: settled.transaction,
    network: settled.network,
    payer: settled.payer,
    amount: settled.amount,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
