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
import {
  MAX_FOREACH,
  renderOptional,
  renderTemplate,
  validateSteps,
  type RenderOptions,
  type Step,
  type Template,
} from './steps.js';
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
 * What a caller's value may contain once it is part of a selector.
 *
 * Form field names look like `urls[LinkedIn]` or `answers_0_text`, so the set
 * has to cover those. It must not cover quotes, parentheses, commas, `>` or
 * whitespace, because those are how a value stops being a value and starts
 * being more selector. A pack writes `[name="{{answer.fieldName}}"]` and this
 * is what keeps the caller inside those quotes.
 *
 * Checked here rather than left to pack authors. An author who forgets is the
 * likeliest way this goes wrong, and the person at risk did not write the pack.
 */
const SELECTOR_SAFE = /^[A-Za-z0-9_[\].:-]+$/;

const guard: RenderOptions = {
  check(value, reference) {
    if (!SELECTOR_SAFE.test(value)) {
      throw new AdapterFailure(
        'invalid_input',
        `"${reference}" is not usable in a selector: ${JSON.stringify(value)}.`,
        { hint: 'Letters, digits, and _ [ ] . : - only.' },
      );
    }
  },
};

/**
 * Reads the array a `forEach` names.
 *
 * An absent parameter is an empty list, because an optional array of answers
 * and an empty one mean the same thing to a form. Anything present that is not
 * an array is a caller mistake and says so.
 */
function resolveList(template: Template, scope: Record<string, unknown>): readonly unknown[] {
  const name = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/.exec(template)?.[1];
  const value = name ? scope[name] : undefined;

  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new AdapterFailure('invalid_input', `Parameter "${name}" must be an array to loop over.`);
  }
  if (value.length > MAX_FOREACH) {
    throw new AdapterFailure(
      'invalid_input',
      `"${name}" has ${value.length} entries; the limit is ${MAX_FOREACH}.`,
      { hint: `Send them in batches of ${MAX_FOREACH} or fewer.` },
    );
  }
  return value;
}

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

  const execute = async (list: readonly Step[], scope: Record<string, unknown>): Promise<void> => {
    const render = (template: Template): string => renderTemplate(template, scope);
    /** Selector positions. Anything substituted in has to survive SELECTOR_SAFE. */
    const sel = (template: Template): string => renderTemplate(template, scope, guard);
    const optionalSel = (template: Template): string | null =>
      renderOptional(template, scope, guard);
    const optionalValue = (template: Template): string | null => renderOptional(template, scope);

    const renderWait = (target: WaitTarget | undefined): WaitTarget | undefined => {
      if (!target) return undefined;
      if ('selector' in target) return { ...target, selector: sel(target.selector) };
      if ('selectorGone' in target) return { selectorGone: sel(target.selectorGone) };
      // `url` may be a RegExp, which carries no template and is passed through.
      if ('url' in target && typeof target.url === 'string') return { url: render(target.url) };
      return target;
    };

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
        // `optional` exists because sites show cookie banners and interstitials
        // that may or may not be there; without it every pack would need a
        // branch the language deliberately does not have.
        const selector = step.optional ? optionalSel(step.click) : sel(step.click);
        if (selector === null) continue;
        if (step.optional && !(await page.exists(selector))) continue;
        await page.click(selector, { until: renderWait(step.until) });
      } else if ('fill' in step) {
        const selector = step.optional ? optionalSel(step.fill) : sel(step.fill);
        const value = step.optional ? optionalValue(step.value) : render(step.value);
        if (selector === null || value === null) continue;
        if (step.optional && !(await page.exists(selector))) continue;
        await page.fill(selector, value, { submit: step.submit, typed: step.typed });
      } else if ('select' in step) {
        const selector = step.optional ? optionalSel(step.select) : sel(step.select);
        const value = step.optional ? optionalValue(step.value) : render(step.value);
        if (selector === null || value === null) continue;
        if (step.optional && !(await page.exists(selector))) continue;
        await page.select(selector, value);
      } else if ('press' in step) {
        await page.press(render(step.press));
      } else if ('scroll' in step) {
        await page.scroll({
          selector: step.scroll.selector ? sel(step.scroll.selector) : undefined,
          by: step.scroll.by,
          toBottom: step.scroll.toBottom,
        });
      } else if ('upload' in step) {
        await runUpload(page, step.upload, scope, sel, renderWait);
      } else if ('extract' in step) {
        const value = (await page.extract(resolveCounts(step.extract, render) as never)) as
          ExtractedRecord | ExtractedRecord[];
        last = value;
        if (step.as) named[step.as] = value;
        else sawUnnamedExtract = true;
      } else if ('assert' in step) {
        await runAssert(page, step.assert, sel, render);
      } else if ('repeat' in step) {
        const { times, while: condition, steps: inner } = step.repeat;
        for (let iteration = 0; iteration < times; iteration++) {
          if (condition && !(await page.exists(sel(condition.selector)))) break;
          await execute(inner, scope);
        }
      } else if ('forEach' in step) {
        for (const entry of resolveList(step.forEach, scope)) {
          await execute(step.steps, { ...scope, [step.as]: entry });
        }
      }
    }
  };

  try {
    await execute(steps, options.params);
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
  sel: (template: Template) => string,
  render: (template: Template) => string,
): Promise<void> {
  let failed = false;

  if (assertion.selector && !(await page.exists(sel(assertion.selector)))) failed = true;
  if (assertion.absent && (await page.exists(sel(assertion.absent)))) failed = true;
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
  sel: (template: Template) => string,
  renderWait: (target: WaitTarget | undefined) => WaitTarget | undefined,
): Promise<void> {
  const target = sel(spec.mode === 'picker' ? spec.trigger! : spec.selector!);
  // An optional upload with no file is a posting that does not ask for one.
  // Checked before the file resolves, because resolving is what would throw.
  if (spec.optional && !(await page.exists(target))) return;

  const file = resolveFileParam(spec.file, params, spec.optional);
  if (!file) return;

  const options = { until: renderWait(spec.until) };
  if (spec.mode === 'picker') await page.uploadViaPicker(target, file, options);
  else await page.upload(target, file, options);
}

/**
 * A pack may only upload a file it was *given*.
 *
 * `file` must be a bare `{{param}}` reference resolving to a file argument.
 * A literal path in a pack would let a published adapter name a file on the
 * installer's disk, which is the one thing an upload capability must never
 * allow. The host still classifies whatever path comes back.
 */
/**
 * Turns `limit: "{{limit}}"` into a number, using the call's arguments.
 *
 * Only `limit` and `offset` are resolved. Selectors stay verbatim, so a caller
 * can never inject one through a parameter.
 */
function resolveCounts(spec: unknown, render: (value: string) => string): unknown {
  const source = spec as { limit?: unknown; offset?: unknown };
  if (typeof source?.limit !== 'string' && typeof source?.offset !== 'string') return spec;

  const resolved = { ...(source as Record<string, unknown>) };
  for (const key of ['limit', 'offset'] as const) {
    const raw = resolved[key];
    if (typeof raw !== 'string') continue;
    const parsed = Number(render(raw).trim());
    if (Number.isFinite(parsed)) resolved[key] = Math.trunc(parsed);
    else delete resolved[key];
  }
  return resolved;
}

function resolveFileParam(
  template: Template,
  params: Record<string, unknown>,
  optional?: boolean,
): FileRef | null {
  const match = /^\s*\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}\s*$/.exec(template);
  if (!match?.[1]) {
    throw new AdapterFailure(
      'refused',
      `An upload step must name a file parameter, like "{{resume}}". Got ${JSON.stringify(template)}.`,
      { hint: 'A published adapter cannot choose a path on your disk.' },
    );
  }

  const value = params[match[1]];
  if (optional && (value === undefined || value === null)) return null;
  if (!value || typeof value !== 'object') {
    throw new AdapterFailure('invalid_input', `Parameter "${match[1]}" is not a file.`);
  }
  return normaliseFileRef(value as FileRef);
}
