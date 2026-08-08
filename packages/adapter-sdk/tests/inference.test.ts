/**
 * Type-level checks.
 *
 * These assertions do their work at compile time — `tsc --noEmit` over this
 * file is the real test, and the runtime expectations below just keep vitest
 * reporting the file. If `defineTool` stops inferring, this stops compiling.
 */
import { describe, expect, it } from 'vitest';
import { defineSiteAdapter, defineTool } from '../src/define.js';
import { p, type InferParams } from '../src/schema.js';

type Expect<T extends true> = T;
type Equals<A, B> =
  (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2 ? true : false;

const shape = {
  query: p.string('Search terms'),
  limit: p.integer().default(10),
  location: p.string().optional(),
  sort: p.enum(['relevance', 'recent']).optional(),
  tags: p.array(p.string()).optional(),
  file: p.file(),
};

/** Required stays required; `.optional()` becomes optional; a default stays present. */
type _RequiredStaysRequired = Expect<Equals<InferParams<typeof shape>['query'], string>>;
type _DefaultIsAlwaysPresent = Expect<Equals<InferParams<typeof shape>['limit'], number>>;
type _OptionalIsOptional = Expect<
  Equals<Pick<InferParams<typeof shape>, 'location'>, { location?: string }>
>;
type _EnumNarrows = Expect<
  Equals<InferParams<typeof shape>['sort'], 'relevance' | 'recent' | undefined>
>;
type _ArrayElementType = Expect<Equals<InferParams<typeof shape>['tags'], string[] | undefined>>;
type _FileHasPath = Expect<Equals<InferParams<typeof shape>['file']['path'], string | undefined>>;

describe('defineTool inference', () => {
  it('types args from the declared params', () => {
    const tool = defineTool({
      description: 'Search people.',
      params: { query: p.string(), limit: p.integer().default(10) },
      handler: async (_page, args) => {
        // Both lines are the point: these would be `any` without defineTool.
        const upper: string = args.query.toUpperCase();
        const doubled: number = args.limit * 2;
        return { upper, doubled };
      },
    });
    expect(tool.description).toBe('Search people.');
  });

  it('types a file parameter as a file reference', () => {
    const tool = defineTool({
      description: 'Attach a CV.',
      risk: 'write' as const,
      capabilities: ['navigate', 'read', 'interact', 'upload'] as const,
      params: { cv: p.file('The CV to attach.') },
      handler: async (page, args) => page.upload('input[type=file]', args.cv),
    });
    expect(tool.risk).toBe('write');
  });

  it('still accepts a plain object literal', () => {
    const adapter = defineSiteAdapter({
      id: 'x',
      name: 'X',
      origins: ['x.test'],
      tools: {
        a: { description: 'a', handler: async () => ({ done: true }) },
        b: defineTool({
          description: 'b',
          params: { n: p.integer() },
          handler: async (_page, args) => args.n + 1,
        }),
      },
    });
    expect(adapter.tools.map((tool) => tool.id)).toEqual(['a', 'b']);
  });
});
