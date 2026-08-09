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

/**
 * Skips the step instead of failing it.
 *
 * Two things make a step skippable: the element is not on the page, or the
 * template needs a parameter the caller left out. Application forms need both,
 * because half their fields are optional and appear only on some postings.
 * Without this every pack would need a branch the language does not have.
 */
export interface Optional {
  optional?: boolean;
}

export type Step =
  | { goto: Template; until?: WaitTarget; newTab?: boolean }
  | { waitFor: WaitTarget }
  | ({ click: Template; until?: WaitTarget } & Optional)
  | ({ fill: Template; value: Template; submit?: boolean; typed?: boolean } & Optional)
  | ({ select: Template; value: Template } & Optional)
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
      } & Optional;
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
  | { repeat: { times: number; while?: { selector: Template }; steps: Step[] } }
  /**
   * Runs the inner steps once for each entry of an array the caller passed.
   *
   * This is what lets one pack answer a form it has never seen. A read tool
   * reports the fields a posting actually has, the agent sends back an answer
   * for each, and this walks them. Without it a pack can only fill the fixed
   * fields every posting shares.
   *
   * `forEach` names a parameter and nothing else, so a pack cannot iterate a
   * list it invented. `as` binds each entry for the inner templates to read,
   * as `{{answer.fieldName}}`.
   */
  | { forEach: Template; as: string; steps: Step[] };

export const MAX_REPEAT = 50;
export const MAX_STEPS = 200;
/** A caller sending more entries than this gets an error, not a silent trim. */
export const MAX_FOREACH = 100;

export class StepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StepError';
  }
}

/* ------------------------------------------------------------------ *
 * Templates
 * ------------------------------------------------------------------ */

const NAME = '[a-zA-Z_][a-zA-Z0-9_]*';
const TEMPLATE_PATTERN = new RegExp(
  `\\{\\{\\s*(${NAME}(?:\\.${NAME})*)\\s*(\\|\\s*(url|json))?\\s*\\}\\}`,
  'g',
);

/**
 * Keys that reach the prototype chain rather than the object in front of you.
 *
 * A dotted reference is the one place a pack chooses a property name, so the
 * lookup below reads own properties only and stops at these outright.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export interface RenderOptions {
  /**
   * Inspects each substituted value before it lands in the string.
   *
   * Selector positions pass a check here, because a selector built from caller
   * data is the one way a call could reach an element the pack never named.
   */
  check?: (value: string, reference: string) => void;
}

interface Found {
  present: boolean;
  value: unknown;
}

/** Walks `a.b.c` across own properties of plain objects, and nothing else. */
function lookup(params: Record<string, unknown>, reference: string): Found {
  let current: unknown = params;
  for (const key of reference.split('.')) {
    if (UNSAFE_KEYS.has(key)) return { present: false, value: undefined };
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return { present: false, value: undefined };
    }
    if (!Object.prototype.hasOwnProperty.call(current, key)) {
      return { present: false, value: undefined };
    }
    current = (current as Record<string, unknown>)[key];
  }
  return { present: true, value: current };
}

function substitute(value: unknown, filter?: string): string {
  if (value === undefined || value === null) return '';
  if (filter === 'json') return JSON.stringify(value);
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return filter === 'url' ? encodeURIComponent(text) : text;
}

/**
 * Substitutes parameters into a template.
 *
 * A missing parameter throws rather than rendering "undefined" into a URL and
 * navigating somewhere unintended. Use `renderOptional` where absence is a
 * normal answer.
 */
export function renderTemplate(
  template: Template,
  params: Record<string, unknown>,
  options: RenderOptions = {},
): string {
  return template.replace(TEMPLATE_PATTERN, (_match, name: string, _pipe, filter?: string) => {
    const { present, value } = lookup(params, name);
    if (!present) {
      throw new StepError(`Template references "{{${name}}}", which is not a parameter.`);
    }
    const text = substitute(value, filter);
    options.check?.(text, name);
    return text;
  });
}

/**
 * Renders a template, or reports that it cannot be rendered yet.
 *
 * Returns null when any reference is absent or empty, which is how an optional
 * step decides to skip. An optional phone field and a caller who has no phone
 * number are the same situation, and neither is an error.
 */
export function renderOptional(
  template: Template,
  params: Record<string, unknown>,
  options: RenderOptions = {},
): string | null {
  let skip = false;
  const rendered = template.replace(
    TEMPLATE_PATTERN,
    (_match, name: string, _pipe, filter?: string) => {
      const { present, value } = lookup(params, name);
      const text = present ? substitute(value, filter) : '';
      if (!text) skip = true;
      if (text) options.check?.(text, name);
      return text;
    },
  );
  return skip ? null : rendered;
}

/**
 * Every parameter a step tree references, for validation at build time.
 *
 * Names bound by an enclosing `forEach` are not parameters, so they are left
 * out. Only the root of a dotted reference is reported, since that is the part
 * a tool has to declare.
 */
export function templateRefs(steps: readonly Step[]): Set<string> {
  const found = new Set<string>();

  const scan = (value: unknown, bound: ReadonlySet<string>): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(TEMPLATE_PATTERN)) {
        const root = match[1]?.split('.')[0];
        if (root && !bound.has(root)) found.add(root);
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => scan(entry, bound));
      return;
    }
    if (!value || typeof value !== 'object') return;

    if ('forEach' in value && 'as' in value) {
      const loop = value as { forEach: unknown; as: unknown; steps?: unknown };
      scan(loop.forEach, bound);
      const inner = typeof loop.as === 'string' ? new Set([...bound, loop.as]) : bound;
      scan(loop.steps, inner);
      return;
    }

    Object.values(value).forEach((entry) => scan(entry, bound));
  };

  scan(steps, new Set());
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
  'forEach',
] as const;

/** A bare `{{name}}`, with nothing around it. */
const BARE_REFERENCE = /^\s*\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}\s*$/;
const LOOP_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

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
  const walk = (list: readonly Step[], where: string, bound: ReadonlySet<string>): void => {
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
        walk(inner, `${at}.repeat.steps`, bound);
      }

      if ('forEach' in step) {
        // Naming a parameter, rather than accepting any template, is what keeps
        // a pack from iterating something it made up. The value still has to be
        // an array when the call runs; that is the interpreter's job.
        if (typeof step.forEach !== 'string' || !BARE_REFERENCE.test(step.forEach)) {
          throw new StepError(
            `${at}.forEach must name one parameter, like "{{answers}}". Got ${JSON.stringify(step.forEach)}.`,
          );
        }
        if (typeof step.as !== 'string' || !LOOP_NAME.test(step.as)) {
          throw new StepError(`${at}.as must be a name, like "answer".`);
        }
        if (bound.has(step.as)) {
          throw new StepError(
            `${at}.as reuses "${step.as}", which an enclosing forEach already binds.`,
          );
        }
        walk(step.steps, `${at}.forEach.steps`, new Set([...bound, step.as]));
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

  walk(steps, path, new Set());
}
