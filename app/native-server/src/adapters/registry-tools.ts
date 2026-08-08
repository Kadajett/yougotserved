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

const DEFAULT_REGISTRY = 'https://registry.yougotserved.dev';

export const REGISTRY_TOOL_NAMES = {
  SEARCH: 'ygs_search_adapters',
  INSTALL: 'ygs_install_adapter',
  LIST: 'ygs_list_adapters',
  RATE: 'ygs_rate_adapter',
} as const;

/**
 * Kept deliberately short. These three schemas sit in every session's context
 * alongside whatever adapters are installed, so they are a fixed tax on every
 * request and every word has to earn its place.
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
    switch (name) {
      case REGISTRY_TOOL_NAMES.SEARCH:
        return await search(args?.query, args?.limit);
      case REGISTRY_TOOL_NAMES.INSTALL:
        return await install(args?.id, args?.version, args?.confirm === true);
      case REGISTRY_TOOL_NAMES.LIST:
        return listInstalled();
      case REGISTRY_TOOL_NAMES.RATE:
        return await rate(args?.id, args?.score);
      default:
        return text(`Unknown registry tool: ${name}`, true);
    }
  } catch (error) {
    return text(`Registry error: ${error instanceof Error ? error.message : String(error)}`, true);
  }
}

async function search(query = '', limit = 10): Promise<CallToolResult> {
  const url = `${registryUrl()}/api/adapters?q=${encodeURIComponent(query)}&limit=${Number(limit) || 10}`;
  const response = await fetch(url);
  if (!response.ok) return text(`Registry returned ${response.status}.`, true);

  const { adapters = [] } = (await response.json()) as { adapters: any[] };
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

async function install(
  id: string,
  version: string | undefined,
  confirmed: boolean,
): Promise<CallToolResult> {
  if (!id) return text('An adapter id is required.', true);

  const detail = await fetch(`${registryUrl()}/api/adapters/${encodeURIComponent(id)}`);
  if (detail.status === 404) return text(`No adapter called "${id}".`, true);
  if (!detail.ok) return text(`Registry returned ${detail.status}.`, true);

  const found = (await detail.json()) as any;
  const target = version || found.version;

  // The audit runs before the download, so refusing costs nothing and the user
  // sees the reach before any bytes land on disk.
  if (!confirmed) {
    return text({
      confirmRequired: true,
      adapter: `${found.id}@${target}`,
      description: found.description,
      origins: found.origins,
      capabilities: found.capabilities,
      tools: Object.keys(found.pack?.tools ?? {}),
      warning:
        'These tools will act with this browser session on the origins above. ' +
        'Show the user this list, then call again with confirm: true.',
    });
  }

  const packResponse = await fetch(
    `${registryUrl()}/api/adapters/${encodeURIComponent(id)}/${encodeURIComponent(target)}/pack.json`,
  );
  if (!packResponse.ok) return text(`No version ${target} of "${id}".`, true);
  const body = await packResponse.text();

  // Validate what actually arrived, not what the listing promised.
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

  return text({
    installed: `${pack.id}@${pack.version}`,
    digest,
    file,
    audit: describePack(pack),
    next: `Restart your MCP client, or run: ygs serve --adapter ${pack.id}`,
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
  if (!id) return text('An adapter id is required.', true);
  if (!Number.isInteger(score) || score < 1 || score > 5) {
    return text('Score must be a whole number from 1 to 5.', true);
  }

  const response = await fetch(`${registryUrl()}/api/adapters/${encodeURIComponent(id)}/rate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ score, installId: installId() }),
  });

  const body = (await response.json()) as any;
  if (!response.ok)
    return text(body?.error?.message ?? `Registry returned ${response.status}.`, true);

  return text({ rated: `${id} ${score}/5`, average: body.rating, votes: body.votes });
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
  const dir = adaptersDir();
  if (!fs.existsSync(dir)) return text({ adapters: [], dir });

  const adapters = fs
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
        return { id: name, error: 'unreadable' };
      }
    });

  return text({ adapters, dir });
}
