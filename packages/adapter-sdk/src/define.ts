/**
 * `defineSiteAdapter` — the entry point an adapter author writes against.
 *
 * An adapter is a declaration first and code second. Everything the host needs
 * to decide whether a call is allowed — origins, capabilities, risk, whether a
 * confirmation is required — is data on the definition, checked before the
 * handler runs. The handler cannot widen any of it at runtime, because the
 * session it is handed was already built from the declaration.
 */

import { assertValidId, describeTool, toolNameFor, type ToolNameOptions } from './naming.js';
import { createUrlGuard, type UrlGuard } from './origins.js';
import { validateSteps, type Step } from './steps.js';
import { runSteps } from './interpreter.js';
import {
  paramsToJsonSchema,
  validateParams,
  type InferParams,
  type JsonSchemaNode,
  type ParamShape,
} from './schema.js';
import { err, ok, toAdapterResult, type AdapterResult } from './result.js';
import type { BrowserSession, Capability, ToolContext } from './session.js';
import { ALL_CAPABILITIES } from './session.js';
import type { UploadPolicy } from './files.js';

/**
 * What a call does to the user's account, which is a different question from
 * what it does to the browser.
 *
 * - `read` — observes. Re-running it changes nothing.
 * - `write` — creates or edits something the user could undo by hand.
 * - `irreversible` — sends, deletes, pays, publishes. Requires confirmation.
 */
export type RiskLevel = 'read' | 'write' | 'irreversible';

export class AdapterDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdapterDefinitionError';
  }
}

export type ToolHandler<S extends ParamShape, R> = (
  page: BrowserSession,
  args: InferParams<S>,
  context: ToolContext,
) => Promise<AdapterResult<R> | R> | AdapterResult<R> | R;

export interface ToolDefinition<S extends ParamShape = ParamShape, R = unknown> {
  /**
   * One line, present tense, describing what the agent gets. This string sits
   * in every session's context, so it is the most expensive prose in the
   * project — keep it under about twenty words.
   */
  description: string;
  params?: S;
  /** What comes back, for the description line: "up to 25 people with name, headline, profile URL". */
  returns?: string;
  /** Default `read`. */
  risk?: RiskLevel;
  /** Subset of the adapter's capabilities this tool needs. Defaults to all of them. */
  capabilities?: readonly Capability[];
  /**
   * Require the caller to pass `confirm: true`. Defaults to true for
   * `irreversible` tools, false otherwise.
   */
  confirm?: boolean;
  /** Wall-clock budget. The host applies its own ceiling on top. */
  timeoutMs?: number;
  handler: ToolHandler<S, R>;
}

/**
 * Identity function that pins a tool's parameter shape so `args` is typed
 * inside the handler.
 *
 * Inside a plain `tools: { ... }` literal TypeScript cannot infer one
 * property's type from a sibling's, so `args` there widens to
 * `Record<string, any>` and a typo in `args.querry` compiles. Wrapping the
 * tool gives the compiler a single call to infer from:
 *
 *     search_people: defineTool({
 *       description: 'Search people.',
 *       params: { query: p.string() },
 *       handler: async (page, args) => args.query.toUpperCase(),  // string
 *     }),
 *
 * Both forms work at runtime and validate identically; this one is worth the
 * seven characters.
 */
export function defineTool<S extends ParamShape, R>(
  tool: ToolDefinition<S, R>,
): ToolDefinition<S, R> {
  return tool;
}

/**
 * A tool written as declarative steps — the publishable tier.
 *
 * Identical to {@link ToolDefinition} except that the body is data. The steps
 * are attached to the compiled tool so `buildPack` can serialise them; at
 * runtime they go through the same interpreter either way, so there is one
 * execution path to reason about rather than two.
 */
export interface StepToolDefinition<S extends ParamShape = ParamShape> extends Omit<
  ToolDefinition<S, unknown>,
  'handler'
> {
  steps: Step[];
}

/** Marks a tool as step-defined, and carries its steps to the pack compiler. */
export const TOOL_STEPS = Symbol.for('yougotserved.steps');

export function defineSteps<S extends ParamShape>(
  tool: StepToolDefinition<S>,
): ToolDefinition<S, unknown> {
  validateSteps(tool.steps);

  const { steps, ...rest } = tool;
  const definition: ToolDefinition<S, unknown> = {
    ...rest,
    // Already validated above, so the interpreter skips the re-check on the
    // local path. A pack loaded from a registry is validated again on arrival.
    handler: (page, args) => runSteps(page, steps, { params: args as never, trusted: true }),
  };

  Object.defineProperty(definition, TOOL_STEPS, {
    value: steps,
    enumerable: false,
  });
  return definition;
}

export interface SiteAdapterDefinition {
  /** Lowercase id, used as the tool prefix: `linkedin` gives `linkedin_search_people`. */
  id: string;
  /** Human name for listings: "LinkedIn". */
  name: string;
  description?: string;
  version?: string;
  /** Where to read about this adapter, for users deciding whether to install it. */
  homepage?: string;
  /**
   * Origins the adapter may touch. At least one; there is no safe default when
   * tools run against a logged-in browser. Supports `*.example.com`.
   */
  origins: readonly string[];
  /**
   * Ceiling on what any tool here may do. Omit to derive it from the tools,
   * which is the honest default; state it explicitly to keep a later tool from
   * quietly widening the adapter's reach.
   */
  capabilities?: readonly Capability[];
  /** Where to send the user when a call fails with `not_authenticated`. */
  signInUrl?: string;
  /**
   * Narrows what the `upload` capability may read. An adapter that only ever
   * attaches a CV should say `allowedExtensions: ['pdf', 'doc', 'docx']` here;
   * the host then refuses anything else before opening the file, so a
   * mistaken argument cannot post a database dump to a web form.
   *
   * The host applies its own limits on top and can only narrow these further.
   */
  uploads?: UploadPolicy;
  tools: Record<string, ToolDefinition<any, any>>;
}

/** A tool after validation, ready to list over MCP and to call. */
export interface CompiledTool {
  readonly id: string;
  readonly adapterId: string;
  readonly description: string;
  readonly risk: RiskLevel;
  readonly capabilities: readonly Capability[];
  readonly requiresConfirm: boolean;
  readonly timeoutMs?: number;
  readonly params: ParamShape;
  /** Present only for step-defined tools. A JS handler has none, so it cannot be packed. */
  readonly steps?: readonly Step[];
  /** The wire name, given how the host is serving this adapter. */
  name(options?: ToolNameOptions): string;
  /** The MCP `inputSchema`. */
  inputSchema(): JsonSchemaNode;
  /** Validates arguments, then runs the handler. Never throws. */
  run(
    page: BrowserSession,
    args: unknown,
    context?: Partial<ToolContext>,
  ): Promise<AdapterResult<unknown>>;
}

export interface SiteAdapter {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly version: string;
  readonly homepage?: string;
  readonly origins: readonly string[];
  readonly capabilities: readonly Capability[];
  readonly signInUrl?: string;
  readonly uploads: UploadPolicy;
  readonly guard: UrlGuard;
  readonly tools: readonly CompiledTool[];
  tool(id: string): CompiledTool | undefined;
}

const CONFIRM_PARAM: JsonSchemaNode = {
  type: 'boolean',
  description: 'Must be true. This call cannot be undone.',
};

export function defineSiteAdapter(definition: SiteAdapterDefinition): SiteAdapter {
  assertValidId(definition.id, 'adapter');

  if (!definition.name?.trim()) {
    throw new AdapterDefinitionError(`Adapter "${definition.id}" needs a display name.`);
  }
  if (!definition.tools || Object.keys(definition.tools).length === 0) {
    throw new AdapterDefinitionError(`Adapter "${definition.id}" defines no tools.`);
  }

  const guard = createUrlGuard([...definition.origins]);

  if (definition.signInUrl && !guard.allows(definition.signInUrl)) {
    throw new AdapterDefinitionError(
      `Adapter "${definition.id}" has a signInUrl outside its own origins: ${definition.signInUrl}`,
    );
  }

  const declaredCeiling = definition.capabilities
    ? assertCapabilities(definition.id, definition.capabilities)
    : undefined;

  const tools: CompiledTool[] = [];
  const usedCapabilities = new Set<Capability>();

  for (const [toolId, tool] of Object.entries(definition.tools)) {
    const compiled = compileTool(definition.id, toolId, tool, declaredCeiling);
    compiled.capabilities.forEach((capability) => usedCapabilities.add(capability));
    tools.push(compiled);
  }

  const capabilities = declaredCeiling ?? orderCapabilities(usedCapabilities);
  const byId = new Map(tools.map((tool) => [tool.id, tool]));

  return Object.freeze({
    id: definition.id,
    name: definition.name.trim(),
    description: definition.description?.trim() || `Tools for ${definition.name.trim()}.`,
    version: definition.version?.trim() || '0.0.0',
    homepage: definition.homepage,
    origins: guard.origins,
    capabilities,
    signInUrl: definition.signInUrl,
    uploads: definition.uploads ?? {},
    guard,
    tools: Object.freeze(tools),
    tool: (id: string) => byId.get(id),
  });
}

function compileTool(
  adapterId: string,
  toolId: string,
  tool: ToolDefinition<any, any>,
  ceiling: readonly Capability[] | undefined,
): CompiledTool {
  assertValidId(toolId, 'tool');
  const where = `${adapterId}.${toolId}`;

  if (!tool.description?.trim()) {
    throw new AdapterDefinitionError(`Tool ${where} needs a description.`);
  }
  if (typeof tool.handler !== 'function') {
    throw new AdapterDefinitionError(`Tool ${where} needs a handler function.`);
  }

  const risk: RiskLevel = tool.risk ?? 'read';
  if (!['read', 'write', 'irreversible'].includes(risk)) {
    throw new AdapterDefinitionError(
      `Tool ${where} has risk "${risk}"; expected read, write, or irreversible.`,
    );
  }

  const capabilities = tool.capabilities
    ? assertCapabilities(where, tool.capabilities)
    : (ceiling ?? defaultCapabilitiesFor(risk));

  if (ceiling) {
    const excess = capabilities.filter((capability) => !ceiling.includes(capability));
    if (excess.length) {
      throw new AdapterDefinitionError(
        `Tool ${where} needs ${excess.join(', ')}, which the adapter did not declare. ` +
          `Add it to the adapter's capabilities or drop it from the tool.`,
      );
    }
  }

  // Uploading puts a local file on a website. Whatever else that is, it is not
  // a read, and mislabelling it hides the call from any policy keyed on risk.
  if (capabilities.includes('upload') && risk === 'read') {
    throw new AdapterDefinitionError(
      `Tool ${where} uploads a file but is declared risk: 'read'. Use 'write' or 'irreversible'.`,
    );
  }

  const params: ParamShape = tool.params ?? {};
  for (const name of Object.keys(params)) {
    if (name === 'confirm') {
      throw new AdapterDefinitionError(
        `Tool ${where} declares a "confirm" parameter, which the SDK reserves.`,
      );
    }
  }

  const requiresConfirm = tool.confirm ?? risk === 'irreversible';
  const description = describeTool({
    description: tool.description,
    returns: tool.returns,
    risk,
    confirm: requiresConfirm,
  });

  return Object.freeze({
    id: toolId,
    adapterId,
    description,
    risk,
    capabilities,
    requiresConfirm,
    timeoutMs: tool.timeoutMs,
    params,
    steps: (tool as unknown as Record<symbol, unknown>)[TOOL_STEPS] as Step[] | undefined,

    name(options: ToolNameOptions = {}) {
      return toolNameFor(adapterId, toolId, options);
    },

    inputSchema() {
      const schema = paramsToJsonSchema(params);
      if (requiresConfirm) {
        schema.properties = { ...schema.properties, confirm: { ...CONFIRM_PARAM } };
        schema.required = [...(schema.required ?? []), 'confirm'];
      }
      return schema;
    },

    async run(page: BrowserSession, args: unknown, context: Partial<ToolContext> = {}) {
      const raw = (args ?? {}) as Record<string, unknown>;
      const { confirm, ...rest } = raw;

      if (requiresConfirm && confirm !== true) {
        return err('refused', `${where} will not run without confirm: true.`, {
          hint: 'Show the user what this will do, then call again with confirm: true.',
        });
      }

      const validated = validateParams(params, rest);
      if (!validated.ok) {
        return err('invalid_input', validated.errors.join(' '), {
          hint: 'Fix the arguments and call again.',
        });
      }

      const fullContext: ToolContext = {
        adapterId,
        toolId,
        confirmed: confirm === true,
        remainingMs: context.remainingMs ?? tool.timeoutMs ?? 0,
        ...context,
      };

      try {
        const result = await tool.handler(page, validated.value, fullContext);
        return isAdapterResult(result) ? result : ok(result);
      } catch (error) {
        return toAdapterResult(error);
      }
    },
  });
}

/**
 * Distinguishes a handler that returned an `AdapterResult` from one that
 * returned plain data. The shape check is deliberately narrow — `{ ok: true }`
 * alone is not enough, since that is a plausible payload on its own.
 */
function isAdapterResult(value: unknown): value is AdapterResult<unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.ok === true) return 'data' in record;
  if (record.ok === false) return 'error' in record;
  return false;
}

function assertCapabilities(where: string, capabilities: readonly Capability[]): Capability[] {
  const unknown = capabilities.filter((capability) => !ALL_CAPABILITIES.includes(capability));
  if (unknown.length) {
    throw new AdapterDefinitionError(
      `${where} declares unknown capabilities: ${unknown.join(', ')}. ` +
        `Known capabilities are ${ALL_CAPABILITIES.join(', ')}.`,
    );
  }
  return orderCapabilities(new Set(capabilities));
}

/** Stable order, so a declaration reads the same everywhere it is printed. */
function orderCapabilities(capabilities: Set<Capability>): Capability[] {
  return ALL_CAPABILITIES.filter((capability) => capabilities.has(capability));
}

/**
 * A tool that says nothing about capabilities gets what its risk level
 * implies: reading needs to move around and read, writing also needs to
 * interact. Neither implies `upload` or `evaluate` — those reach past the page
 * (the disk, and the origin's own credentials) and are always opt-in.
 */
function defaultCapabilitiesFor(risk: RiskLevel): Capability[] {
  return risk === 'read' ? ['navigate', 'read'] : ['navigate', 'read', 'interact'];
}
