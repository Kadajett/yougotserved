import { describe, expect, it, vi } from 'vitest';
import { runSteps } from '../src/interpreter.js';
import { renderTemplate, templateRefs, validateSteps, StepError, type Step } from '../src/steps.js';
import type { BrowserSession } from '../src/session.js';

function stubSession(overrides: Partial<BrowserSession> = {}): BrowserSession {
  return {
    url: 'https://www.linkedin.com/feed/',
    title: 'Feed',
    signal: new AbortController().signal,
    goto: vi.fn(async () => {}),
    waitFor: vi.fn(async () => {}),
    extract: vi.fn(async () => [{ name: 'Ada' }]) as unknown as BrowserSession['extract'],
    text: vi.fn(async () => null),
    exists: vi.fn(async () => true),
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

describe('renderTemplate', () => {
  it('substitutes parameters', () => {
    expect(renderTemplate('/search?q={{query}}', { query: 'rust' })).toBe('/search?q=rust');
  });

  it('percent-encodes with the url filter', () => {
    expect(renderTemplate('?q={{query|url}}', { query: 'rust engineer & co' })).toBe(
      '?q=rust%20engineer%20%26%20co',
    );
  });

  it('throws on an unknown parameter instead of rendering undefined into a URL', () => {
    expect(() => renderTemplate('/x?q={{nope}}', { query: 'a' })).toThrow(/not a parameter/);
  });

  it('has no expression syntax', () => {
    // A template can substitute, never compute. This must stay literal.
    expect(renderTemplate('{{ query }}-{{query}}', { query: '1+1' })).toBe('1+1-1+1');
  });

  it('collects every referenced parameter', () => {
    const steps: Step[] = [
      { goto: '/s?q={{query|url}}&p={{page}}' },
      { extract: { fields: { a: '.x' } } },
    ];
    expect([...templateRefs(steps)].sort()).toEqual(['page', 'query']);
  });
});

describe('validateSteps', () => {
  it('accepts a well-formed tree', () => {
    expect(() =>
      validateSteps([{ goto: '/x' }, { extract: { each: 'li', fields: { a: '.x' } } }]),
    ).not.toThrow();
  });

  it('rejects a step that does two things', () => {
    expect(() => validateSteps([{ goto: '/x', click: '.y' } as unknown as Step])).toThrow(
      /a step does one thing/,
    );
  });

  it('rejects an unknown step', () => {
    expect(() => validateSteps([{ exec: 'rm -rf /' } as unknown as Step])).toThrow(
      /not a known step/,
    );
  });

  it('bounds repeat, so a shared pack cannot spin forever', () => {
    expect(() => validateSteps([{ repeat: { times: 5000, steps: [{ press: 'End' }] } }])).toThrow(
      /1 to 50/,
    );
  });

  it('requires an assert to state a condition and a message', () => {
    expect(() =>
      validateSteps([{ assert: { code: 'failed', message: '' } } as unknown as Step]),
    ).toThrow(/needs selector, absent, or urlContains/);
  });

  it('requires the right target for the upload mode', () => {
    expect(() =>
      validateSteps([{ upload: { file: '{{cv}}', mode: 'picker' } } as unknown as Step]),
    ).toThrow(/needs a trigger/);
  });
});

describe('runSteps', () => {
  it('runs a search and returns the extraction', async () => {
    const page = stubSession();
    const result = await runSteps(
      page,
      [
        { goto: 'https://www.linkedin.com/search/?q={{query|url}}', until: { selector: 'main' } },
        { extract: { each: 'li', fields: { name: '.n' } } },
      ],
      { params: { query: 'rust dev' } },
    );

    expect(result).toEqual({ ok: true, data: [{ name: 'Ada' }] });
    expect(page.goto).toHaveBeenCalledWith('https://www.linkedin.com/search/?q=rust%20dev', {
      until: { selector: 'main' },
      newTab: undefined,
    });
  });

  it('collects named extracts into an object', async () => {
    const result = await runSteps(
      stubSession(),
      [
        { extract: { fields: { a: '.a' } }, as: 'header' },
        { extract: { each: 'li', fields: { b: '.b' } }, as: 'rows' },
      ],
      { params: {} },
    );
    expect(result).toMatchObject({
      ok: true,
      data: { header: [{ name: 'Ada' }], rows: [{ name: 'Ada' }] },
    });
  });

  it('skips an optional click when the element is absent', async () => {
    const page = stubSession({ exists: vi.fn(async () => false) });
    await runSteps(page, [{ click: '.cookie-banner', optional: true }, { press: 'Enter' }], {
      params: {},
    });
    expect(page.click).not.toHaveBeenCalled();
    expect(page.press).toHaveBeenCalledWith('Enter');
  });

  it('turns a failed assert into a typed error, not an empty result', async () => {
    const page = stubSession({ exists: vi.fn(async () => false) });
    const result = await runSteps(
      page,
      [
        {
          assert: {
            selector: 'main [role="listitem"]',
            code: 'not_authenticated',
            message: 'LinkedIn showed the signed-out page.',
            hint: 'Sign in, then retry.',
          },
        },
      ],
      { params: {} },
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: 'not_authenticated',
        message: 'LinkedIn showed the signed-out page.',
        hint: 'Sign in, then retry.',
        url: 'https://www.linkedin.com/feed/',
      },
    });
  });

  it('stops a while-guarded repeat once the condition fails', async () => {
    let remaining = 2;
    const page = stubSession({
      exists: vi.fn(async () => remaining-- > 0),
    });
    await runSteps(
      page,
      [{ repeat: { times: 10, while: { selector: '.more' }, steps: [{ click: '.more' }] } }],
      { params: {} },
    );
    expect(page.click).toHaveBeenCalledTimes(2);
  });

  it('uploads only a file it was handed as a parameter', async () => {
    const page = stubSession();
    await runSteps(page, [{ upload: { selector: 'input[type=file]', file: '{{resume}}' } }], {
      params: { resume: { path: '/home/ada/Documents/cv.pdf' } },
    });
    expect(page.upload).toHaveBeenCalledWith(
      'input[type=file]',
      expect.objectContaining({ path: '/home/ada/Documents/cv.pdf', filename: 'cv.pdf' }),
      expect.anything(),
    );
  });

  it('refuses an upload step that names a literal path', async () => {
    // The attack this blocks: a published pack hard-coding a path on the
    // installer's disk and posting it to the author's own site.
    const page = stubSession();
    const result = await runSteps(
      page,
      [{ upload: { selector: 'input', file: '/home/ada/.ssh/id_ed25519' } }],
      { params: {} },
    );
    expect(result).toMatchObject({ ok: false, error: { code: 'refused' } });
    expect(page.upload).not.toHaveBeenCalled();
  });

  it('re-validates untrusted trees by default', async () => {
    const result = runSteps(stubSession(), [{ exec: 'whoami' } as unknown as Step], { params: {} });
    await expect(result).rejects.toThrow(StepError);
  });

  it('stops when the call is cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const page = stubSession({ signal: controller.signal });
    const result = await runSteps(page, [{ goto: '/x' }], { params: {} });
    expect(result).toMatchObject({ ok: false, error: { code: 'timeout' } });
    expect(page.goto).not.toHaveBeenCalled();
  });
});
