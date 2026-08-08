/**
 * The declarative step language.
 *
 * This is the publishable tier. A tool written as steps is *data* — it
 * serialises to JSON, hashes, signs, and is interpreted locally by a fixed
 * engine that never evaluates anything the author wrote. That is what makes it
 * safe to install a stranger's adapter, and it is also what keeps the project
 * inside Chrome Web Store policy, which prohibits remotely-hosted code.
 *
 * JS handlers (`defineTool`) remain available and are strictly more powerful,
 * but they are local-only and the pack compiler refuses to publish them.
 *
 * The language is deliberately small. Every construct here has to be
 * reviewable by someone reading a pack in a browser tab, so there is no
 * expression evaluator, no user-supplied predicates, and no escape hatch.
 */

import type { ExtractSpec } from './extract.js';
import type { AdapterErrorCode } from './result.js';
import type { WaitTarget } from './session.js';

/**
 * A string that may reference parameters: `"/search?q={{query}}"`.
 *
 * `{{name}}` inserts the value. `{{name|url}}` percent-encodes it first, which
 * is what you want in a query string and is easy to forget. There is no
 * expression syntax on purpose: a template cannot compute, only substitute.
 */
export type Template = string;

export type Step =
  | { goto: Template; until?: WaitTarget; newTab?: boolean }
  | { waitFor: WaitTarget }
  | { click: Template; until?: WaitTarget; optional?: boolean }
  | { fill: Template; value: Template; submit?: boolean; typed?: boolean }
  | { select: Template; value: Template }
  | { press: Template }
  | { scroll: { selector?: Template; by?: number; toBottom?: boolean } }
  | {
      upload: {
        selector?: Template;
        trigger?: Template;
        /** Parameter holding the file, e.g. `"{{resume}}"`. */
        file: Template;
        mode?: 'input' | 'picker';
        until?: WaitTarget;
      };
    }
  /** Reads data. `as` names it in the result; omitted means it is the result. */
  | { extract: ExtractSpec; as?: string }
  /**
   * Fails with a typed error unless the page looks right.
   *
   * This is how a pack reports "you are signed out" or "the markup moved"
   * rather than returning an empty list that an agent reads as "no results".
   */
  | {
      assert: {
        selector?: Template;
        absent?: Template;
        urlContains?: Template;
        code: AdapterErrorCode;
        message: string;
        hint?: string;
      };
    }
  /**
   * A bounded loop, for pagination and lazy-loaded feeds.
   *
   * `times` is required and capped: an unbounded loop in a shared pack is a
   * denial-of-service against the person who installed it.
   */
  | { repeat: { times: number; while?: { selector: Template }; steps: Step[] } };

export const MAX_REPEAT = 50;
export const MAX_STEPS = 200;

export class StepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepError';
  }
}

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

const TEMPLATE_PATTERN = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(\|\s*(url|json))?\s*\}\}/g;

/**
 * Substitutes parameters into a template.
 *
 * A missing parameter throws rather than rendering "undefined" into a URL and
 * navigating somewhere unintended.
 */
export function renderTemplate(template: Template, params: Record<string, unknown>): string {
  return template.replace(TEMPLATE_PATTERN, (_match, name: string, _pipe, filter?: string) => {
    if (!(name in params)) {
      throw new StepError(`Template references "{{${name}}}", which is not a parameter.`);
    }
    const value = params[name];
    if (value === undefined || value === null) return '';
    if (filter === 'json') return JSON.stringify(value);
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return filter === 'url' ? encodeURIComponent(text) : text;
  });
}

/** Every parameter a step tree references, for validation at build time. */
export function templateRefs(steps: readonly Step[]): Set<string> {
  const found = new Set<string>();
  const scan = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(TEMPLATE_PATTERN)) {
        if (match[1]) found.add(match[1]);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(scan);
      return;
    }
    if (value && typeof value === 'object') {
      Object.values(value).forEach(scan);
    }
  };
  scan(steps);
  return found;
}

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

const STEP_KEYS = [
  'goto',
  'waitFor',
  'click',
  'fill',
  'select',
  'press',
  'scroll',
  'upload',
  'extract',
  'assert',
  'repeat',
] as const;

/**
 * Rejects a malformed step tree before it is published or run.
 *
 * Called at build time so a broken pack fails with a path, and again at load
 * time because a pack arriving from a registry is untrusted input no matter
 * what it claimed when it was built.
 */
export function validateSteps(steps: readonly Step[], path = 'steps'): void {
  if (!Array.isArray(steps)) throw new StepError(`${path} must be an array.`);
  if (steps.length === 0) throw new StepError(`${path} is empty.`);

  let total = 0;
  const walk = (list: readonly Step[], where: string): void => {
    for (const [index, step] of list.entries()) {
      const at = `${where}[${index}]`;
      if (!step || typeof step !== 'object') throw new StepError(`${at} must be an object.`);

      const keys = STEP_KEYS.filter((key) => key in step);
      if (keys.length === 0) {
        throw new StepError(`${at} is not a known step. Expected one of: ${STEP_KEYS.join(', ')}.`);
      }
      if (keys.length > 1) {
        throw new StepError(`${at} sets ${keys.join(' and ')}; a step does one thing.`);
      }

      if (++total > MAX_STEPS) {
        throw new StepError(`A tool may not exceed ${MAX_STEPS} steps.`);
      }

      if ('repeat' in step) {
        const { times, steps: inner } = step.repeat;
        if (!Number.isInteger(times) || times < 1 || times > MAX_REPEAT) {
          throw new StepError(`${at}.repeat.times must be a whole number from 1 to ${MAX_REPEAT}.`);
        }
        walk(inner, `${at}.repeat.steps`);
      }

      if ('assert' in step) {
        const { selector, absent, urlContains } = step.assert;
        if (!selector && !absent && !urlContains) {
          throw new StepError(`${at}.assert needs selector, absent, or urlContains.`);
        }
        if (!step.assert.message?.trim()) {
          throw new StepError(`${at}.assert needs a message.`);
        }
      }

      if ('upload' in step) {
        const { selector, trigger, file, mode } = step.upload;
        if (!file?.trim()) throw new StepError(`${at}.upload needs a file.`);
        if (mode === 'picker' ? !trigger : !selector) {
          throw new StepError(
            `${at}.upload needs ${mode === 'picker' ? 'a trigger' : 'a selector'} for mode "${mode ?? 'input'}".`,
          );
        }
      }
    }
  };

  walk(steps, path);
}
