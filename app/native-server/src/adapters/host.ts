/**
 * Adapter host.
 *
 * Turns an installed pack into callable MCP tools. A pack holds steps, which
 * are data, so the host walks them with the SDK interpreter and drives the
 * browser through the same `chrome_*` tools an agent would use.
 *
 * No pack code runs, because a pack contains none. That is the whole reason
 * packs are declarative: a pack from a stranger cannot do anything the loop
 * below does not do on its behalf.
 */

import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { adaptersDir } from './registry-tools';
import { noteAdapterCall } from './support';

type ChromeCall = (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;

interface LoadedPack {
  /** Pack as validated by the SDK. Typed loosely to keep the SDK import lazy. */
  pack: any;
  file: string;
}

let cache: LoadedPack[] | null = null;
let cacheSignature = '';
/** Tool name to the pack and tool it came from. */
let index = new Map<string, { pack: any; toolName: string }>();

/**
 * Name, size and mtime of every pack file.
 *
 * Installing an adapter and listing tools again has to show the new tools, so
 * the cache cannot be keyed on nothing. A few stat calls on a few small files
 * cost less than parsing them, and far less than making the user restart.
 */
function signature(dir: string): string {
  if (!fs.existsSync(dir)) return '';
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.ygs.json'))
    .sort()
    .map((name) => {
      const stat = fs.statSync(path.join(dir, name));
      return `${name}:${stat.size}:${stat.mtimeMs}`;
    })
    .join('|');
}

/**
 * Reads every pack in the adapters directory.
 *
 * A pack that fails validation is skipped with a warning rather than taking the
 * whole server down. One bad file should not cost the user their other tools.
 */
export async function loadPacks(force = false): Promise<LoadedPack[]> {
  const dir = adaptersDir();
  const current = signature(dir);
  if (cache && !force && current === cacheSignature) return cache;

  const loaded: LoadedPack[] = [];
  index = new Map();

  if (fs.existsSync(dir)) {
    const { validatePack } = await import('@yougotserved/adapter-sdk');
    for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.ygs.json'))) {
      const file = path.join(dir, name);
      try {
        const pack = validatePack(JSON.parse(fs.readFileSync(file, 'utf8')));
        loaded.push({ pack, file });
        for (const toolName of Object.keys(pack.tools)) {
          index.set(`${pack.id}_${toolName}`, { pack, toolName });
        }
      } catch (error) {
        console.error(`Skipped ${name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  cache = loaded;
  cacheSignature = current;
  return loaded;
}

/** MCP tool listings for every installed pack. */
export async function packTools(): Promise<Tool[]> {
  const packs = await loadPacks();
  const tools: Tool[] = [];

  for (const { pack } of packs) {
    for (const [toolName, tool] of Object.entries(pack.tools as Record<string, any>)) {
      // The pack's own origins are in the description because the agent picking
      // a tool is the last point where a wrong site is cheap to catch.
      const where = pack.origins.join(', ');
      tools.push({
        name: `${pack.id}_${toolName}`,
        description: `${tool.description} [${where}]`,
        inputSchema: tool.inputSchema,
      });
    }
  }
  return tools;
}

export async function isPackTool(name: string): Promise<boolean> {
  await loadPacks();
  return index.has(name);
}

/**
 * Runs one pack tool.
 *
 * `call` reaches the extension. It is passed in rather than imported so the
 * stdio proxy and the HTTP server can both use this with their own transport.
 */
export async function handlePackTool(
  name: string,
  args: Record<string, unknown>,
  call: ChromeCall,
): Promise<CallToolResult> {
  await loadPacks();
  const entry = index.get(name);
  if (!entry) return text(`No installed adapter provides ${name}.`, true);

  const tool = entry.pack.tools[entry.toolName];
  const sdk = await import('@yougotserved/adapter-sdk');

  // A tool that changes something on the site asks first. The pack states this,
  // and the pack was audited at install time.
  if (tool.requiresConfirm && args.confirm !== true) {
    return text({
      confirmRequired: true,
      tool: name,
      risk: tool.risk,
      description: tool.description,
      origins: entry.pack.origins,
      warning:
        'This acts on the site as the signed-in user. Ask, then call again with confirm: true.',
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), tool.timeoutMs ?? 60_000);

  try {
    const { confirm: _confirm, ...rest } = args;
    const checked = sdk.validateSchemaArgs(tool.inputSchema, rest);
    if (!checked.ok) return text({ error: checked.errors.join(' '), code: 'invalid' }, true);

    const guard = sdk.createUrlGuard(entry.pack.origins);

    // Every browser call this tool makes carries the call that asked for it.
    // Without this the activity panel shows a bare chrome_navigate and the
    // person watching cannot tell which adapter moved their browser.
    //
    // It rides inside the arguments because the call crosses two hops to reach
    // the extension, and arguments are the only thing both forward verbatim.
    // The extension strips the key before the tool sees it.
    const via = { adapter: entry.pack.id, tool: name, args: checked.value };
    const attributed: ChromeCall = (toolName, toolArgs) =>
      call(toolName, { ...toolArgs, _ygsVia: via });

    const session = new McpBrowserSession(entry.pack, attributed, controller.signal, guard);

    const result = await sdk.runSteps(session as never, tool.steps, {
      params: checked.value as never,
      trusted: false,
    });

    // Counted only here, on the success path. A tool that errored proved
    // nothing, and asking for money on the back of one would be its own answer.
    return text({
      adapter: entry.pack.id,
      tool: entry.toolName,
      url: session.url,
      result,
      ...(noteAdapterCall() ?? {}),
    });
  } catch (error) {
    const failure = error as { code?: string; message?: string; hint?: string };
    return text(
      {
        error: failure.message ?? String(error),
        code: failure.code ?? 'failed',
        hint: failure.hint,
        adapter: entry.pack.id,
        tool: entry.toolName,
      },
      true,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------ *
 * The session
 * ------------------------------------------------------------------ */

/**
 * A `BrowserSession` backed by the extension.
 *
 * Every method checks the pack's origins before it touches the page, so a step
 * list cannot walk the browser somewhere the user did not agree to at install.
 */
class McpBrowserSession {
  url = '';
  title = '';

  constructor(
    private pack: any,
    private call: ChromeCall,
    readonly signal: AbortSignal,
    private urlGuard: { allows(url: string): boolean },
  ) {}

  private guard(url: string): void {
    if (!url || this.urlGuard.allows(url)) return;
    const error: any = new Error(
      `${this.pack.id} may only reach ${this.pack.origins.join(', ')}, not ${url}.`,
    );
    error.code = 'refused';
    throw error;
  }

  private async run(tool: string, args: Record<string, unknown>): Promise<any> {
    if (this.signal.aborted) {
      const error: any = new Error('Timed out.');
      error.code = 'timeout';
      throw error;
    }
    const result = await this.call(tool, args);
    const first = result.content?.[0];
    const body = first && first.type === 'text' ? first.text : '';

    if (result.isError) {
      const error: any = new Error(body || `${tool} failed.`);
      error.code = 'failed';
      throw error;
    }
    try {
      return JSON.parse(body);
    } catch {
      return body;
    }
  }

  async goto(url: string): Promise<void> {
    this.guard(url);
    await this.run('chrome_navigate', { url });
    this.url = url;
  }

  async waitFor(target: any, options: { timeoutMs?: number } = {}): Promise<void> {
    const deadline = Date.now() + (options.timeoutMs ?? 15_000);

    if ('ms' in target) {
      await sleep(Math.min(target.ms, 15_000));
      return;
    }

    // Polling, not a page-side observer. An observer would need code in the
    // page, which is exactly what a pack is not allowed to put there.
    for (;;) {
      if (this.signal.aborted) break;

      if ('selector' in target && (await this.exists(target.selector))) return;
      if ('selectorGone' in target && !(await this.exists(target.selectorGone))) return;
      if ('url' in target) {
        const now = await this.currentUrl();
        const pattern = target.url;
        const hit = typeof pattern === 'string' ? now.includes(pattern) : pattern.test(now);
        if (hit) return;
      }
      if ('networkIdle' in target) {
        await sleep(target.forMs ?? 700);
        return;
      }

      if (Date.now() > deadline) {
        const error: any = new Error(`Timed out waiting for ${JSON.stringify(target)}.`);
        error.code = 'timeout';
        throw error;
      }
      await sleep(250);
    }
  }

  private async currentUrl(): Promise<string> {
    const page = await this.run('chrome_extract', { spec: { fields: { _: { exists: true } } } });
    this.url = page?.url ?? this.url;
    return this.url;
  }

  async extract(spec: any): Promise<any> {
    const page = await this.run('chrome_extract', { spec });
    this.url = page?.url ?? this.url;
    this.guard(this.url);
    return page?.records;
  }

  async text(selector: string): Promise<string | null> {
    const record = await this.extract({ fields: { value: selector } });
    return (record?.value as string) ?? null;
  }

  async exists(selector: string): Promise<boolean> {
    const record = await this.extract({ fields: { found: { selector, exists: true } } });
    return record?.found === true;
  }

  async count(selector: string): Promise<number> {
    const record = await this.extract({ fields: { all: { selector, all: true } } });
    return Array.isArray(record?.all) ? record.all.length : 0;
  }

  async click(selector: string, options: any = {}): Promise<void> {
    await this.run('chrome_click_element', { selector });
    if (options.until) await this.waitFor(options.until);
  }

  async fill(selector: string, value: string, options: any = {}): Promise<void> {
    await this.run('chrome_fill_or_select', { selector, value });
    if (options.submit) await this.press('Enter');
    if (options.until) await this.waitFor(options.until);
  }

  async select(selector: string, value: string): Promise<void> {
    await this.run('chrome_fill_or_select', { selector, value });
  }

  async press(keys: string): Promise<void> {
    await this.run('chrome_keyboard', { keys });
  }

  async scroll(options: any = {}): Promise<void> {
    if (options.selector) {
      await this.run('chrome_computer', { action: 'scroll_to', selector: options.selector });
    } else if (options.toBottom) {
      await this.press('End');
    } else {
      await this.run('chrome_computer', {
        action: 'scroll',
        scrollDirection: (options.by ?? 0) < 0 ? 'up' : 'down',
        scrollAmount: Math.abs(options.by ?? 600),
      });
    }
    if (options.until) await this.waitFor(options.until);
  }

  async upload(selector: string, files: any, options: any = {}): Promise<any> {
    return this.doUpload({ selector, files, mode: 'input' }, options);
  }

  async uploadViaPicker(trigger: string, files: any, options: any = {}): Promise<any> {
    return this.doUpload({ selector: trigger, files, mode: 'picker' }, options);
  }

  async uploadToDropZone(selector: string, files: any, options: any = {}): Promise<any> {
    return this.doUpload({ selector, files, mode: 'input' }, options);
  }

  private async doUpload(args: any, options: any): Promise<any> {
    if (!this.pack.capabilities.includes('upload')) {
      const error: any = new Error(`${this.pack.id} did not declare the upload capability.`);
      error.code = 'refused';
      throw error;
    }
    const list = Array.isArray(args.files) ? args.files : [args.files];
    const receipt = await this.run('chrome_upload_file', {
      selector: args.selector,
      mode: args.mode,
      files: list.map((file: any) => file.path ?? file),
    });
    if (options.until) await this.waitFor(options.until);
    return receipt;
  }

  async screenshot(): Promise<any> {
    return this.run('chrome_screenshot', {});
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function text(body: unknown, isError = false): CallToolResult {
  return {
    content: [{ type: 'text', text: typeof body === 'string' ? body : JSON.stringify(body) }],
    isError,
  };
}
