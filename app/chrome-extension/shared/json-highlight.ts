/**
 * JSON syntax highlighting, as HTML.
 *
 * Written by hand rather than pulled from a library. The extension ships under
 * a strict content security policy and runs inside pages we do not control, so
 * a highlighter here has to be small, dependency free, and must never build a
 * node from unescaped page text.
 */

const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/**
 * Formats a value as indented JSON and wraps each token in a span.
 *
 * Every piece of text is escaped before it becomes markup, so a page that puts
 * `</span><script>` in a heading cannot break out through the panel.
 */
export function highlightJson(value: unknown, indent = 2): string {
  let text: string;
  try {
    text = JSON.stringify(value, null, indent) ?? String(value);
  } catch {
    // Circular, or a BigInt. Showing something beats showing nothing.
    text = String(value);
  }

  // Tokenise the raw JSON, then escape each piece as it is emitted. Escaping
  // first would turn every `"` into `&quot;`, and the pattern would match
  // nothing at all.
  const token =
    /("(?:\\u[0-9a-fA-F]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?/g;

  let out = '';
  let last = 0;

  for (let match = token.exec(text); match !== null; match = token.exec(text)) {
    out += escapeHtml(text.slice(last, match.index));

    const [whole, str, colon, word] = match;
    let cls = 'num';
    if (str !== undefined) cls = colon ? 'key' : 'str';
    else if (word === 'null') cls = 'null';
    else if (word !== undefined) cls = 'bool';

    out += `<span class="j-${cls}">${escapeHtml(whole)}</span>`;
    last = match.index + whole.length;
  }

  return out + escapeHtml(text.slice(last));
}

/** One short line describing a value, for the collapsed row. */
export function summarise(value: unknown, limit = 72): string {
  if (value === null || value === undefined) return '';
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
  text = (text ?? '').replace(/\s+/g, ' ').trim();
  if (text.startsWith('{') && text.endsWith('}')) text = text.slice(1, -1).trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
