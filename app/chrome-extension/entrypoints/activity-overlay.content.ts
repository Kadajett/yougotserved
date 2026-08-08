/**
 * Activity overlay.
 *
 * Shows what an agent did on this page, in the corner, with the arguments it
 * passed. Someone watching should be able to read every call without opening a
 * console or trusting a summary.
 *
 * It lives in a shadow root for two reasons. The page cannot restyle it, and
 * `document.querySelectorAll` does not reach inside a shadow root, so the
 * panel never turns up in a `chrome_extract` result and cannot change what a
 * tool reads back. That second one matters: a visible audit panel that altered
 * the readings would be worse than no panel.
 */

import { ACTIVITY_MESSAGE, ACTIVITY_REQUEST, type ActivityEntry } from './background/activity-log';
import { escapeHtml, highlightJson, summarise } from '@/shared/json-highlight';

const HOST_TAG = 'ygs-activity-overlay';
const MAX_ROWS = 40;

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',

  main() {
    // Frames would each draw their own panel over the same page.
    if (window.top !== window.self) return;

    let entries: ActivityEntry[] = [];
    let open = false;
    let detailId: string | null = null;
    let host: HTMLElement | null = null;
    let root: ShadowRoot | null = null;

    function mount(): ShadowRoot {
      if (root) return root;
      host = document.createElement(HOST_TAG);
      // The host sits in the page, so it stays out of the layout entirely.
      host.style.cssText =
        'all:initial;position:fixed;inset:auto 16px 16px auto;z-index:2147483647;';
      root = host.attachShadow({ mode: 'open' });
      root.appendChild(style());
      document.documentElement.appendChild(host);
      return root;
    }

    function style(): HTMLStyleElement {
      const el = document.createElement('style');
      el.textContent = CSS;
      return el;
    }

    function render(): void {
      const shadow = mount();
      let panel = shadow.querySelector('.wrap');
      if (!panel) {
        panel = document.createElement('div');
        panel.className = 'wrap';
        shadow.appendChild(panel);
      }

      if (entries.length === 0) {
        panel.innerHTML = '';
        return;
      }

      const detail = detailId ? entries.find((e) => e.id === detailId) : null;
      panel.innerHTML = detail ? detailView(detail) : listView();
      wire(panel as HTMLElement);
    }

    function listView(): string {
      const failed = entries.filter((e) => !e.ok).length;
      if (!open) {
        return `
          <button class="pill" data-act="open">
            <span class="dot"></span>
            <span class="pill-text">ygs</span>
            <span class="count">${entries.length}</span>
            ${failed ? `<span class="count bad">${failed}</span>` : ''}
          </button>`;
      }

      const rows = entries
        .slice(0, MAX_ROWS)
        .map(
          (e) => `
        <li class="row ${e.ok ? '' : 'bad'}" data-act="detail" data-id="${escapeHtml(e.id)}">
          <span class="tick"></span>
          <span class="tool">${escapeHtml(e.tool)}</span>
          <span class="args">${escapeHtml(summarise(e.args))}</span>
          <span class="ms">${e.ms}ms</span>
        </li>`,
        )
        .join('');

      return `
        <section class="card">
          <header class="bar">
            <span class="brand">ygs</span>
            <span class="sub">${entries.length} action${entries.length === 1 ? '' : 's'} on this page</span>
            <button class="x" data-act="close" title="Hide">&times;</button>
          </header>
          <ul class="rows">${rows}</ul>
          <footer class="foot">Click any action to read what was sent.</footer>
        </section>`;
    }

    function detailView(entry: ActivityEntry): string {
      let parsed: unknown = entry.result;
      try {
        parsed = JSON.parse(entry.result);
      } catch {
        // Plain text result. Show it as it is.
      }

      return `
        <section class="card wide">
          <header class="bar">
            <button class="back" data-act="back" title="Back">&larr;</button>
            <span class="brand">${escapeHtml(entry.tool)}</span>
            <span class="sub ${entry.ok ? '' : 'bad-text'}">${entry.ok ? 'ok' : 'failed'} · ${entry.ms}ms</span>
            <button class="x" data-act="close" title="Hide">&times;</button>
          </header>
          <div class="scroll">
            <div class="label">Input</div>
            <pre class="code">${highlightJson(entry.args)}</pre>
            <div class="label">Result</div>
            <pre class="code">${
              typeof parsed === 'string' ? escapeHtml(parsed) : highlightJson(parsed)
            }</pre>
          </div>
        </section>`;
    }

    function wire(panel: HTMLElement): void {
      panel.querySelectorAll('[data-act]').forEach((node) => {
        node.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          const act = (node as HTMLElement).dataset.act;
          if (act === 'open') open = true;
          else if (act === 'close') {
            open = false;
            detailId = null;
          } else if (act === 'back') detailId = null;
          else if (act === 'detail') detailId = (node as HTMLElement).dataset.id ?? null;
          render();
        });
      });
    }

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== ACTIVITY_MESSAGE || !message.entry) return;
      entries = [message.entry as ActivityEntry, ...entries].slice(0, MAX_ROWS);
      render();
    });

    // A reload empties the page but not the log, so ask for what is already there.
    chrome.runtime
      .sendMessage({ type: ACTIVITY_REQUEST })
      .then((reply) => {
        if (!reply?.entries?.length) return;
        entries = reply.entries as ActivityEntry[];
        render();
      })
      .catch(() => undefined);
  },
});

/** Tan ground, white surface, one red accent. The welcome screen's palette. */
const CSS = `
:host { all: initial; }
* { box-sizing: border-box; margin: 0; padding: 0; }
.wrap {
  font: 12px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  color: #33291c;
  display: flex; justify-content: flex-end;
}
.pill {
  display: inline-flex; align-items: center; gap: 6px;
  background: #e4d8c3; color: #33291c;
  border: 1px solid #d5c6aa; border-radius: 999px;
  padding: 5px 10px 5px 8px; cursor: pointer;
  box-shadow: 0 2px 10px rgba(51, 41, 28, .18);
  font: inherit; font-weight: 600;
}
.pill:hover { background: #eee4d3; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: #b3271e; }
.pill-text { letter-spacing: .02em; }
.count {
  background: #fff; border: 1px solid #d5c6aa; border-radius: 999px;
  padding: 0 6px; font-size: 11px; font-weight: 600;
}
.count.bad { background: #b3271e; border-color: #b3271e; color: #fff; }

.card {
  width: 380px; max-height: 60vh; display: flex; flex-direction: column;
  background: #e4d8c3; border: 1px solid #d5c6aa; border-radius: 12px;
  box-shadow: 0 10px 34px rgba(51, 41, 28, .26); overflow: hidden;
}
.card.wide { width: 520px; max-height: 70vh; }
.bar {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 10px; background: #f6f0e4; border-bottom: 1px solid #d5c6aa;
}
.brand { font-weight: 700; color: #b3271e; letter-spacing: .02em; }
.sub { color: #6d6152; font-size: 11px; flex: 1; }
.sub.bad-text { color: #b3271e; font-weight: 600; }
.x, .back {
  border: 0; background: transparent; cursor: pointer;
  color: #6d6152; font-size: 15px; line-height: 1; padding: 2px 4px; font-family: inherit;
}
.x:hover, .back:hover { color: #b3271e; }

.rows { list-style: none; overflow-y: auto; background: #fff; }
.row {
  display: grid; grid-template-columns: 8px 1fr auto; gap: 8px;
  align-items: baseline; padding: 7px 10px;
  border-bottom: 1px solid #efe7d8; cursor: pointer;
}
.row:hover { background: #faf6ee; }
.tick { width: 6px; height: 6px; border-radius: 50%; background: #4a7c4e; align-self: center; }
.row.bad .tick { background: #b3271e; }
.tool { font-weight: 600; }
.args {
  grid-column: 2; color: #6d6152; font-size: 11px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.row .tool { grid-column: 2; }
.ms { grid-column: 3; grid-row: 1; color: #8b8071; font-size: 11px; }
.foot { padding: 7px 10px; color: #6d6152; font-size: 11px; background: #f6f0e4; }

.scroll { overflow-y: auto; background: #fff; padding: 10px; }
.label {
  font-size: 10px; text-transform: uppercase; letter-spacing: .07em;
  color: #8b8071; margin: 4px 0 5px; font-weight: 700;
}
.code {
  background: #faf6ee; border: 1px solid #efe7d8; border-radius: 7px;
  padding: 9px; margin-bottom: 10px; overflow-x: auto;
  font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  white-space: pre; color: #33291c;
}
.j-key { color: #8a3f14; font-weight: 600; }
.j-str { color: #2f6f4f; }
.j-num { color: #b3271e; }
.j-bool { color: #7a4bb5; font-weight: 600; }
.j-null { color: #8b8071; font-style: italic; }
`;
