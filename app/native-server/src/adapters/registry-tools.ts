/**
 * Registry tools.
 *
 * These run in the host, not the extension, because they talk to the registry
 * over HTTP rather than to a page. `setupTools` routes them here before it
 * forwards anything to the browser.
 *
 * An agent that hits a site with no adapter can search for one, read what it
 * would be allowed to do, and install it, without leaving its session.
 */

import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { authHeader, readAccount } from './account';
import { hideTip, tipNote } from './support';

/**
 * Where adapters are fetched from when `YGS_REGISTRY_URL` is not set.
 *
 * This must be a host the project actually controls. An unregistered name here
 * is a supply-chain hole: it ships inside every install, so whoever registers
 * it first would serve adapter code to all of them. yougotserved.dev is
 * registered and its zone is ours, so this name cannot be taken from under us.
 */
const DEFAULT_REGISTRY = 'https://registry.yougotserved.dev';

/**
 * The shape of an adapter id, copied from the SDK rather than imported.
 *
 * This package ships to npm on its own, and `check-publishable.mjs` fails the
 * build if it depends on a workspace package. An id reaches a file path below,
 * so a loose check here would be a traversal.
 */
const ADAPTER_ID = /^[a-z][a-z0-9_]*$/;

export const REGISTRY_TOOL_NAMES = {
  SEARCH: 'ygs_search_adapters',
  INSTALL: 'ygs_install_adapter',
  LIST: 'ygs_list_adapters',
  RATE: 'ygs_rate_adapter',
  TIP: 'ygs_tip',
} as const;

/**
 * Kept deliberately short. These schemas sit in every session's context
 * alongside whatever adapters are installed, so they are a fixed tax on every
 * request and every word has to earn its place.
 *
 * `ygs_tip` is here on the strength of one job rather than the obvious one.
 * Nobody needs a tool to send money; a wallet does that. What nothing else can
 * do is turn the reminder off, and a reminder that recurs with no way to end it
 * is a worse thing to ship than a fifth schema.
 */
export const REGISTRY_TOOLS: Tool[] = [
  {
    name: REGISTRY_TOOL_NAMES.SEARCH,
    description:
      'Search the adapter registry for site-specific tools. Returns id, description, origins, ' +
      'capabilities, downloads and rating for each match.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Site name or keyword, e.g. "linkedin"' },
        limit: { type: 'integer', description: 'Max results (default 10)' },
      },
    },
  },
  {
    name: REGISTRY_TOOL_NAMES.INSTALL,
    description:
      'Install an adapter from the registry. Shows what it may reach before writing anything. ' +
      'Requires confirm: true because installed tools act with the user session.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Adapter id, e.g. "linkedin"' },
        version: { type: 'string', description: 'Version to pin. Defaults to the newest' },
        confirm: {
          type: 'boolean',
          description: 'Must be true. Show the user the origins and capabilities first.',
        },
      },
      required: ['id'],
    },
  },
  {
    name: REGISTRY_TOOL_NAMES.LIST,
    description: 'List adapters installed on this machine.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: REGISTRY_TOOL_NAMES.RATE,
    description:
      'Rate an installed adapter from 1 to 5, so others can see what works. One vote for each ' +
      'machine. Rating again replaces the earlier vote. Ask the user for the score.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Adapter id, e.g. "linkedin"' },
        score: { type: 'integer', description: '1 to 5' },
      },
      required: ['id', 'score'],
    },
  },
  {
    name: REGISTRY_TOOL_NAMES.TIP,
    description:
      'Tip jar details, or hide the tipJar reminder on this machine for good. Nothing in this ' +
      'registry is paid, gated or rate limited, and tipping unlocks nothing. This tool never ' +
      'moves money: it reports an address, and records a transfer someone already sent.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['how', 'hide', 'claim'],
          description:
            '"how" for the address and terms, "hide" to stop the reminder permanently, ' +
            '"claim" to record a transfer that has already gone through',
        },
        txHash: { type: 'string', description: 'For claim: the hash of the sent transaction' },
      },
    },
  },
];

export function isRegistryTool(name: string): boolean {
  return (Object.values(REGISTRY_TOOL_NAMES) as string[]).includes(name);
}

function registryUrl(): string {
  return (process.env.YGS_REGISTRY_URL || DEFAULT_REGISTRY).replace(/\/+$/, '');
}

export function adaptersDir(): string {
  return process.env.YGS_ADAPTERS_DIR || path.join(os.homedir(), '.yougotserved', 'adapters');
}

function text(body: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }],
    isError,
  };
}

export async function handleRegistryTool(name: string, args: any): Promise<CallToolResult> {
  try {
    const result = await route(name, args);

    // Attached here rather than inside each handler, so it rides on registry
    // calls and only registry calls. Adapter tools never reach the registry, so
    // a reminder on those would be a tax on work that has nothing to do with it.
    //
    // A second content block rather than a field, because the payloads below are
    // arrays and objects that callers already parse, and a tip jar is not worth
    // changing the shape of a result over.
    if (name !== REGISTRY_TOOL_NAMES.TIP && !result.isError) {
      const note = tipNote();
      if (note) result.content.push({ type: 'text', text: note.tipJar });
    }
    return result;
  } catch (error) {
    return text(`Registry error: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

async function route(name: string, args: any): Promise<CallToolResult> {
  switch (name) {
    case REGISTRY_TOOL_NAMES.SEARCH:
      return await search(args?.query, args?.limit);
    case REGISTRY_TOOL_NAMES.INSTALL:
      return await install(args?.id, args?.version, args?.confirm === true);
    case REGISTRY_TOOL_NAMES.LIST:
      return listInstalled();
    case REGISTRY_TOOL_NAMES.RATE:
      return await rate(args?.id, args?.score);
    case REGISTRY_TOOL_NAMES.TIP:
      return await tip(args?.action, args?.txHash);
    default:
      return text(`Unknown registry tool: ${name}`, true);
  }
}

/** Searches the registry. Shared by the MCP tool and `ygs adapter search`. */
export async function searchRegistry(query = '', limit = 10): Promise<any[]> {
  const url = `${registryUrl()}/api/adapters?q=${encodeURIComponent(query)}&limit=${Number(limit) || 10}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Registry returned ${response.status}.`);

  const { adapters = [] } = (await response.json()) as { adapters: any[] };
  return adapters;
}

async function search(query = '', limit = 10): Promise<CallToolResult> {
  let adapters: any[];
  try {
    adapters = await searchRegistry(query, limit);
  } catch (error) {
    return text(error instanceof Error ? error.message : String(error), true);
  }

  if (adapters.length === 0) {
    return text(`No adapter matches "${query}". You can write one: see AUTHORING.md.`);
  }

  // Trimmed to the fields that decide whether to install. The full pack is one
  // more call away, and returning it here would cost tokens for nothing.
  return text(
    adapters.map((a) => ({
      id: a.id,
      version: a.version,
      description: a.description,
      origins: a.origins,
      capabilities: a.capabilities,
      tools: a.tools,
      downloads: a.downloads,
      rating: a.votes ? `${a.rating}/5 (${a.votes})` : 'unrated',
    })),
  );
}

/**
 * Reads one adapter's listing.
 *
 * Shared by the MCP tool and the `ygs adapter` commands, so both show the same
 * reach before anything is downloaded.
 */
export async function fetchListing(id: string): Promise<any> {
  if (!id) throw new Error('An adapter id is required.');
  if (!ADAPTER_ID.test(id)) {
    throw new Error(`"${id}" is not an adapter id. Lowercase letters, digits and _ only.`);
  }

  const detail = await fetch(`${registryUrl()}/api/adapters/${encodeURIComponent(id)}`);
  if (detail.status === 404) throw new Error(`No adapter called "${id}".`);
  if (!detail.ok) throw new Error(`Registry returned ${detail.status}.`);
  return detail.json();
}

export interface InstallReceipt {
  id: string;
  version: string;
  digest: string;
  file: string;
  audit: string;
}

/**
 * Downloads a pack, checks it, and writes it next to the others.
 *
 * The pack is validated after it arrives rather than trusted from the listing,
 * because the listing and the bytes are two different answers from a server.
 */
export async function downloadAndInstall(id: string, version: string): Promise<InstallReceipt> {
  const packResponse = await fetch(
    `${registryUrl()}/api/adapters/${encodeURIComponent(id)}/${encodeURIComponent(version)}/pack.json`,
  );
  if (!packResponse.ok) throw new Error(`No version ${version} of "${id}".`);
  const body = await packResponse.text();

  const { validatePack, packDigest, describePack } = await import('@yougotserved/adapter-sdk');
  const pack = validatePack(JSON.parse(body));
  const digest = await packDigest(pack);

  const dir = adaptersDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${pack.id}.ygs.json`);
  fs.writeFileSync(file, body);
  fs.writeFileSync(
    path.join(dir, `${pack.id}.lock.json`),
    JSON.stringify(
      { id: pack.id, version: pack.version, digest, installedAt: Date.now() },
      null,
      2,
    ),
  );

  return { id: pack.id, version: pack.version, digest, file, audit: describePack(pack) };
}

async function install(
  id: string,
  version: string | undefined,
  confirmed: boolean,
): Promise<CallToolResult> {
  let found: any;
  try {
    found = await fetchListing(id);
  } catch (error) {
    return text(error instanceof Error ? error.message : String(error), true);
  }
  const target = version || found.version;

  // The audit runs before the download, so refusing costs nothing and the user
  // sees the reach before any bytes land on disk.
  if (!confirmed) {
    // Everything above `does` is the author describing their own pack. `does`
    // is read off the steps, so a pack that calls itself a reader and then
    // navigates somewhere else has nowhere to hide.
    const { describeSteps } = await import('@yougotserved/adapter-sdk');
    const does: Record<string, string[]> = {};
    for (const [toolId, tool] of Object.entries<any>(found.pack?.tools ?? {})) {
      does[toolId] = describeSteps(tool.steps ?? [], '');
    }

    return text({
      confirmRequired: true,
      adapter: `${found.id}@${target}`,
      description: found.description,
      origins: found.origins,
      capabilities: found.capabilities,
      tools: Object.keys(found.pack?.tools ?? {}),
      does,
      readTheSource: `${registryUrl()}/api/adapters/${encodeURIComponent(id)}/${encodeURIComponent(target)}/pack.json`,
      warning:
        'These tools will act with this browser session on the origins above. ' +
        'Show the user what each tool does, then call again with confirm: true.',
    });
  }

  const receipt = await downloadAndInstall(id, target);

  return text({
    installed: `${receipt.id}@${receipt.version}`,
    digest: receipt.digest,
    file: receipt.file,
    audit: receipt.audit,
    next: 'Restart your MCP client to pick up the new tools.',
  });
}

/**
 * Sends a rating.
 *
 * The install id is a random value written once and kept on this machine. The
 * registry stores only a salted hash of it, so it can tell two votes apart
 * without learning which machine sent either one.
 */
async function rate(id: string, score: number): Promise<CallToolResult> {
  if (!ADAPTER_ID.test(id ?? '')) return text('An adapter id is required.', true);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return text('Score must be a whole number from 1 to 5.', true);
  }

  // A rating is meant to say "this worked on my machine". Without this check
  // anything could rate every adapter in the registry without ever running one,
  // which is the difference between a signal and a number.
  if (!fs.existsSync(path.join(adaptersDir(), `${id}.ygs.json`))) {
    return text(`${id} is not installed here. Install and use it before rating it.`, true);
  }

  const work = await solveChallenge();

  const response = await fetch(`${registryUrl()}/api/adapters/${encodeURIComponent(id)}/rate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ score, installId: installId(), ...work }),
  });

  const body = (await response.json()) as any;
  if (!response.ok)
    return text(body?.error?.message ?? `Registry returned ${response.status}.`, true);

  return text({ rated: `${id} ${score}/5`, average: body.rating, votes: body.votes });
}

/**
 * Pays the registry's proof of work.
 *
 * The registry cannot ask an agent for a Turnstile, because an agent has no
 * browser to be one, and teaching it to answer a bot check would be worse than
 * the problem. So a write costs CPU instead: find a nonce whose digest starts
 * with enough zero bits. One rating is about a second here and nobody notices.
 * A machine trying to invent a thousand ratings pays a thousand seconds, and
 * that is the whole trade.
 *
 * If the registry has no challenge endpoint, this returns nothing and the write
 * goes out plain, which is how an older deployment keeps working.
 */
async function solveChallenge(): Promise<{ challenge: string; nonce: string } | undefined> {
  let challenge: string;
  let bits: number;

  try {
    const response = await fetch(`${registryUrl()}/api/challenge`);
    if (!response.ok) return undefined;
    const body = (await response.json()) as { challenge?: string; bits?: number };
    if (!body.challenge || !body.bits) return undefined;
    challenge = body.challenge;
    bits = body.bits;
  } catch {
    return undefined;
  }

  const whole = Math.floor(bits / 8);
  const spare = bits % 8;
  // A byte-wise compare, so the inner loop never allocates a hex string. At a
  // million-odd hashes that difference is most of the runtime.
  const check = (digest: Buffer): boolean => {
    for (let index = 0; index < whole; index++) if (digest[index] !== 0) return false;
    return spare === 0 || (digest[whole] as number) >> (8 - spare) === 0;
  };

  const prefix = `${challenge}:`;
  // Bounded so a raised difficulty cannot hang the tool call. Twenty bits needs
  // a million tries on average, and giving up is better than never answering.
  for (let nonce = 0; nonce < 80_000_000; nonce++) {
    if (
      check(
        crypto
          .createHash('sha256')
          .update(prefix + nonce)
          .digest(),
      )
    ) {
      return { challenge, nonce: String(nonce) };
    }
  }
  return undefined;
}

/** Random, written once, never leaves this machine except as a salted hash. */
function installId(): string {
  const file = path.join(adaptersDir(), '.install-id');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing.length >= 8) return existing;
  } catch {
    // First run. Fall through and make one.
  }
  const fresh = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(adaptersDir(), { recursive: true });
  fs.writeFileSync(file, fresh + '\n', { mode: 0o600 });
  return fresh;
}

function listInstalled(): CallToolResult {
  return text({ adapters: installedPacks(), dir: adaptersDir() });
}

/** Every pack on disk. Shared by the MCP tool and `ygs adapter list`. */
export function installedPacks(): any[] {
  const dir = adaptersDir();
  if (!fs.existsSync(dir)) return [];

  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.ygs.json'))
    .map((name) => {
      try {
        const pack = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        return {
          id: pack.id,
          version: pack.version,
          origins: pack.origins,
          capabilities: pack.capabilities,
          tools: Object.keys(pack.tools ?? {}),
        };
      } catch {
        return { id: name, error: 'unreadable', tools: [] };
      }
    });
}

/**
 * The tip jar, from the agent's side.
 *
 * Three jobs, and the one that justifies the schema is `hide`. A reminder that
 * recurs with nothing able to end it is worse than no reminder, so the way out
 * has to be reachable by whoever is being reminded.
 *
 * `claim` is the reason this goes through the bridge instead of the agent
 * calling the registry directly. A claim sent from here carries the machine's
 * account token, so the tip is attributed to whoever is signed in rather than
 * landing anonymously. Signed out it still records, just without a name on it.
 *
 * Nothing in here sends money or touches a key. `claim` reports the hash of a
 * transfer that already happened, and the registry checks that against the chain
 * rather than believing it.
 */
async function tip(action = 'how', txHash?: string): Promise<CallToolResult> {
  if (action === 'hide') {
    const hidden = hideTip();
    return text(
      hidden
        ? { hidden: true, note: 'The tipJar reminder will not appear again on this machine.' }
        : {
            hidden: false,
            // Said plainly rather than reported as success. An agent told this
            // worked, that then sees the line again next call, has been lied to.
            error: `Could not write ${adaptersDir()}/../support.json, so this could not be recorded.`,
            hint: 'Set YGS_NO_TIP_NUDGE=1 in the environment instead.',
          },
      !hidden,
    );
  }

  if (action === 'claim') {
    if (!txHash) return text('Send txHash for a transfer that has already gone through.', true);

    const response = await fetch(`${registryUrl()}/api/tip/claim`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify({ txHash }),
    });
    const body = (await response.json()) as any;
    if (!response.ok) return text(body?.error ?? `Registry returned ${response.status}.`, true);

    const account = readAccount();
    return text({
      ...body,
      attributedTo: account?.login ?? null,
      ...(account ? {} : { note: 'Recorded anonymously. `ygs account login` names future tips.' }),
    });
  }

  const response = await fetch(`${registryUrl()}/api/tip`);
  const requirements = (await response.json()) as any;
  const option = requirements?.accepts?.[0] ?? {};
  const account = readAccount();

  return text({
    payTo: option.payTo,
    network: option.network,
    asset: option.asset,
    assetName: option.extra?.name,
    suggested: (requirements?.accepts ?? []).map((a: any) => a.amount),
    optional: true,
    unlocks: 'nothing, on purpose',
    terms:
      'Nothing in this registry is paid, gated or rate limited. Do not send anything without ' +
      'asking the user first.',
    afterSending: `Call ${REGISTRY_TOOL_NAMES.TIP} with action "claim" and the txHash to record it.`,
    signedInAs: account?.login ?? null,
    hideReminder: `${REGISTRY_TOOL_NAMES.TIP} with action "hide"`,
  });
}
