/**
 * The step interpreter.
 *
 * This is the only thing that ever runs a published adapter. It takes data —
 * a validated step tree — and calls `BrowserSession` methods. There is no
 * `eval`, no `Function`, no dynamic property access driven by pack content, and
 * no way for a pack to reach anything outside the session it was handed.
 *
 * Read this file when you want to know exactly what an installed adapter can
 * do to you. It is deliberately short enough to read in one sitting.
 */

import { AdapterFailure, type AdapterResult, ok } from './result.js';
import { renderTemplate, validateSteps, type Step, type Template } from './steps.js';
import type { BrowserSession, WaitTarget } from './session.js';
import type { ExtractedRecord } from './extract.js';
import { normaliseFileRef, type FileRef } from './files.js';

export interface RunStepsOptions {
  /** Validated tool arguments, used for `{{template}}` substitution. */
  params: Record<string, unknown>;
  /** Already-validated trees skip the re-check. Anything from a registry does not. */
  trusted?: boolean;
}

type Results = Record<string, unknown>;

/**
 * Runs a step tree and returns whatever it extracted.
 *
 * A tree with one unnamed `extract` returns that value directly, which is the
 * common case. Named extracts (`as`) collect into an object.
 */
export async function runSteps(
  page: BrowserSession,
  steps: readonly Step[],
  options: RunStepsOptions,
): Promise<AdapterResult<unknown>> {
  if (!options.trusted) validateSteps(steps);

  const named: Results = {};
  let last: unknown;
  let sawUnnamedExtract = false;

  const render = (template: Template): string => renderTemplate(template, options.params);

  const renderWait = (target: WaitTarget | undefined): WaitTarget | undefined => {
    if (!target) return undefined;
    if ('selector' in target) return { ...target, selector: render(target.selector) };
    if ('selectorGone' in target) return { selectorGone: render(target.selectorGone) };
    // `url` may be a RegExp, which carries no template and is passed through.
    if ('url' in target && typeof target.url === 'string') return { url: render(target.url) };
    return target;
  };

  const execute = async (list: readonly Step[]): Promise<void> => {
    for (const step of list) {
      if (page.signal.aborted) {
        throw new AdapterFailure('timeout', 'The call was cancelled.');
      }

      if ('goto' in step) {
        await page.goto(render(step.goto), {
          until: renderWait(step.until),
          newTab: step.newTab,
        });
      } else if ('waitFor' in step) {
        await page.waitFor(renderWait(step.waitFor)!);
      } else if ('click' in step) {
        const selector = render(step.click);
        // `optional` exists because sites show cookie banners and interstitials
        // that may or may not be there; without it every pack would need a
        // branch the language deliberately does not have.
        if (step.optional && !(await page.exists(selector))) continue;
        await page.click(selector, { until: renderWait(step.until) });
      } else if ('fill' in step) {
        await page.fill(render(step.fill), render(step.value), {
          submit: step.submit,
          typed: step.typed,
        });
      } else if ('select' in step) {
        await page.select(render(step.select), render(step.value));
      } else if ('press' in step) {
        await page.press(render(step.press));
      } else if ('scroll' in step) {
        await page.scroll({
          selector: step.scroll.selector ? render(step.scroll.selector) : undefined,
          by: step.scroll.by,
          toBottom: step.scroll.toBottom,
        });
      } else if ('upload' in step) {
        await runUpload(page, step.upload, options.params, render, renderWait);
      } else if ('extract' in step) {
        const value = (await page.extract(step.extract as never)) as
          ExtractedRecord | ExtractedRecord[];
        last = value;
        if (step.as) named[step.as] = value;
        else sawUnnamedExtract = true;
      } else if ('assert' in step) {
        await runAssert(page, step.assert, render);
      } else if ('repeat' in step) {
        const { times, while: condition, steps: inner } = step.repeat;
        for (let iteration = 0; iteration < times; iteration++) {
          if (condition && !(await page.exists(render(condition.selector)))) break;
          await execute(inner);
        }
      }
    }
  };

  try {
    await execute(steps);
  } catch (error) {
    if (error instanceof AdapterFailure) return error.toResult();
    throw error;
  }

  if (Object.keys(named).length > 0 && !sawUnnamedExtract) return ok(named);
  return ok(last ?? null);
}

async function runAssert(
  page: BrowserSession,
  assertion: Extract<Step, { assert: unknown }>['assert'],
  render: (template: Template) => string,
): Promise<void> {
  let failed = false;

  if (assertion.selector && !(await page.exists(render(assertion.selector)))) failed = true;
  if (assertion.absent && (await page.exists(render(assertion.absent)))) failed = true;
  if (assertion.urlContains && !page.url.includes(render(assertion.urlContains))) failed = true;

  if (failed) {
    throw new AdapterFailure(assertion.code, assertion.message, {
      hint: assertion.hint,
      url: page.url,
    });
  }
}

async function runUpload(
  page: BrowserSession,
  spec: Extract<Step, { upload: unknown }>['upload'],
  params: Record<string, unknown>,
  render: (template: Template) => string,
  renderWait: (target: WaitTarget | undefined) => WaitTarget | undefined,
): Promise<void> {
  const file = resolveFileParam(spec.file, params);
  const options = { until: renderWait(spec.until) };

  if (spec.mode === 'picker') {
    await page.uploadViaPicker(render(spec.trigger!), file, options);
  } else {
    await page.upload(render(spec.selector!), file, options);
  }
}

/**
 * A pack may only upload a file it was *given*.
 *
 * `file` must be a bare `{{param}}` reference resolving to a file argument.
 * A literal path in a pack would let a published adapter name a file on the
 * installer's disk, which is the one thing an upload capability must never
 * allow. The host still classifies whatever path comes back.
 */
function resolveFileParam(template: Template, params: Record<string, unknown>): FileRef {
  const match = /^\s*\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}\s*$/.exec(template);
  if (!match?.[1]) {
    throw new AdapterFailure(
      'refused',
      `An upload step must name a file parameter, like "{{resume}}". Got ${JSON.stringify(template)}.`,
      { hint: 'A published adapter cannot choose a path on your disk.' },
    );
  }

  const value = params[match[1]];
  if (!value || typeof value !== 'object') {
    throw new AdapterFailure('invalid_input', `Parameter "${match[1]}" is not a file.`);
  }
  return normaliseFileRef(value as FileRef);
}
