/**
 * Tool naming.
 *
 * Tools read like function calls: `linkedin_search_people`,
 * `notion_create_page`, `github_get_unresolved_review_threads`.
 *
 * A dot would read better still, but a tool name has to satisfy
 * `^[a-zA-Z0-9_-]{1,64}$` *after* the host prefixes it — Claude Code turns
 * `search_people` on a server named `ygs` into `mcp__ygs__search_people` — and
 * a dot fails that check. Underscores keep the same shape and work everywhere.
 * This is why upstream's `flow.<slug>` tools are invisible to some clients.
 *
 * Serving one adapter per server (`ygs serve --adapter linkedin`) drops the
 * prefix, so the tools become plain `search_people` under a server called
 * `linkedin`. That is the real namespace; the prefix is the fallback for the
 * multi-adapter server.
 */

/** The MCP spec's own bound on a tool name. */
export const MAX_TOOL_NAME = 64;

/** `mcp__` + server + `__` is what a host prepends before the limit applies. */
export const HOST_PREFIX_OVERHEAD = 'mcp__'.length + '__'.length;

const ID_PATTERN = /^[a-z][a-z0-9_]*$/;
const MAX_ID = 32;

export class AdapterNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterNameError';
  }
}

/**
 * Adapter and tool ids are deliberately stricter than MCP requires: lowercase,
 * underscore-separated, starting with a letter. They get concatenated, appear
 * in filenames, and are typed by hand into agent prompts, so the narrow
 * alphabet is worth more than the flexibility.
 */
export function assertValidId(id: string, kind: 'adapter' | 'tool'): string {
  if (!id) throw new AdapterNameError(`An ${kind} id is required.`);
  if (id.length > MAX_ID) {
    throw new AdapterNameError(
      `${kind} id "${id}" is ${id.length} characters; the limit is ${MAX_ID}.`,
    );
  }
  if (!ID_PATTERN.test(id)) {
    throw new AdapterNameError(
      `${kind} id "${id}" must be lowercase letters, digits and underscores, starting with a letter ` +
        `(for example "search_people").`,
    );
  }
  return id;
}

export function isValidId(id: string): boolean {
  try {
    assertValidId(id, 'tool');
    return true;
  } catch {
    return false;
  }
}

/**
 * How many characters a tool name may use before a host's prefix pushes the
 * result past {@link MAX_TOOL_NAME}.
 */
export function toolNameBudget(serverName: string): number {
  return MAX_TOOL_NAME - HOST_PREFIX_OVERHEAD - serverName.length;
}

export interface ToolNameOptions {
  /** Prepend the adapter id. False when the server serves a single adapter. */
  includeAdapterPrefix?: boolean;
  /** MCP server name, used to reserve room for the host's `mcp__<server>__`. */
  serverName?: string;
}

/**
 * Derives the wire name for a tool. Throws rather than silently truncating,
 * because a truncated name is a tool the agent cannot reliably call and a
 * confusing thing to debug at runtime.
 */
export function toolNameFor(
  adapterId: string,
  toolId: string,
  options: ToolNameOptions = {},
): string {
  assertValidId(adapterId, 'adapter');
  assertValidId(toolId, 'tool');

  const includePrefix = options.includeAdapterPrefix ?? true;
  const name = includePrefix ? `${adapterId}_${toolId}` : toolId;
  const budget = options.serverName ? toolNameBudget(options.serverName) : MAX_TOOL_NAME;

  if (name.length > budget) {
    const ceiling = options.serverName
      ? `${budget} (${MAX_TOOL_NAME} minus the host's "mcp__${options.serverName}__" prefix)`
      : String(budget);
    throw new AdapterNameError(
      `Tool name "${name}" is ${name.length} characters; the limit is ${ceiling}. ` +
        `Shorten the adapter id or the tool id.`,
    );
  }
  return name;
}

/**
 * A tool's description is the one string that sits in every agent's context
 * for the whole session, so it stays short and says what the tool returns
 * rather than how it works.
 */
export function describeTool(input: {
  description: string;
  returns?: string;
  risk: string;
  confirm?: boolean;
}): string {
  const parts = [input.description.trim().replace(/\s+/g, ' ')];
  if (input.returns) parts.push(`Returns ${input.returns.trim().replace(/\.$/, '')}.`);
  if (input.risk === 'write') parts.push('Modifies the live site.');
  if (input.risk === 'irreversible') parts.push('Irreversible.');
  if (input.confirm) parts.push('Requires confirm: true.');
  return parts.join(' ');
}
