import { describe, expect, it } from 'vitest';
import { escapeHtml, highlightJson, summarise } from '../shared/json-highlight';

describe('escapeHtml', () => {
  it('neutralises every character that can start markup', () => {
    expect(escapeHtml(`<script>alert("x")&'`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;');
  });
});

describe('highlightJson', () => {
  it('marks keys, strings, numbers, booleans and null apart', () => {
    const html = highlightJson({ name: 'ada', n: 42, ok: true, missing: null });
    expect(html).toContain('j-key');
    expect(html).toContain('j-str');
    expect(html).toContain('j-num');
    expect(html).toContain('j-bool');
    expect(html).toContain('j-null');
  });

  it('escapes page text before it becomes markup', () => {
    // The panel renders arguments that came from a page the extension does not
    // control, so a heading holding markup must not be able to break out. The
    // words survive as text, which is harmless. No tag may form.
    const html = highlightJson({ heading: '</span><img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(html).not.toContain('</span><img');
    expect(html).toContain('&lt;img');

    // The real check: parsing it yields no element the payload asked for.
    const holder = document.createElement('div');
    holder.innerHTML = html;
    expect(holder.querySelector('img')).toBeNull();
    expect(holder.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('escapes a key that holds markup, not only a value', () => {
    const html = highlightJson({ '<b>k</b>': 1 });
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('returns something for a value JSON cannot take', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(highlightJson(circular)).toBeTruthy();
  });
});

describe('summarise', () => {
  it('drops the outer braces so a row reads as arguments', () => {
    expect(summarise({ query: 'rust', limit: 10 })).toBe('"query":"rust","limit":10');
  });

  it('collapses whitespace and cuts at the limit', () => {
    const out = summarise({ text: 'a'.repeat(200) }, 40);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out.endsWith('…')).toBe(true);
  });

  it('says nothing for an empty value', () => {
    expect(summarise(undefined)).toBe('');
    expect(summarise(null)).toBe('');
  });
});
