/**
 * Activity log.
 *
 * Records every tool call and sends it to the page it acted on, so the person
 * at the keyboard can watch what an agent is doing in their browser and read
 * the arguments it used.
 *
 * This is an audit surface, so it records the call whether it worked or not.
 * A failed call is often the more interesting one.
 */

export const ACTIVITY_MESSAGE = 'ygs:activity';
export const ACTIVITY_REQUEST = 'ygs:activity:list';

/** Kept small. This lives in the service worker, which Chrome stops at will. */
const MAX_PER_TAB = 40;
const MAX_TEXT = 20_000;

export interface ActivityEntry {
  id: string;
  tool: string;
  /** What the agent passed in. The point of the whole panel. */
  args: unknown;
  ok: boolean;
  /** Full result text, capped. The overlay truncates for the list view. */
  result: string;
  ms: number;
  at: number;
}

const byTab = new Map<number, ActivityEntry[]>();
let counter = 0;

function cap(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n... truncated` : text;
}

/**
 * Masks values whose key names read as secrets.
 *
 * The panel is meant to be readable over someone's shoulder and to appear in
 * screenshots, so a token pasted into a form should not be part of that. The
 * agent still sent the real value; this only changes what is drawn.
 */
function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));

  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = /pass|secret|token|apikey|api_key|credential|cookie/i.test(key)
      ? '[hidden]'
      : redact(inner, depth + 1);
  }
  return out;
}

/** Pulls the readable text out of a tool result, whatever shape it arrived in. */
function resultText(result: unknown): { ok: boolean; text: string } {
  const value = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> };
  const ok = !value?.isError;

  const text = (value?.content ?? [])
    .map((part) => (part.type === 'text' ? (part.text ?? '') : `[${part.type}]`))
    .join('\n');

  return { ok, text: cap(text || (ok ? 'done' : 'failed')) };
}

export function record(tool: string, args: unknown, result: unknown, ms: number, tabId?: number) {
  const { ok, text } = resultText(result);
  const entry: ActivityEntry = {
    id: `${Date.now()}-${counter++}`,
    tool,
    args: redact(args),
    ok,
    result: text,
    ms,
    at: Date.now(),
  };

  void deliver(entry, tabId);
}

async function deliver(entry: ActivityEntry, tabId?: number): Promise<void> {
  try {
    let target = tabId;
    if (target === undefined) {
      const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
      target = active?.id;
    }
    if (target === undefined) return;

    const list = byTab.get(target) ?? [];
    list.unshift(entry);
    if (list.length > MAX_PER_TAB) list.length = MAX_PER_TAB;
    byTab.set(target, list);

    // The tab may have no content script, on a chrome:// page for instance.
    // That is normal, so a failure here is not worth reporting.
    await chrome.tabs.sendMessage(target, { type: ACTIVITY_MESSAGE, entry }).catch(() => undefined);
  } catch {
    // Never let the audit panel break the tool it is reporting on.
  }
}

export function entriesFor(tabId: number): ActivityEntry[] {
  return byTab.get(tabId) ?? [];
}

chrome.tabs?.onRemoved?.addListener((tabId) => byTab.delete(tabId));
