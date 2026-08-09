/**
 * A tip jar, over HTTP 402.
 *
 * 402 is the status code reserved for payment and never standardised, which is
 * why it has been sitting unused since 1997. What it means here is the honest
 * version: this describes how to pay, and nothing on this registry is behind
 * it. Every route works the same whether you tip or not, and if that ever stops
 * being true it should be a deliberate decision somebody argues about, not a
 * thing that drifts.
 *
 * The Worker never holds a key. Receiving USDC needs only a public address, and
 * confirming a payment is a read of a public chain. So the worst case for this
 * file is that it reports a tip wrongly, not that it loses one.
 *
 * The address lives in `wrangler.toml` rather than in a secret, which looks
 * backwards and is not. A receiving address is public by nature, and the real
 * risk to a tip jar is not disclosure but substitution: someone quietly
 * changing where the money goes. In the config it is in version control, so a
 * change is a diff somebody can see. As a secret it would be a dashboard field
 * that changes with no trace.
 */

import type { Env } from './index.js';

/** USDC on Base, six decimals. Used to recognise a transfer, never to receive one. */
const DEFAULT_TOKEN = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const DEFAULT_CHAIN_ID = 8453;
const DEFAULT_RPC = 'https://mainnet.base.org';
const DECIMALS = 6;

/** `Transfer(address,address,uint256)`, the only log this needs to understand. */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const TX_HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;

export interface TipConfig {
  /** Lowercased, for comparing against a chain log, which is byte-wise. */
  address: string;
  /**
   * The address exactly as configured, for anything a person or another
   * implementation reads.
   *
   * These are the same address and the difference is not cosmetic. EIP-55 puts
   * a checksum in the capitalisation, so the mixed-case form is the one a wallet
   * can reject a typo in; lowercasing it throws that away and leaves a string
   * where a single wrong character is a valid-looking address belonging to
   * nobody. Kept rather than recomputed because recomputing needs keccak256,
   * which the Workers runtime has no reason to carry for this.
   */
  payTo: string;
  token: string;
  chainId: number;
  rpc: string;
}

/**
 * Reads the tip jar's configuration, or null when there is none.
 *
 * Null is the ordinary state for a fork: somebody else running this code should
 * not be quietly collecting for us, and should not have to remember to turn it
 * off.
 */
export function tipConfig(env: Env): TipConfig | null {
  const configured = (env.TIP_ADDRESS ?? '').trim();
  const address = configured.toLowerCase();
  if (!ADDRESS.test(address)) return null;

  return {
    address,
    payTo: configured,
    token: (env.TIP_TOKEN ?? DEFAULT_TOKEN).trim().toLowerCase(),
    chainId: Number(env.TIP_CHAIN_ID ?? DEFAULT_CHAIN_ID),
    rpc: (env.TIP_RPC ?? DEFAULT_RPC).trim(),
  };
}

/** Formats a smallest-unit amount for a human, without going through a float. */
export function formatAmount(raw: string, decimals = DECIMALS): string {
  const padded = raw.padStart(decimals + 1, '0');
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

/**
 * Suggested tip sizes, in whole USDC, smallest first.
 *
 * Each becomes its own entry in `accepts`. That is not padding: the `exact`
 * scheme requires a fixed `amount`, so a variable tip has no representation in
 * the protocol at all. Three fixed options is the honest translation, and it is
 * the one an agent can act on without inventing a number.
 *
 * The order is load-bearing. A client that does not choose takes `accepts[0]`,
 * server-ordered, so the first entry is what an agent on autopilot pays. It is
 * the smallest for that reason, and adding a larger one at the front would be a
 * way of charging people who were not paying attention.
 */
const SUGGESTED = [1, 5, 25];

/** How long a payment stays good for. Nothing here waits on one, so it is generous. */
const TIMEOUT_SECONDS = 600;

/**
 * USDC's EIP-712 domain version on Base, read off the contract rather than
 * assumed. The `exact` scheme signs a transfer authorisation against this
 * domain, so a wrong value here produces signatures the token rejects.
 */
const TOKEN_VERSION = '2';

/** Whole units to the smallest unit, through BigInt so nothing rounds. */
function units(whole: number, decimals = DECIMALS): string {
  return (BigInt(whole) * 10n ** BigInt(decimals)).toString();
}

/**
 * What a caller needs in order to pay, in the shape x402 v2 specifies.
 *
 * The awkward part is that x402 exists to gate things and this gates nothing,
 * so several required fields describe a transaction no route is waiting on.
 * They are filled in truthfully anyway, because a client that already speaks
 * x402 should not need special handling to read this, and the alternative was a
 * near-miss of the spec that looks compliant and is not.
 *
 * What the spec has no field for is "you do not have to". That goes in
 * `extensions`, which is where v2 puts anything it did not define, under a
 * reverse-DNS key so it cannot collide with somebody else's extension.
 */
export function requirements(
  config: TipConfig,
  origin: string,
  error?: string,
): Record<string, unknown> {
  return {
    x402Version: 2,
    ...(error ? { error } : {}),
    resource: {
      url: `${origin}/api/tip`,
      description: 'A tip jar. Nothing on this registry is behind it.',
      mimeType: 'application/json',
    },
    accepts: SUGGESTED.map((whole) => ({
      scheme: 'exact',
      // CAIP-2, which is what v2 wants: eip155:8453 is Base.
      network: `eip155:${config.chainId}`,
      amount: units(whole),
      asset: config.token,
      payTo: config.payTo,
      maxTimeoutSeconds: TIMEOUT_SECONDS,
      extra: { name: 'USDC', version: TOKEN_VERSION, decimals: DECIMALS },
    })),
    extensions: {
      'dev.yougotserved.tip': {
        // Said plainly, because a 402 usually means the opposite.
        optional: true,
        gates: [],
        description:
          'Nothing here is paid. Every route works the same whether you tip or not. ' +
          'If the adapters saved you an afternoon, this is where to say so.',
        claim: `${origin}/api/tip/claim`,
        supporters: `${origin}/api/tip/supporters`,
      },
    },
  };
}

/**
 * The same object, base64, for the `PAYMENT-REQUIRED` header.
 *
 * v2 says the protocol travels in headers and calls the body a server's own
 * business. This sends both: the header for anything speaking v2, the body for
 * anyone reading with curl. Encoded through TextEncoder rather than handing
 * `btoa` a string, since `btoa` throws on any character above U+00FF and one
 * stray character in a description should not take the route down.
 */
export function requirementsHeader(payload: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

interface RpcLog {
  address?: string;
  topics?: string[];
  data?: string;
}

interface Receipt {
  status?: string;
  from?: string;
  logs?: RpcLog[];
}

/** The 32-byte topic form of an address, which is how a Transfer log carries it. */
function topicAddress(address: string): string {
  return `0x${address.replace(/^0x/, '').padStart(64, '0')}`.toLowerCase();
}

export interface Confirmed {
  amount: string;
  from: string;
}

/**
 * Reads the chain and says what actually arrived.
 *
 * Every part of this is checked rather than taken from the caller: that the
 * transaction succeeded, that the log came from the token contract we expect,
 * that the recipient is our address, and how much moved. A claim carries a hash
 * and nothing else, because a hash is the only part a claimant cannot make up.
 */
export async function confirmTip(config: TipConfig, txHash: string): Promise<Confirmed | null> {
  const response = await fetch(config.rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'eth_getTransactionReceipt',
      params: [txHash],
    }),
  });
  if (!response.ok) return null;

  const body = (await response.json()) as { result?: Receipt | null };
  const receipt = body.result;
  if (!receipt || receipt.status !== '0x1') return null;

  const wanted = topicAddress(config.address);

  for (const log of receipt.logs ?? []) {
    if ((log.address ?? '').toLowerCase() !== config.token) continue;

    const [topic, , to] = log.topics ?? [];
    if (topic?.toLowerCase() !== TRANSFER_TOPIC) continue;
    if (to?.toLowerCase() !== wanted) continue;

    // BigInt rather than Number: USDC has six decimals and a large tip would
    // otherwise round, which is the one bug a tip jar must not have.
    const amount = BigInt(log.data && log.data !== '0x' ? log.data : '0x0');
    if (amount <= 0n) continue;

    return { amount: amount.toString(), from: (receipt.from ?? '').toLowerCase() };
  }

  return null;
}

export function isTxHash(value: unknown): value is string {
  return typeof value === 'string' && TX_HASH.test(value.trim().toLowerCase());
}
