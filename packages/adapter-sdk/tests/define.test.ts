import { describe, expect, it, vi } from 'vitest';
import { AdapterDefinitionError, defineSiteAdapter, defineTool } from '../src/define.js';
import { p } from '../src/schema.js';
import { AdapterFailure, err } from '../src/result.js';
import type { BrowserSession, ToolContext } from '../src/session.js';

/** Enough of a session to run a handler; nothing here touches a real browser. */
function stubSession(overrides: Partial<BrowserSession> = {}): BrowserSession {
  return {
    url: 'https://www.linkedin.com/feed/',
    title: 'Feed',
    signal: new AbortController().signal,
    goto: vi.fn(async () => {}),
    waitFor: vi.fn(async () => {}),
    // `extract` is generic over the spec, which a plain mock cannot express.
    extract: vi.fn(async () => []) as unknown as BrowserSession['extract'],
    text: vi.fn(async () => null),
    exists: vi.fn(async () => false),
    count: vi.fn(async () => 0),
    click: vi.fn(async () => {}),
    fill: vi.fn(async () => {}),
    select: vi.fn(async () => {}),
    press: vi.fn(async () => {}),
    scroll: vi.fn(async () => {}),
    screenshot: vi.fn(async () => ({ mimeType: 'image/png', base64: '', width: 0, height: 0 })),
    readPage: vi.fn(async () => ({ url: '', title: '', text: '', truncated: false })),
    upload: vi.fn(async () => ({ files: [] })),
    uploadViaPicker: vi.fn(async () => ({ files: [] })),
    uploadToDropZone: vi.fn(async () => ({ files: [] })),
    network: { capture: vi.fn(async () => ({ stop: vi.fn(async () => []) })) },
    log: vi.fn(),
    ...overrides,
  };
}

function linkedin() {
  return defineSiteAdapter({
    id: 'linkedin',
    name: 'LinkedIn',
    version: '1.0.0',
    origins: ['https://www.linkedin.com'],
    signInUrl: 'https://www.linkedin.com/login',
    tools: {
      search_people: {
        description: 'Search people.',
        returns: 'name and headline for each result',
        params: { query: p.string('Search terms'), limit: p.integer().default(10) },
        handler: async (page, args) => {
          await page.goto(`https://www.linkedin.com/search/?q=${args.query}`);
          return [{ name: 'Ada', limit: args.limit }];
        },
      },
      send_connection_request: {
        description: 'Send a connection request.',
        risk: 'irreversible',
        params: { profileUrl: p.url('Profile to connect with') },
        handler: async () => ({ sent: true }),
      },
    },
  });
}

describe('defineSiteAdapter', () => {
  it('compiles tools with wire names and schemas', () => {
    const adapter = linkedin();
    expect(adapter.tools.map((tool) => tool.name())).toEqual([
      'linkedin_search_people',
      'linkedin_send_connection_request',
    ]);
    expect(adapter.tool('search_people')?.inputSchema()).toEqual({
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms' },
        limit: { type: 'integer', default: 10 },
      },
      required: ['query'],
      additionalProperties: false,
    });
  });

  it('folds risk and confirmation into the description the agent reads', () => {
    const adapter = linkedin();
    expect(adapter.tool('search_people')?.description).toBe(
      'Search people. Returns name and headline for each result.',
    );
    expect(adapter.tool('send_connection_request')?.description).toBe(
      'Send a connection request. Irreversible. Requires confirm: true.',
    );
  });

  it('derives the adapter capability ceiling from its tools', () => {
    const adapter = linkedin();
    // search is read-only; the connection request is a write, so it adds interact.
    expect(adapter.capabilities).toEqual(['navigate', 'read', 'interact']);
    expect(adapter.tool('search_people')?.capabilities).toEqual(['navigate', 'read']);
  });

  it('never grants evaluate implicitly', () => {
    const adapter = linkedin();
    expect(adapter.capabilities).not.toContain('evaluate');
  });

  it('rejects a tool that needs more than the adapter declared', () => {
    expect(() =>
      defineSiteAdapter({
        id: 'linkedin',
        name: 'LinkedIn',
        origins: ['https://www.linkedin.com'],
        capabilities: ['navigate', 'read'],
        tools: {
          scrape: {
            description: 'Scrape.',
            capabilities: ['evaluate'],
            handler: async () => ({}),
          },
        },
      }),
    ).toThrow(/needs evaluate, which the adapter did not declare/);
  });

  it('rejects an adapter with no origins', () => {
    expect(() =>
      defineSiteAdapter({
        id: 'x',
        name: 'X',
        origins: [],
        tools: { a: { description: 'a', handler: async () => ({}) } },
      }),
    ).toThrow(/at least one origin/);
  });

  it('rejects a sign-in URL outside the adapter fence', () => {
    expect(() =>
      defineSiteAdapter({
        id: 'linkedin',
        name: 'LinkedIn',
        origins: ['https://www.linkedin.com'],
        signInUrl: 'https://accounts.google.com/signin',
        tools: { a: { description: 'a', handler: async () => ({}) } },
      }),
    ).toThrow(/signInUrl outside its own origins/);
  });

  it('rejects ids that MCP clients cannot address', () => {
    expect(() =>
      defineSiteAdapter({
        id: 'linkedin',
        name: 'LinkedIn',
        origins: ['https://www.linkedin.com'],
        tools: { 'search.people': { description: 'a', handler: async () => ({}) } },
      }),
    ).toThrow(/search\.people/);
  });

  it('reserves the confirm parameter', () => {
    expect(() =>
      defineSiteAdapter({
        id: 'linkedin',
        name: 'LinkedIn',
        origins: ['https://www.linkedin.com'],
        tools: {
          a: { description: 'a', params: { confirm: p.boolean() }, handler: async () => ({}) },
        },
      }),
    ).toThrow(/reserves/);
  });

  it('never grants upload implicitly, however risky the tool claims to be', () => {
    const adapter = defineSiteAdapter({
      id: 'linkedin',
      name: 'LinkedIn',
      origins: ['https://www.linkedin.com'],
      tools: {
        apply: { description: 'Apply.', risk: 'irreversible', handler: async () => ({}) },
      },
    });
    expect(adapter.tool('apply')?.capabilities).toEqual(['navigate', 'read', 'interact']);
    expect(adapter.capabilities).not.toContain('upload');
  });

  it('rejects a tool that uploads while calling itself read-only', () => {
    expect(() =>
      defineSiteAdapter({
        id: 'linkedin',
        name: 'LinkedIn',
        origins: ['https://www.linkedin.com'],
        tools: {
          attach: {
            description: 'Attach a CV.',
            risk: 'read',
            capabilities: ['navigate', 'interact', 'upload'],
            handler: async () => ({}),
          },
        },
      }),
    ).toThrow(/uploads a file but is declared risk: 'read'/);
  });

  it('carries the adapter upload policy through', () => {
    const adapter = defineSiteAdapter({
      id: 'linkedin',
      name: 'LinkedIn',
      origins: ['https://www.linkedin.com'],
      uploads: { allowedExtensions: ['pdf', 'doc', 'docx'], maxBytes: 5_000_000 },
      tools: {
        attach: {
          description: 'Attach a CV.',
          risk: 'write',
          capabilities: ['navigate', 'read', 'interact', 'upload'],
          params: { file: p.file('The CV to attach.') },
          handler: async (page, args) => page.upload('input[type=file]', args.file),
        },
      },
    });
    expect(adapter.uploads).toEqual({
      allowedExtensions: ['pdf', 'doc', 'docx'],
      maxBytes: 5_000_000,
    });
    expect(adapter.capabilities).toContain('upload');
  });

  it('describes a file parameter in a shape a model can fill in', () => {
    const adapter = defineSiteAdapter({
      id: 'linkedin',
      name: 'LinkedIn',
      origins: ['https://www.linkedin.com'],
      tools: {
        attach: {
          description: 'Attach a CV.',
          risk: 'write',
          capabilities: ['navigate', 'read', 'interact', 'upload'],
          params: { file: p.file('The CV to attach.') },
          handler: async () => ({}),
        },
      },
    });
    const schema = adapter.tool('attach')!.inputSchema();
    expect(schema.required).toEqual(['file']);
    expect(schema.properties?.file).toMatchObject({
      type: 'object',
      description: 'The CV to attach.',
      additionalProperties: false,
    });
    expect(Object.keys(schema.properties?.file?.properties ?? {})).toEqual([
      'path',
      'url',
      'base64',
      'filename',
      'mimeType',
    ]);
  });

  it('rejects an unknown capability rather than ignoring it', () => {
    expect(() =>
      defineSiteAdapter({
        id: 'x',
        name: 'X',
        origins: ['x.test'],
        capabilities: ['teleport' as never],
        tools: { a: { description: 'a', handler: async () => ({}) } },
      }),
    ).toThrow(AdapterDefinitionError);
  });
});

describe('CompiledTool.run', () => {
  it('validates, defaults, and wraps a plain return value', async () => {
    const tool = linkedin().tool('search_people')!;
    const page = stubSession();
    const result = await tool.run(page, { query: 'rust' });

    expect(result).toEqual({ ok: true, data: [{ name: 'Ada', limit: 10 }] });
    expect(page.goto).toHaveBeenCalledWith('https://www.linkedin.com/search/?q=rust');
  });

  it('returns invalid_input instead of calling the handler', async () => {
    const tool = linkedin().tool('search_people')!;
    const page = stubSession();
    const result = await tool.run(page, {});

    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(page.goto).not.toHaveBeenCalled();
  });

  it('refuses an irreversible tool without confirm', async () => {
    const tool = linkedin().tool('send_connection_request')!;
    const result = await tool.run(stubSession(), { profileUrl: 'https://www.linkedin.com/in/ada' });
    expect(result).toMatchObject({ ok: false, error: { code: 'refused' } });
  });

  it('runs once confirm is passed, and does not leak it to the handler', async () => {
    const handler = vi.fn(
      async (_page: BrowserSession, _args: { profileUrl: string }, _context: ToolContext) => ({
        sent: true,
      }),
    );
    const adapter = defineSiteAdapter({
      id: 'linkedin',
      name: 'LinkedIn',
      origins: ['https://www.linkedin.com'],
      tools: {
        send: defineTool({
          description: 'Send.',
          risk: 'irreversible',
          params: { profileUrl: p.url() },
          handler,
        }),
      },
    });

    const result = await adapter
      .tool('send')!
      .run(stubSession(), { profileUrl: 'https://www.linkedin.com/in/ada', confirm: true });

    expect(result).toEqual({ ok: true, data: { sent: true } });
    expect(handler.mock.calls[0]?.[1]).toEqual({ profileUrl: 'https://www.linkedin.com/in/ada' });
    expect(handler.mock.calls[0]?.[2]).toMatchObject({ confirmed: true, toolId: 'send' });
  });

  it('advertises confirm in the schema so the agent knows to send it', () => {
    const schema = linkedin().tool('send_connection_request')!.inputSchema();
    expect(schema.properties?.confirm).toMatchObject({ type: 'boolean' });
    expect(schema.required).toContain('confirm');
  });

  it('passes an explicit AdapterResult through untouched', async () => {
    const adapter = defineSiteAdapter({
      id: 'x',
      name: 'X',
      origins: ['x.test'],
      tools: {
        a: {
          description: 'a',
          handler: async () => err('not_authenticated', 'Signed out.', { hint: 'Log in.' }),
        },
      },
    });
    expect(await adapter.tool('a')!.run(stubSession(), {})).toEqual({
      ok: false,
      error: { code: 'not_authenticated', message: 'Signed out.', hint: 'Log in.' },
    });
  });

  it('turns a thrown AdapterFailure into a typed error', async () => {
    const adapter = defineSiteAdapter({
      id: 'x',
      name: 'X',
      origins: ['x.test'],
      tools: {
        a: {
          description: 'a',
          handler: async () => {
            throw new AdapterFailure('selector_missing', 'The results list moved.');
          },
        },
      },
    });
    expect(await adapter.tool('a')!.run(stubSession(), {})).toEqual({
      ok: false,
      error: { code: 'selector_missing', message: 'The results list moved.' },
    });
  });

  it('never lets an unexpected throw escape to the transport', async () => {
    const adapter = defineSiteAdapter({
      id: 'x',
      name: 'X',
      origins: ['x.test'],
      tools: {
        a: {
          description: 'a',
          handler: async () => {
            throw new TypeError('cannot read properties of null');
          },
        },
      },
    });
    expect(await adapter.tool('a')!.run(stubSession(), {})).toMatchObject({
      ok: false,
      error: { code: 'failed', message: 'cannot read properties of null' },
    });
  });

  it('does not mistake a payload that happens to have an ok field', async () => {
    const adapter = defineSiteAdapter({
      id: 'x',
      name: 'X',
      origins: ['x.test'],
      tools: { a: { description: 'a', handler: async () => ({ ok: true, count: 3 }) } },
    });
    expect(await adapter.tool('a')!.run(stubSession(), {})).toEqual({
      ok: true,
      data: { ok: true, count: 3 },
    });
  });
});
