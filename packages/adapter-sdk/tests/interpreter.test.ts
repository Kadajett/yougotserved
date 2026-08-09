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

describe('templated counts in an extract step', () => {
  it('resolves limit from the call arguments before the spec is sent', async () => {
    const seen: unknown[] = [];
    const page = {
      signal: new AbortController().signal,
      url: 'https://news.ycombinator.com/news',
      extract: async (spec: unknown) => {
        seen.push(spec);
        return [];
      },
    };

    await runSteps(
      page as never,
      [{ extract: { each: 'tr', limit: '{{limit}}', fields: { t: 'a' } } }] as never,
      {
        params: { limit: 5 } as never,
        trusted: false,
      },
    );

    expect((seen[0] as { limit: unknown }).limit).toBe(5);
  });

  it('fails loudly when the template names a parameter that does not exist', async () => {
    // An unknown name is an authoring mistake in the pack, so it should stop
    // the tool rather than quietly extract a different number of records.
    const page = {
      signal: new AbortController().signal,
      url: 'https://example.com',
      extract: async () => [],
    };

    await expect(
      runSteps(
        page as never,
        [{ extract: { each: 'tr', limit: '{{nope}}', fields: { t: 'a' } } }] as never,
        {
          params: {} as never,
          trusted: false,
        },
      ),
    ).rejects.toThrow(/not a parameter/);
  });

  it('drops a count that resolves to something that is not a number', async () => {
    const seen: unknown[] = [];
    const page = {
      signal: new AbortController().signal,
      url: 'https://example.com',
      extract: async (spec: unknown) => {
        seen.push(spec);
        return [];
      },
    };

    await runSteps(
      page as never,
      [{ extract: { each: 'tr', limit: '{{limit}}', fields: { t: 'a' } } }] as never,
      {
        params: { limit: 'lots' } as never,
        trusted: false,
      },
    );

    expect('limit' in (seen[0] as object)).toBe(false);
  });
});

describe('optional write steps', () => {
  it('skips a fill when the field is not on the page', async () => {
    const page = stubSession({ exists: vi.fn(async () => false) });
    await runSteps(page, [{ fill: '#phone', value: '{{phone}}', optional: true }], {
      params: { phone: '555' },
    });
    expect(page.fill).not.toHaveBeenCalled();
  });

  it('skips a fill when the caller left the parameter out', async () => {
    const page = stubSession();
    await runSteps(page, [{ fill: '#phone', value: '{{phone}}', optional: true }], { params: {} });
    expect(page.fill).not.toHaveBeenCalled();
  });

  it('still fills when both the field and the value are there', async () => {
    const page = stubSession();
    await runSteps(page, [{ fill: '#phone', value: '{{phone}}', optional: true }], {
      params: { phone: '555' },
    });
    expect(page.fill).toHaveBeenCalledWith('#phone', '555', {
      submit: undefined,
      typed: undefined,
    });
  });

  it('a required fill with a missing parameter is still an error', async () => {
    const page = stubSession();
    await expect(
      runSteps(page, [{ fill: '#phone', value: '{{phone}}' }], { params: {} }),
    ).rejects.toThrow(/not a parameter/);
  });

  it('skips an optional upload when no file was given', async () => {
    const page = stubSession();
    await runSteps(page, [{ upload: { selector: '#cv', file: '{{resume}}', optional: true } }], {
      params: {},
    });
    expect(page.upload).not.toHaveBeenCalled();
  });
});

describe('forEach', () => {
  const answerSteps: Step[] = [
    {
      forEach: '{{answers}}',
      as: 'answer',
      steps: [{ fill: '[name="{{answer.fieldName}}"]', value: '{{answer.value}}' }],
    },
  ];

  it('runs the inner steps once per entry, binding each one', async () => {
    const page = stubSession();
    await runSteps(page, answerSteps, {
      params: {
        answers: [
          { fieldName: 'urls[LinkedIn]', value: 'https://x.test' },
          { fieldName: 'why_us', value: 'because' },
        ],
      },
    });
    expect(page.fill).toHaveBeenNthCalledWith(1, '[name="urls[LinkedIn]"]', 'https://x.test', {
      submit: undefined,
      typed: undefined,
    });
    expect(page.fill).toHaveBeenNthCalledWith(2, '[name="why_us"]', 'because', {
      submit: undefined,
      typed: undefined,
    });
  });

  it('treats an absent array as nothing to do', async () => {
    const page = stubSession();
    await runSteps(page, answerSteps, { params: {} });
    expect(page.fill).not.toHaveBeenCalled();
  });

  it('refuses a value that would break out of the selector', async () => {
    const page = stubSession();
    const result = await runSteps(page, answerSteps, {
      params: { answers: [{ fieldName: 'x"], [name="password', value: 'stolen' }] },
    });
    expect(result.ok).toBe(false);
    expect(page.fill).not.toHaveBeenCalled();
  });

  it('refuses more entries than the cap, rather than trimming quietly', async () => {
    const page = stubSession();
    const answers = Array.from({ length: 101 }, (_, i) => ({ fieldName: `f${i}`, value: 'v' }));
    const result = await runSteps(page, answerSteps, { params: { answers } });
    expect(result.ok).toBe(false);
    expect(page.fill).not.toHaveBeenCalled();
  });

  it('refuses a non-array', async () => {
    const page = stubSession();
    const result = await runSteps(page, answerSteps, { params: { answers: 'nope' } });
    expect(result.ok).toBe(false);
  });

  it('cannot reach the prototype chain through a dotted reference', async () => {
    const page = stubSession();
    // Treated as an unknown reference, which is the same refusal an undeclared
    // parameter gets: it throws rather than substituting something.
    await expect(
      runSteps(
        page,
        [
          {
            forEach: '{{answers}}',
            as: 'answer',
            steps: [{ fill: '#x', value: '{{answer.constructor}}' }],
          },
        ],
        { params: { answers: [{ fieldName: 'a', value: 'b' }] } },
      ),
    ).rejects.toThrow(/not a parameter/);
    expect(page.fill).not.toHaveBeenCalled();
  });

  it('does not count the loop variable as a parameter the tool must declare', () => {
    expect([...templateRefs(answerSteps)].sort()).toEqual(['answers']);
  });

  it('rejects a forEach that does not name a parameter', () => {
    expect(() =>
      validateSteps([{ forEach: 'literal', as: 'x', steps: [{ press: 'Enter' }] }]),
    ).toThrow(/must name one parameter/);
  });

  it('rejects a nested loop that reuses a name', () => {
    expect(() =>
      validateSteps([
        {
          forEach: '{{a}}',
          as: 'row',
          steps: [{ forEach: '{{b}}', as: 'row', steps: [{ press: 'Enter' }] }],
        },
      ]),
    ).toThrow(/already binds/);
  });
});
