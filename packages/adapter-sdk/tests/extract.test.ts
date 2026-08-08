import { beforeEach, describe, expect, it } from 'vitest';
import { runExtractSpec, validateExtractSpec } from '../src/extract.js';

function mount(html: string): Element {
  document.body.innerHTML = html;
  return document.body;
}

const RESULTS = `
  <ul>
    <li class="result" data-urn="urn:li:person:1">
      <a class="link" href="/in/ada"><span aria-hidden="true">Ada Lovelace</span></a>
      <div class="subtitle">  Analytical Engine
         Programmer </div>
      <span class="followers">1,234 followers</span>
      <span class="badge">Open to work</span>
    </li>
    <li class="result" data-urn="urn:li:person:2">
      <a class="link" href="/in/grace"><span aria-hidden="true">Grace Hopper</span></a>
      <div class="subtitle">Compiler Author</div>
      <span class="followers">987 followers</span>
    </li>
  </ul>
`;

describe('runExtractSpec', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('returns one record per match, with only the fields asked for', () => {
    const root = mount(RESULTS);
    const records = runExtractSpec(
      {
        each: 'li.result',
        fields: {
          name: 'span[aria-hidden="true"]',
          headline: '.subtitle',
        },
      },
      root,
    );

    expect(records).toEqual([
      { name: 'Ada Lovelace', headline: 'Analytical Engine Programmer' },
      { name: 'Grace Hopper', headline: 'Compiler Author' },
    ]);
  });

  it('resolves href through the property, not the raw attribute', () => {
    const root = mount(RESULTS);
    const records = runExtractSpec(
      {
        each: 'li.result',
        fields: {
          profileUrl: { selector: 'a.link', prop: 'href' },
          relative: { selector: 'a.link', attr: 'href' },
        },
      },
      root,
    ) as Record<string, unknown>[];

    expect(records[0]?.profileUrl).toBe('https://www.linkedin.com/in/ada');
    expect(records[0]?.relative).toBe('/in/ada');
  });

  it('reads attributes off the record root when no selector is given', () => {
    const root = mount(RESULTS);
    const records = runExtractSpec(
      { each: 'li.result', fields: { urn: { attr: 'data-urn' } } },
      root,
    );
    expect(records).toEqual([{ urn: 'urn:li:person:1' }, { urn: 'urn:li:person:2' }]);
  });

  it.each([
    ['1,234 followers', 1234],
    ['1234 followers', 1234],
    ['1\u00a0234 followers', 1234],
    ['1 234 followers', 1234],
  ])('parses %s as a number', (text, expected) => {
    const root = mount(`<div class="n">${text}</div>`);
    expect(runExtractSpec({ fields: { n: { selector: '.n', number: true } } }, root)).toEqual({
      n: expected,
    });
  });

  it('parses numbers out of prose', () => {
    const root = mount(RESULTS);
    const records = runExtractSpec(
      { each: 'li.result', fields: { followers: { selector: '.followers', number: true } } },
      root,
    );
    expect(records).toEqual([{ followers: 1234 }, { followers: 987 }]);
  });

  it('turns a missing element into null, or a stated fallback', () => {
    const root = mount(RESULTS);
    const records = runExtractSpec(
      {
        each: 'li.result',
        fields: {
          badge: '.badge',
          note: { selector: '.note', fallback: '' },
        },
      },
      root,
    );
    expect(records).toEqual([
      { badge: 'Open to work', note: '' },
      { badge: null, note: '' },
    ]);
  });

  it('reports presence as a boolean', () => {
    const root = mount(RESULTS);
    const records = runExtractSpec(
      { each: 'li.result', fields: { openToWork: { selector: '.badge', exists: true } } },
      root,
    );
    expect(records).toEqual([{ openToWork: true }, { openToWork: false }]);
  });

  it('honours limit and offset so a long feed cannot flood the context', () => {
    const root = mount(RESULTS);
    expect(
      runExtractSpec({ each: 'li.result', limit: 1, fields: { name: '.link' } }, root),
    ).toEqual([{ name: 'Ada Lovelace' }]);
    expect(
      runExtractSpec({ each: 'li.result', offset: 1, fields: { name: '.link' } }, root),
    ).toEqual([{ name: 'Grace Hopper' }]);
  });

  it('collects every match when asked', () => {
    const root = mount(RESULTS);
    const record = runExtractSpec({ fields: { names: { selector: '.link', all: true } } }, root);
    expect(record).toEqual({ names: ['Ada Lovelace', 'Grace Hopper'] });
  });

  it('pulls a capture group out of a value', () => {
    const root = mount(RESULTS);
    const records = runExtractSpec(
      {
        each: 'li.result',
        fields: { slug: { attr: 'data-urn', regex: 'urn:li:person:(\\d+)' } },
      },
      root,
    );
    expect(records).toEqual([{ slug: '1' }, { slug: '2' }]);
  });

  it('nests records', () => {
    const root = mount(RESULTS);
    const records = runExtractSpec(
      {
        each: 'li.result',
        fields: {
          person: {
            selector: 'a.link',
            fields: { name: 'span', url: { prop: 'href' } },
          },
        },
      },
      root,
    ) as Record<string, Record<string, unknown>>[];

    expect(records[0]?.person).toEqual({
      name: 'Ada Lovelace',
      url: 'https://www.linkedin.com/in/ada',
    });
  });

  it('returns a single record when there is no "each"', () => {
    const root = mount('<h1 class="title">Search results</h1>');
    expect(runExtractSpec({ fields: { title: '.title' } }, root)).toEqual({
      title: 'Search results',
    });
  });

  it('returns an empty list rather than failing when nothing matches', () => {
    const root = mount(RESULTS);
    expect(runExtractSpec({ each: '.nothing', fields: { name: 'span' } }, root)).toEqual([]);
  });

  it('explains an invalid selector instead of throwing a DOM error', () => {
    const root = mount(RESULTS);
    // The name, not the class. The runner is injected into the page, where the
    // class does not exist, so `instanceof` can never hold for a real failure.
    expect(() => runExtractSpec({ fields: { bad: '::::' } }, root)).toThrow(/is not valid CSS/);
    try {
      runExtractSpec({ fields: { bad: '::::' } }, root);
    } catch (error) {
      expect((error as Error).name).toBe('ExtractError');
    }
  });
});

describe('validateExtractSpec', () => {
  it('accepts a well-formed spec', () => {
    expect(() =>
      validateExtractSpec({ each: 'li', limit: 5, fields: { name: 'span' } }),
    ).not.toThrow();
  });

  it('rejects an empty field set, which would silently return nothing', () => {
    expect(() => validateExtractSpec({ fields: {} })).toThrow(/nothing to extract/);
  });

  it('rejects a spec that sets both attr and prop', () => {
    expect(() => validateExtractSpec({ fields: { url: { attr: 'href', prop: 'href' } } })).toThrow(
      /pick one/,
    );
  });

  it('rejects a malformed regex at load time', () => {
    expect(() => validateExtractSpec({ fields: { id: { regex: '([' } } })).toThrow(
      /not a valid expression/,
    );
  });

  it('rejects a nonsense limit', () => {
    expect(() => validateExtractSpec({ limit: 0, fields: { name: 'span' } })).toThrow(/limit/);
  });
});

describe('runExtractSpec is self-contained', () => {
  it('still works after a round trip through toString', () => {
    // What `chrome.scripting.executeScript({ func })` does: it sends the source
    // and drops the closure. If a helper ever moves back to module scope, this
    // test fails here rather than in a page, where the error is hard to read.
    const rebuilt = new Function(
      `return (${runExtractSpec.toString()})`,
    )() as typeof runExtractSpec;
    const root = mount(RESULTS);

    expect(rebuilt({ each: 'li', fields: { name: '.name' } }, root)).toEqual(
      runExtractSpec({ each: 'li', fields: { name: '.name' } }, root),
    );
    expect(() => rebuilt({ fields: { bad: '::::' } }, root)).toThrow(/is not valid CSS/);
  });
});

describe('fields scoped to the next sibling', () => {
  // Hacker News splits one story across two rows: the title sits in tr.athing
  // and the score in the row after it. Without `from: "next"` a record can hold
  // one or the other, never both.
  const PAIRED = `
    <table><tbody>
      <tr class="athing" id="1"><td class="title"><span class="titleline"><a href="/a">Story A</a></span></td></tr>
      <tr><td class="subtext"><span class="score">399 points</span> by <a class="hnuser">ada</a></td></tr>
      <tr class="athing" id="2"><td class="title"><span class="titleline"><a href="/b">Story B</a></span></td></tr>
      <tr><td class="subtext"><span class="score">12 points</span> by <a class="hnuser">grace</a></td></tr>
    </tbody></table>`;

  it('reads a field out of the row after the record root', () => {
    const root = mount(PAIRED);
    expect(
      runExtractSpec(
        {
          each: 'tr.athing',
          fields: {
            title: '.titleline > a',
            score: { selector: '.score', number: true, from: 'next' },
            by: { selector: '.hnuser', from: 'next' },
          },
        },
        root,
      ),
    ).toEqual([
      { title: 'Story A', score: 399, by: 'ada' },
      { title: 'Story B', score: 12, by: 'grace' },
    ]);
  });

  it('falls back rather than throwing when there is no sibling', () => {
    const root = mount('<div><p class="only">x</p></div>');
    expect(
      runExtractSpec(
        { each: '.only', fields: { after: { selector: '.score', from: 'next', fallback: null } } },
        root,
      ),
    ).toEqual([{ after: null }]);
  });

  it('takes the sibling itself when no selector is given', () => {
    const root = mount(PAIRED);
    const records = runExtractSpec(
      { each: 'tr.athing', limit: 1, fields: { row: { from: 'next' } } },
      root,
    ) as Record<string, unknown>[];
    expect(String(records[0]?.row)).toContain('399 points');
  });

  it('rejects a from value the interpreter does not have', () => {
    expect(() =>
      validateExtractSpec({ fields: { x: { selector: 'a', from: 'previous' as never } } }),
    ).toThrow(/must be "self" or "next"/);
  });
});

describe('counts that arrive as strings', () => {
  // The host resolves `"{{limit}}"` before the spec is sent, but the runner is
  // also injected straight into a page, so it re-checks rather than trusting.
  it('reads a numeric string as a count', () => {
    const root = mount(RESULTS);
    expect(
      runExtractSpec({ each: 'li.result', limit: '1', fields: { name: '.link' } }, root),
    ).toEqual([{ name: 'Ada Lovelace' }]);
  });

  it('falls back to the cap when a count is not readable as a number', () => {
    const root = mount(RESULTS);
    expect(
      runExtractSpec({ each: 'li.result', limit: '{{limit}}', fields: { name: '.link' } }, root),
    ).toHaveLength(2);
  });
});
