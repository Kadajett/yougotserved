#!/usr/bin/env node

/**
 * Minimal adapter host for local, one-shot calls.
 *
 * Adapter code runs against the constrained BrowserSession interface. This
 * host translates that interface to the generic Chrome bridge; adapters never
 * receive the MCP client or arbitrary page JavaScript capability.
 */

import { readFile, stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Client } from '../app/native-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../app/native-server/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';

function parseCli(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith('--') || value === undefined) {
      throw new Error(`Expected --name value, got ${name ?? '<end>'}.`);
    }
    values[name.slice(2)] = value;
  }
  return values;
}

function parseTextResult(result) {
  if (result.isError) {
    const message = result.content?.find((item) => item.type === 'text')?.text;
    throw new Error(message || 'Chrome bridge call failed.');
  }
  const text = result.content?.find((item) => item.type === 'text')?.text;
  if (typeof text !== 'string') return result.structuredContent ?? result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms, signal) {
  return new Promise((resolveSleep, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timeout = setTimeout(resolveSleep, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

class ChromeBrowserSession {
  constructor({ client, adapter, tool, tabId, signal, confirmed }) {
    this.client = client;
    this.adapter = adapter;
    this.tool = tool;
    this.tabId = tabId;
    this.signal = signal;
    this.confirmed = confirmed;
    this.currentUrl = '';
    this.currentTitle = '';
  }

  get url() {
    return this.currentUrl;
  }

  get title() {
    return this.currentTitle;
  }

  require(capability) {
    if (!this.tool.capabilities.includes(capability)) {
      throw new Error(`${this.adapter.id}.${this.tool.id} lacks ${capability} capability.`);
    }
  }

  async call(name, args = {}) {
    if (this.signal.aborted) throw this.signal.reason;
    const result = await this.client.callTool({ name, arguments: args });
    return parseTextResult(result);
  }

  async javascript(code, timeoutMs = 15_000) {
    const outer = await this.call('chrome_javascript', {
      tabId: this.tabId,
      code,
      timeoutMs,
      maxOutputBytes: 512_000,
    });
    if (!outer?.success) throw new Error(outer?.error || 'Page JavaScript failed.');
    if (typeof outer.result !== 'string') return outer.result;
    try {
      return JSON.parse(outer.result);
    } catch {
      return outer.result;
    }
  }

  async refreshMeta() {
    const meta = await this.javascript('return {url: location.href, title: document.title};');
    this.currentUrl = meta.url;
    this.currentTitle = meta.title;
  }

  async goto(url, options = {}) {
    this.require('navigate');
    this.log(`goto ${new URL(url).origin}${new URL(url).pathname}`);
    this.adapter.guard.assert(url);
    await this.call('chrome_navigate', {
      tabId: options.newTab ? undefined : this.tabId,
      url,
      refresh: options.refresh,
    });
    await this.refreshMeta();
    if (!options.refresh && this.currentUrl !== url) {
      await this.call('chrome_navigate', { tabId: this.tabId, url });
      await this.refreshMeta();
    }
    this.adapter.guard.assert(this.currentUrl);
    if (options.until) await this.waitFor(options.until, options);
  }

  async waitFor(target, options = {}) {
    const timeoutMs = options.timeoutMs ?? 10_000;
    if ('ms' in target) {
      await sleep(target.ms, this.signal);
      return;
    }
    if ('networkIdle' in target) {
      await sleep(target.forMs ?? 750, this.signal);
      return;
    }
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      await this.refreshMeta();
      let ready = false;
      if ('selector' in target) {
        ready = await this.javascript(
          `const element=document.querySelector(${JSON.stringify(target.selector)});` +
            `return !!element && (${target.visible ? '!!(element.offsetWidth || element.offsetHeight || element.getClientRects().length)' : 'true'});`,
        );
      } else if ('selectorGone' in target) {
        ready = !(await this.exists(target.selectorGone));
      } else if ('url' in target) {
        ready =
          typeof target.url === 'string'
            ? this.currentUrl.includes(target.url)
            : new RegExp(target.url.source, target.url.flags).test(this.currentUrl);
      }
      if (ready) return;
      await sleep(350, this.signal);
    }
    throw new Error(`Timed out after ${timeoutMs}ms waiting for ${JSON.stringify(target)}.`);
  }

  async extract(spec) {
    this.require('read');
    const code = `
      const spec=${JSON.stringify(spec)};
      const collapse=(value)=>value.replace(/\\s+/g,' ').trim();
      const select=(field,scope)=>{
        if(!field.selector) return scope.nodeType===1?[scope]:[];
        return field.all?Array.from(scope.querySelectorAll(field.selector)):[scope.querySelector(field.selector)].filter(Boolean);
      };
      const one=(field,element)=>{
        if(field.fields) return fields(field.fields,element);
        let value=null;
        if(field.attr) value=element.getAttribute(field.attr);
        else if(field.html) value=element.innerHTML;
        else if(field.prop==='checked') value=!!element.checked;
        else if(field.prop) value=element[field.prop] ?? element.getAttribute(field.prop);
        else value=element.textContent ?? '';
        if(value===null) return field.fallback ?? null;
        if(typeof value==='string'){
          if(field.trim ?? !field.html) value=collapse(value);
          if(field.regex){ const match=new RegExp(field.regex).exec(value); if(!match) return field.fallback ?? null; value=match[field.regexGroup ?? 1] ?? match[0] ?? ''; }
          if(field.number){ const match=value.replace(/[ ,]/g,'').match(/-?\\d+(\\.\\d+)?/); return match?Number(match[0]):(field.fallback ?? null); }
        }
        return value;
      };
      const field=(input,scope)=>{
        const spec=typeof input==='string'?{selector:input}:input;
        const elements=select(spec,scope);
        if(spec.exists) return elements.length>0;
        if(elements.length===0) return spec.fallback !== undefined ? spec.fallback : (spec.all?[]:null);
        return spec.all?elements.map((element)=>one(spec,element)):one(spec,elements[0]);
      };
      const fields=(shape,scope)=>Object.fromEntries(Object.entries(shape).map(([name,value])=>[name,field(value,scope)]));
      if(!spec.each) return fields(spec.fields,document);
      const offset=Math.max(0,spec.offset ?? 0), limit=Math.min(spec.limit ?? 1000,1000);
      return Array.from(document.querySelectorAll(spec.each)).slice(offset,offset+limit).map((element)=>fields(spec.fields,element));
    `;
    return this.javascript(code);
  }

  async text(selector) {
    this.require('read');
    return this.javascript(
      `const element=document.querySelector(${JSON.stringify(selector)}); return element ? (element.textContent ?? '').replace(/\\s+/g,' ').trim() : null;`,
    );
  }

  async exists(selector) {
    this.require('read');
    return this.javascript(`return !!document.querySelector(${JSON.stringify(selector)});`);
  }

  async count(selector) {
    this.require('read');
    return this.javascript(`return document.querySelectorAll(${JSON.stringify(selector)}).length;`);
  }

  async click(selector, options = {}) {
    this.require('interact');
    this.log(`click ${selector}`);
    // The bridge's ordinary click is a DOM `.click()`. Components such as
    // react-select need a trusted mousedown/mouseup sequence, so resolve a
    // center point declaratively and use the bridge's CDP drag path with an
    // identical start/end point (a zero-distance trusted click).
    const point = await this.javascript(
      `let element=document.querySelector(${JSON.stringify(selector)});` +
        `if(element?.classList.contains('select__input')) element=element.closest('.select__control');` +
        `if(!element) return null;` +
        `if(${options.scrollIntoView !== false}){` +
        `element.scrollIntoView({block:'center',inline:'center',behavior:'instant'});` +
        `await new Promise(resolve=>setTimeout(resolve,100));` +
        `}` +
        `const rect=element.getBoundingClientRect();` +
        `return rect.width&&rect.height?{x:rect.x+rect.width/2,y:rect.y+rect.height/2}:null;`,
    );
    if (point) {
      await this.call('chrome_computer', {
        action: 'left_click_drag',
        tabId: this.tabId,
        startCoordinates: point,
        coordinates: point,
      });
    } else {
      await this.call('chrome_click_element', {
        tabId: this.tabId,
        selector,
        timeout: options.timeoutMs ?? 5_000,
        waitForNavigation: false,
      });
    }
    if (options.until) await this.waitFor(options.until, options);
    await this.refreshMeta();
  }

  async fill(selector, value, options = {}) {
    this.require('interact');
    this.log(`fill ${selector}`);
    await this.javascript(
      `const element=document.querySelector(${JSON.stringify(selector)});` +
        `if(!element) return false;` +
        `element.scrollIntoView({block:'center',inline:'center',behavior:'instant'});` +
        `await new Promise(resolve=>setTimeout(resolve,100));` +
        `return true;`,
    );
    if (options.typed) {
      await this.click(selector);
      if (options.clear !== false) await this.press('Control+a');
      await this.call('chrome_keyboard', { tabId: this.tabId, selector, keys: value });
    } else {
      await this.call('chrome_fill_or_select', { tabId: this.tabId, selector, value });
    }
    if (options.submit) await this.press('Enter');
  }

  async select(selector, value) {
    this.require('interact');
    await this.call('chrome_fill_or_select', { tabId: this.tabId, selector, value });
  }

  async press(keys) {
    this.require('interact');
    await this.call('chrome_keyboard', { tabId: this.tabId, keys });
  }

  async scroll(options) {
    this.require('interact');
    if (options.selector) {
      await this.javascript(
        `document.querySelector(${JSON.stringify(options.selector)})?.scrollIntoView({block:'center'}); return true;`,
      );
    } else if (options.toBottom) {
      await this.javascript(
        'window.scrollTo(0,document.documentElement.scrollHeight); return true;',
      );
    } else {
      await this.javascript(`window.scrollBy(0,${Number(options.by ?? 0)}); return true;`);
    }
  }

  async upload(selector, files, options = {}) {
    this.require('upload');
    this.log(`upload ${selector}`);
    const refs = Array.isArray(files) ? files : [files];
    const uploaded = [];
    for (const ref of refs) {
      if (!ref || typeof ref !== 'object') throw new Error('Upload needs a file reference.');
      const sources = ['path', 'url', 'base64'].filter((key) => typeof ref[key] === 'string');
      if (sources.length !== 1) throw new Error('Upload needs exactly one file source.');
      if (ref.path) {
        const absolute = resolve(ref.path);
        if (
          absolute !== ref.path ||
          /\/(?:\.ssh|\.gnupg|\.aws|\.config\/google-chrome)(?:\/|$)/i.test(absolute)
        ) {
          throw new Error('Upload path was refused by the host policy.');
        }
        const extension = extname(absolute).slice(1).toLowerCase();
        if (
          this.adapter.uploads.allowedExtensions?.length &&
          !this.adapter.uploads.allowedExtensions.includes(extension)
        ) {
          throw new Error(`The adapter does not allow .${extension} uploads.`);
        }
        const info = await stat(absolute);
        if (this.adapter.uploads.maxBytes && info.size > this.adapter.uploads.maxBytes) {
          throw new Error('Upload exceeds the adapter size limit.');
        }
        if (
          !this.confirmed &&
          !(this.adapter.uploads.allowedRoots ?? []).some((root) => absolute.startsWith(`${root}/`))
        ) {
          throw new Error('Upload outside allowed roots needs a confirmed call.');
        }
        await this.call('chrome_upload_file', {
          tabId: this.tabId,
          selector,
          filePath: absolute,
          fileName: ref.filename,
          multiple: refs.length > 1,
        });
        uploaded.push({
          filename: ref.filename ?? absolute.split('/').at(-1),
          bytes: info.size,
          mimeType: ref.mimeType ?? '',
        });
      } else {
        await this.call('chrome_upload_file', {
          tabId: this.tabId,
          selector,
          fileUrl: ref.url,
          base64Data: ref.base64,
          fileName: ref.filename,
          multiple: refs.length > 1,
        });
        uploaded.push({ filename: ref.filename, bytes: 0, mimeType: ref.mimeType ?? '' });
      }
    }
    if (options.until) await this.waitFor(options.until, options);
    return { files: uploaded };
  }

  async uploadViaPicker(triggerSelector, files, options) {
    await this.click(triggerSelector);
    return this.upload('input[type="file"]', files, options);
  }

  async uploadToDropZone(_selector, _files, _options) {
    throw new Error('This host does not support drop-zone uploads yet.');
  }

  async readPage(options = {}) {
    this.require('read');
    const maxChars = options.maxChars ?? 50_000;
    const text = await this.javascript(
      `return (document.body?.innerText ?? '').slice(0,${maxChars});`,
    );
    return { url: this.url, title: this.title, text, truncated: text.length === maxChars };
  }

  async screenshot(options = {}) {
    this.require('screenshot');
    const response = await this.call('chrome_screenshot', {
      tabId: this.tabId,
      selector: options.selector,
      fullPage: options.fullPage,
      savePng: false,
      storeBase64: true,
    });
    return {
      mimeType: 'image/png',
      base64: response.base64 ?? '',
      width: response.width ?? 0,
      height: response.height ?? 0,
    };
  }

  get network() {
    throw new Error('Network capture is not implemented by this host.');
  }

  log(message) {
    process.stderr.write(`[${this.adapter.id}.${this.tool.id}] ${message}\n`);
  }
}

async function pickTab(client, requested, adapter) {
  if (requested) return Number(requested);
  const result = parseTextResult(
    await client.callTool({ name: 'get_windows_and_tabs', arguments: {} }),
  );
  const tabs = result.windows?.flatMap((window) => window.tabs ?? []) ?? [];
  const matching = tabs.find((tab) => /^https?:/.test(tab.url) && adapter.guard.allows(tab.url));
  if (matching) return matching.tabId;
  const active = tabs.find((tab) => tab.active && /^https?:/.test(tab.url));
  if (!active) throw new Error('No active web tab is available.');
  return active.tabId;
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  if (!cli.adapter || !cli.tool || !cli['args-file']) {
    throw new Error(
      'Usage: run-adapter --adapter file.js --tool id --args-file args.json [--tab-id id]',
    );
  }
  const adapter = (await import(pathToFileURL(resolve(cli.adapter)).href)).default;
  const tool = adapter.tool(cli.tool);
  if (!tool) throw new Error(`Adapter ${adapter.id} has no tool ${cli.tool}.`);
  const args = JSON.parse(await readFile(resolve(cli['args-file']), 'utf8'));
  const timeoutMs = tool.timeoutMs ?? 180_000;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`Adapter timed out after ${timeoutMs}ms.`)),
    timeoutMs,
  );
  const client = new Client({ name: 'yougotserved-adapter-host', version: '0.1.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(cli.endpoint ?? 'http://127.0.0.1:12306/mcp'),
  );
  try {
    await client.connect(transport);
    const tabId = await pickTab(client, cli['tab-id'], adapter);
    const page = new ChromeBrowserSession({
      client,
      adapter,
      tool,
      tabId,
      signal: controller.signal,
      confirmed: args.confirm === true,
    });
    await page.refreshMeta();
    const result = await tool.run(page, args, { remainingMs: timeoutMs });
    process.stdout.write(
      `${JSON.stringify({ adapter: adapter.id, tool: tool.id, tabId, result }, null, 2)}\n`,
    );
    if (!result.ok) process.exitCode = 2;
  } finally {
    clearTimeout(timeout);
    await client.close().catch(() => {});
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
