/**
 * Parameter definitions.
 *
 * Adapters describe their inputs with a tiny builder that emits JSON Schema
 * directly and infers TypeScript types from the same declaration:
 *
 *     params: {
 *       query: p.string('Search terms'),
 *       limit: p.integer('Max results').default(10).max(100),
 *       location: p.string('City or region').optional(),
 *     }
 *
 * There is no Zod here, deliberately. MCP wants JSON Schema on the wire, an
 * adapter has to be a single shareable file that a sandbox can evaluate
 * without pulling a validation library in with it, and every byte of the
 * emitted schema is context an agent pays for on every request. A ~200-line
 * builder that produces exactly the schema we want beats a general-purpose
 * library plus a converter on all three counts. See DECISIONS.md.
 */

export type JsonSchemaNode = {
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description?: string;
  enum?: readonly (string | number)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  format?: string;
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
};

export class ParamError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParamError';
  }
}

/**
 * One declared parameter. `TValue` and `TOptional` exist only for inference;
 * nothing reads them at runtime.
 */
export class Param<TValue = unknown, TOptional extends boolean = false> {
  /** @internal phantom, carries the value type */
  declare readonly __value: TValue;
  /** @internal phantom, carries presence */
  declare readonly __optional: TOptional;

  constructor(
    readonly node: JsonSchemaNode,
    readonly isOptional: boolean = false,
    readonly hasDefault: boolean = false,
  ) {}

  private derive<V, O extends boolean>(
    patch: Partial<JsonSchemaNode>,
    optional = this.isOptional,
    hasDefault = this.hasDefault,
  ): Param<V, O> {
    return new Param<V, O>({ ...this.node, ...patch }, optional, hasDefault);
  }

  describe(description: string): Param<TValue, TOptional> {
    return this.derive<TValue, TOptional>({ description });
  }

  /** Absent inputs stay absent. The handler sees `undefined`. */
  optional(): Param<TValue, true> {
    return this.derive<TValue, true>({}, true, this.hasDefault);
  }

  /**
   * Absent inputs are filled in before the handler runs, so a defaulted
   * parameter is optional on the wire but always present in the handler.
   */
  default(value: TValue): Param<TValue, false> {
    return this.derive<TValue, false>({ default: value as unknown }, false, true);
  }

  min(value: number): Param<TValue, TOptional> {
    const key = this.node.type === 'string' ? 'minLength' : 'minimum';
    return this.derive<TValue, TOptional>({ [key]: value });
  }

  max(value: number): Param<TValue, TOptional> {
    const key = this.node.type === 'string' ? 'maxLength' : 'maximum';
    return this.derive<TValue, TOptional>({ [key]: value });
  }

  pattern(regex: string | RegExp): Param<TValue, TOptional> {
    return this.derive<TValue, TOptional>({
      pattern: typeof regex === 'string' ? regex : regex.source,
    });
  }

  /** Emits the JSON Schema fragment for this parameter. */
  toJSON(): JsonSchemaNode {
    return JSON.parse(JSON.stringify(this.node)) as JsonSchemaNode;
  }
}

export type ParamShape = Record<string, Param<any, any>>;

type Prettify<T> = { [K in keyof T]: T[K] } & {};

/** The argument object a handler receives, derived from its `params`. */
export type InferParams<S extends ParamShape> = Prettify<
  {
    [K in keyof S as S[K]['__optional'] extends true ? never : K]: S[K]['__value'];
  } & {
    [K in keyof S as S[K]['__optional'] extends true ? K : never]?: S[K]['__value'];
  }
>;

/* ------------------------------------------------------------------ *
 * Builders
 * ------------------------------------------------------------------ */

function make<T>(node: JsonSchemaNode, description?: string): Param<T, false> {
  return new Param<T, false>(description ? { ...node, description } : node);
}

export const p = {
  string(description?: string): Param<string, false> {
    return make<string>({ type: 'string' }, description);
  },

  number(description?: string): Param<number, false> {
    return make<number>({ type: 'number' }, description);
  },

  integer(description?: string): Param<number, false> {
    return make<number>({ type: 'integer' }, description);
  },

  boolean(description?: string): Param<boolean, false> {
    return make<boolean>({ type: 'boolean' }, description);
  },

  /** A closed set of string values. Cheaper for an agent than prose. */
  enum<const T extends readonly string[]>(
    values: T,
    description?: string,
  ): Param<T[number], false> {
    if (values.length === 0) throw new ParamError('p.enum() needs at least one value.');
    return make<T[number]>({ type: 'string', enum: [...values] }, description);
  },

  array<T>(items: Param<T, any>, description?: string): Param<T[], false> {
    return make<T[]>({ type: 'array', items: items.toJSON() }, description);
  },

  object<S extends ParamShape>(shape: S, description?: string): Param<InferParams<S>, false> {
    const { properties, required } = shapeToProperties(shape);
    const node: JsonSchemaNode = { type: 'object', properties, additionalProperties: false };
    if (required.length) node.required = required;
    return make<InferParams<S>>(node, description);
  },

  /** A URL string. The host still checks it against the adapter's origins. */
  url(description?: string): Param<string, false> {
    return make<string>({ type: 'string', format: 'uri' }, description);
  },

  /**
   * A file the caller wants uploaded.
   *
   * Flat properties rather than a `oneOf`, because MCP clients render `oneOf`
   * badly and models fill it in worse. Exactly one of path/url/base64 must be
   * set; `validateFileParam` enforces that after the schema check passes.
   *
   * `path` is the case that matters: a coding agent runs on the same machine
   * as the browser, so "attach my resume" is a path it already knows.
   */
  file(description = 'A file to upload.'): Param<FileParamValue, false> {
    return make<FileParamValue>(
      {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute path to a file on this machine. Use this when you have one.',
          },
          url: { type: 'string', description: 'URL to fetch the file from instead of a path.' },
          base64: { type: 'string', description: 'File contents, base64 encoded.' },
          filename: {
            type: 'string',
            description: 'Name to show the site. Required with base64.',
          },
          mimeType: { type: 'string', description: 'Content type. Sniffed if omitted.' },
        },
        additionalProperties: false,
      },
      description,
    );
  },
};

/** The runtime shape of a {@link p.file} parameter. */
export interface FileParamValue {
  path?: string;
  url?: string;
  base64?: string;
  filename?: string;
  mimeType?: string;
}

function shapeToProperties(shape: ParamShape): {
  properties: Record<string, JsonSchemaNode>;
  required: string[];
} {
  const properties: Record<string, JsonSchemaNode> = {};
  const required: string[] = [];
  for (const [name, param] of Object.entries(shape)) {
    properties[name] = param.toJSON();
    // A defaulted parameter is not required on the wire — the host fills it in.
    if (!param.isOptional && !param.hasDefault) required.push(name);
  }
  return { properties, required };
}

/** The `inputSchema` an MCP tool listing carries. */
export function paramsToJsonSchema(shape: ParamShape): JsonSchemaNode {
  const { properties, required } = shapeToProperties(shape);
  const schema: JsonSchemaNode = { type: 'object', properties };
  if (required.length) schema.required = required;
  schema.additionalProperties = false;
  return schema;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

/**
 * Checks and normalises the arguments an agent sent.
 *
 * Strings are coerced to numbers and booleans where the schema asks for them.
 * Models routinely send `"10"` for an integer and `"true"` for a flag, and
 * failing the call over that wastes a round trip to teach the model nothing
 * useful. Coercion is narrow: only well-formed literals convert.
 */
export function validateParams<S extends ParamShape>(
  shape: S,
  input: unknown,
): ValidationResult<InferParams<S>> {
  const errors: string[] = [];
  if (input !== undefined && input !== null && typeof input !== 'object') {
    return { ok: false, errors: ['Arguments must be an object.'] };
  }
  const args = (input ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [name, param] of Object.entries(shape)) {
    const raw = args[name];

    if (raw === undefined || raw === null) {
      if (param.hasDefault) {
        out[name] = structuredCloneish(param.node.default);
      } else if (!param.isOptional) {
        errors.push(`Missing required parameter "${name}".`);
      }
      continue;
    }

    const checked = checkValue(name, param.node, raw, errors);
    if (checked !== undefined) out[name] = checked;
  }

  for (const key of Object.keys(args)) {
    if (!(key in shape)) errors.push(`Unknown parameter "${key}".`);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out as InferParams<S> };
}

/**
 * The same checks, driven by a stored JSON schema rather than a `p` shape.
 *
 * A published pack carries `inputSchema`, not the builder that produced it, so
 * the host has nothing else to validate against. Arguments reaching this come
 * from an agent over the wire, so they are checked before any step runs.
 */
export function validateSchemaArgs(
  schema: JsonSchemaNode,
  input: unknown,
): ValidationResult<Record<string, unknown>> {
  const errors: string[] = [];
  if (input !== undefined && input !== null && typeof input !== 'object') {
    return { ok: false, errors: ['Arguments must be an object.'] };
  }
  const args = (input ?? {}) as Record<string, unknown>;
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const out: Record<string, unknown> = {};

  for (const [name, node] of Object.entries(properties)) {
    const raw = args[name];

    if (raw === undefined || raw === null) {
      if (node.default !== undefined) out[name] = structuredCloneish(node.default);
      else if (required.has(name)) errors.push(`Missing required parameter "${name}".`);
      continue;
    }

    const checked = checkValue(name, node, raw, errors);
    if (checked !== undefined) out[name] = checked;
  }

  for (const key of Object.keys(args)) {
    if (!(key in properties)) errors.push(`Unknown parameter "${key}".`);
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: out };
}

function checkValue(
  path: string,
  node: JsonSchemaNode,
  raw: unknown,
  errors: string[],
): unknown | undefined {
  const before = errors.length;
  const value = coerce(node, raw);

  switch (node.type) {
    case 'string': {
      if (typeof value !== 'string') {
        errors.push(`"${path}" must be a string.`);
        break;
      }
      if (node.enum && !node.enum.includes(value)) {
        errors.push(`"${path}" must be one of: ${node.enum.join(', ')}.`);
      }
      if (node.minLength !== undefined && value.length < node.minLength) {
        errors.push(`"${path}" must be at least ${node.minLength} characters.`);
      }
      if (node.maxLength !== undefined && value.length > node.maxLength) {
        errors.push(`"${path}" must be at most ${node.maxLength} characters.`);
      }
      if (node.pattern !== undefined && !new RegExp(node.pattern).test(value)) {
        errors.push(`"${path}" does not match ${node.pattern}.`);
      }
      break;
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        errors.push(`"${path}" must be a number.`);
        break;
      }
      if (node.type === 'integer' && !Number.isInteger(value)) {
        errors.push(`"${path}" must be a whole number.`);
      }
      if (node.minimum !== undefined && value < node.minimum) {
        errors.push(`"${path}" must be at least ${node.minimum}.`);
      }
      if (node.maximum !== undefined && value > node.maximum) {
        errors.push(`"${path}" must be at most ${node.maximum}.`);
      }
      break;
    }
    case 'boolean': {
      if (typeof value !== 'boolean') errors.push(`"${path}" must be true or false.`);
      break;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        errors.push(`"${path}" must be an array.`);
        break;
      }
      if (node.items) {
        const items = node.items;
        value.forEach((entry, index) => checkValue(`${path}[${index}]`, items, entry, errors));
      }
      break;
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        errors.push(`"${path}" must be an object.`);
        break;
      }
      const record = value as Record<string, unknown>;
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        const childValue = record[key];
        if (childValue === undefined || childValue === null) {
          if (node.required?.includes(key)) {
            errors.push(`Missing required parameter "${path}.${key}".`);
          }
          continue;
        }
        checkValue(`${path}.${key}`, child, childValue, errors);
      }
      if (node.additionalProperties === false) {
        for (const key of Object.keys(record)) {
          if (!(key in (node.properties ?? {}))) {
            errors.push(`Unknown parameter "${path}.${key}".`);
          }
        }
      }
      break;
    }
    default:
      break;
  }

  return errors.length === before ? value : undefined;
}

function coerce(node: JsonSchemaNode, raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  if (node.type === 'number' || node.type === 'integer') {
    const trimmed = raw.trim();
    if (trimmed !== '' && /^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    return raw;
  }
  if (node.type === 'boolean') {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    return raw;
  }
  return raw;
}

function structuredCloneish(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  return JSON.parse(JSON.stringify(value)) as unknown;
}
