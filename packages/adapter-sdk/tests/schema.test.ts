import { describe, expect, it } from 'vitest';
import { p, paramsToJsonSchema, validateParams } from '../src/schema.js';

describe('paramsToJsonSchema', () => {
  it('emits the compact schema an MCP listing carries', () => {
    const schema = paramsToJsonSchema({
      query: p.string('Search terms'),
      limit: p.integer('Max results').default(10).max(100),
      location: p.string('City or region').optional(),
    });

    expect(schema).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms' },
        limit: { type: 'integer', description: 'Max results', default: 10, maximum: 100 },
        location: { type: 'string', description: 'City or region' },
      },
      required: ['query'],
      additionalProperties: false,
    });
  });

  it('treats a defaulted parameter as optional on the wire', () => {
    const schema = paramsToJsonSchema({ limit: p.integer().default(10) });
    expect(schema.required).toBeUndefined();
    expect(schema.properties?.limit?.default).toBe(10);
  });

  it('carries enums so the agent does not have to guess values', () => {
    const schema = paramsToJsonSchema({ sort: p.enum(['relevance', 'recent'], 'Ordering') });
    expect(schema.properties?.sort).toEqual({
      type: 'string',
      enum: ['relevance', 'recent'],
      description: 'Ordering',
    });
  });

  it('uses length bounds for strings and value bounds for numbers', () => {
    const schema = paramsToJsonSchema({
      name: p.string().min(2).max(40),
      age: p.integer().min(0).max(120),
    });
    expect(schema.properties?.name).toMatchObject({ minLength: 2, maxLength: 40 });
    expect(schema.properties?.age).toMatchObject({ minimum: 0, maximum: 120 });
  });

  it('nests objects and arrays', () => {
    const schema = paramsToJsonSchema({
      tags: p.array(p.string(), 'Labels'),
      filter: p.object({ company: p.string(), remote: p.boolean().optional() }),
    });
    expect(schema.properties?.tags).toEqual({
      type: 'array',
      items: { type: 'string' },
      description: 'Labels',
    });
    expect(schema.properties?.filter).toEqual({
      type: 'object',
      properties: { company: { type: 'string' }, remote: { type: 'boolean' } },
      required: ['company'],
      additionalProperties: false,
    });
  });

  it('does not let a builder mutate a shared node', () => {
    const base = p.string('Search terms');
    const derived = base.max(10).optional();
    expect(base.toJSON()).toEqual({ type: 'string', description: 'Search terms' });
    expect(derived.toJSON()).toEqual({
      type: 'string',
      description: 'Search terms',
      maxLength: 10,
    });
  });
});

describe('validateParams', () => {
  const shape = {
    query: p.string('Search terms'),
    limit: p.integer().default(10).min(1).max(50),
    remote: p.boolean().optional(),
    sort: p.enum(['relevance', 'recent']).optional(),
  };

  it('fills defaults so the handler never checks for absence', () => {
    const result = validateParams(shape, { query: 'rust' });
    expect(result).toEqual({ ok: true, value: { query: 'rust', limit: 10 } });
  });

  it('reports every problem at once rather than one per round trip', () => {
    const result = validateParams(shape, { limit: 99, sort: 'sideways' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors).toHaveLength(3);
    expect(result.errors.join(' ')).toMatch(/Missing required parameter "query"/);
    expect(result.errors.join(' ')).toMatch(/at most 50/);
    expect(result.errors.join(' ')).toMatch(/relevance, recent/);
  });

  it('coerces the string forms models actually send', () => {
    const result = validateParams(shape, { query: 'rust', limit: '25', remote: 'true' });
    expect(result).toEqual({ ok: true, value: { query: 'rust', limit: 25, remote: true } });
  });

  it('does not coerce nonsense into a number', () => {
    const result = validateParams(shape, { query: 'rust', limit: 'many' });
    expect(result.ok).toBe(false);
  });

  it('rejects a fractional value for an integer', () => {
    const result = validateParams(shape, { query: 'rust', limit: 2.5 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors[0]).toMatch(/whole number/);
  });

  it('flags unknown parameters instead of passing them through', () => {
    const result = validateParams(shape, { query: 'rust', cursor: 'abc' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.errors[0]).toMatch(/Unknown parameter "cursor"/);
  });

  it('validates inside arrays and objects', () => {
    const nested = {
      tags: p.array(p.enum(['a', 'b'])),
      filter: p.object({ company: p.string() }),
    };
    const bad = validateParams(nested, { tags: ['a', 'z'], filter: {} });
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error('expected failure');
    expect(bad.errors.join(' ')).toMatch(/tags\[1\]/);
    expect(bad.errors.join(' ')).toMatch(/filter\.company/);

    const good = validateParams(nested, { tags: ['a'], filter: { company: 'acme' } });
    expect(good.ok).toBe(true);
  });

  it('gives each call its own copy of an object default', () => {
    const shapeWithObjectDefault = {
      filter: p.object({ remote: p.boolean() }).default({ remote: true }),
    };
    const first = validateParams(shapeWithObjectDefault, {});
    const second = validateParams(shapeWithObjectDefault, {});
    if (!first.ok || !second.ok) throw new Error('expected success');
    expect(first.value.filter).not.toBe(second.value.filter);
  });

  it('rejects a non-object argument bag', () => {
    expect(validateParams(shape, 'query=rust').ok).toBe(false);
  });
});
