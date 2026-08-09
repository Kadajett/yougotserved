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
  address: string;
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
  const address = (env.TIP_ADDRESS ?? '').trim().toLowerCase();
  if (!ADDRESS.test(address)) return null;

  return {
    address,
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
 * What a caller needs in order to pay.
 *
 * Shaped after the x402 payment-requirements object so a client that already
 * speaks that can read it, without this pretending to implement the protocol:
 * there is no facilitator here and no settlement, because a tip needs neither.
 */
export function requirements(config: TipConfig, origin: string): Record<string, unknown> {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: 'exact',
        network: `eip155:${config.chainId}`,
        asset: config.token,
        payTo: config.address,
        extra: { name: 'USDC', decimals: DECIMALS },
      },
    ],
    // Said plainly, because a 402 usually means the opposite.
    optional: true,
    gates: [],
    description:
      'Nothing here is paid. Every route works the same whether you tip or not. ' +
      'If the adapters saved you an afternoon, this is where to say so.',
    suggested: ['1', '5', '25'],
    claim: `${origin}/api/tip/claim`,
    supporters: `${origin}/api/tip/supporters`,
  };
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
