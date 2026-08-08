/**
 * Declarative extraction.
 *
 * An adapter says *what* it wants off the page as data:
 *
 *     const people = await page.extract({
 *       each: '.reusable-search__result-container',
 *       limit: 10,
 *       fields: {
 *         name: 'span[aria-hidden="true"]',
 *         headline: '.entity-result__primary-subtitle',
 *         profileUrl: { selector: 'a.app-aware-link', prop: 'href' },
 *       },
 *     });
 *
 * It never ships code into the page. The spec is JSON; the interpreter below
 * is fixed, audited, and the same for every adapter. That is what makes an
 * adapter safe to install from a gist — a hostile spec can misread a page, but
 * it cannot read `document.cookie`, call `fetch`, or reach anything the
 * interpreter does not itself do.
 *
 * It is also where the token saving comes from. One round trip returns the six
 * fields the agent asked for instead of the page it would otherwise have to
 * read to find them.
 */

export type FieldSpec = string | FieldSpecObject;

export interface FieldSpecObject {
  /** CSS selector relative to the record root. Omitted means the root itself. */
  selector?: string;
  /** Read an HTML attribute verbatim (`data-id`, `aria-label`). */
  attr?: string;
  /**
   * Read a DOM property instead. `href` and `src` resolve against the page URL,
   * which the matching attributes do not.
   */
  prop?: 'href' | 'src' | 'value' | 'checked' | 'textContent';
  /** Return `innerHTML` rather than text. */
  html?: boolean;
  /** Collapse runs of whitespace and trim. Default true for text. */
  trim?: boolean;
  /** Collect every match rather than the first. */
  all?: boolean;
  /** Parse the first number out of the text: "1,234 followers" becomes 1234. */
  number?: boolean;
  /** True when at least one element matches. Useful for badges and flags. */
  exists?: boolean;
  /** Pull a capture group out of the value. */
  regex?: string;
  regexGroup?: number;
  /** Used when the selector matches nothing. */
  fallback?: string | number | boolean | null;
  /** Nested record, scoped to this field's element. */
  fields?: Record<string, FieldSpec>;
}

export interface ExtractSpec {
  /**
   * Selector for repeated records. Each match produces one object. Omit it to
   * extract a single object from the root.
   */
  each?: string;
  /** Stop after this many records. Guards against a 500-row table. */
  limit?: number;
  /** Skip this many records first, for cursor-style paging. */
  offset?: number;
  fields: Record<string, FieldSpec>;
}

export type ExtractedValue = string | number | boolean | null | ExtractedRecord | ExtractedValue[];
export interface ExtractedRecord {
  [key: string]: ExtractedValue;
}

export class ExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractError';
  }
}

/** The slice of the DOM the interpreter touches, so it can be tested headless. */
type Queryable = Pick<Element, 'querySelector' | 'querySelectorAll'>;

/**
 * Reads a page against a spec.
 *
 * Every helper is nested inside this function on purpose. The extension injects
 * it into the tab with `chrome.scripting.executeScript({ func })`, which
 * stringifies the function and drops its closure. A reference to anything in
 * this module would survive the type checker and then fail at runtime, in the
 * page, where the error is hard to read. Nesting makes that impossible.
 *
 * So this is the only copy of the extract rules. The host, the tests and the
 * page all run these exact lines.
 */
export function runExtractSpec(
  spec: ExtractSpec,
  root?: Queryable,
): ExtractedRecord | ExtractedRecord[] {
  /** Not the exported class: that name is not in scope inside the page. */
  function fail(message: string): never {
    const error = new Error(message);
    error.name = 'ExtractError';
    throw error;
  }

  // `root` is optional so the extension can inject this function as-is and pass
  // only the spec. A document reference cannot cross that boundary.
  const scope = root ?? (globalThis as { document?: Queryable }).document;
  if (!scope) fail('No document to extract from.');

  if (!spec || typeof spec !== 'object' || !spec.fields) {
    fail('An extract spec needs a "fields" object.');
  }

  if (!spec.each) return readFields(spec.fields, scope);

  // 1000 is written twice rather than held in a named constant. The extension
  // bundler hoists a function-local `const` to module scope, which breaks the
  // injected copy. `scripts/check-injected-runner.js` proves it stays fixed.
  const offset = Math.max(0, spec.offset ?? 0);
  const limit = Math.min(spec.limit ?? 1000, 1000);
  const matches = Array.from(scope.querySelectorAll(spec.each));
  const records: ExtractedRecord[] = [];

  for (const element of matches.slice(offset, offset + limit)) {
    records.push(readFields(spec.fields, element));
  }
  return records;

  /* Helpers. Declarations, so they hoist above the lines that use them. */

  function readFields(fields: Record<string, FieldSpec>, scope: Queryable): ExtractedRecord {
    const record: ExtractedRecord = {};
    for (const [name, field] of Object.entries(fields)) {
      record[name] = readField(normalise(field), scope);
    }
    return record;
  }

  function normalise(field: FieldSpec): FieldSpecObject {
    return typeof field === 'string' ? { selector: field } : field;
  }

  function readField(field: FieldSpecObject, scope: Queryable): ExtractedValue {
    const elements = select(field, scope);

    if (field.exists) return elements.length > 0;

    if (elements.length === 0) {
      if (field.fallback !== undefined) return field.fallback;
      return field.all ? [] : null;
    }

    if (field.all) return elements.map((element) => readOne(field, element));

    // `elements` is non-empty here, but noUncheckedIndexedAccess does not know it.
    const first = elements[0];
    return first === undefined ? null : readOne(field, first);
  }

  function select(field: FieldSpecObject, scope: Queryable): Element[] {
    if (!field.selector) {
      // No selector means the scope itself. A record root is an Element; the
      // document is not, and has no fields of its own worth reading.
      return isElement(scope) ? [scope] : [];
    }
    try {
      return field.all
        ? Array.from(scope.querySelectorAll(field.selector))
        : elementOrNone(scope.querySelector(field.selector));
    } catch (error) {
      fail(
        `Selector ${JSON.stringify(field.selector)} is not valid CSS: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  function elementOrNone(element: Element | null): Element[] {
    return element ? [element] : [];
  }

  function isElement(value: unknown): value is Element {
    return typeof value === 'object' && value !== null && 'tagName' in value;
  }

  function readOne(field: FieldSpecObject, element: Element): ExtractedValue {
    if (field.fields) return readFields(field.fields, element);

    let value = rawValue(field, element);
    if (value === null) return field.fallback ?? null;

    if (typeof value === 'string') {
      if (field.trim ?? !field.html) value = collapse(value);
      if (field.regex) {
        const match = new RegExp(field.regex).exec(value);
        if (!match) return field.fallback ?? null;
        value = match[field.regexGroup ?? 1] ?? match[0] ?? '';
      }
      if (field.number) {
        const parsed = parseNumber(value);
        return parsed ?? (field.fallback as number | null) ?? null;
      }
    }
    return value;
  }

  function rawValue(field: FieldSpecObject, element: Element): string | boolean | null {
    if (field.attr) return element.getAttribute(field.attr);
    if (field.html) return element.innerHTML;

    switch (field.prop) {
      case 'href':
        // The property resolves relative URLs against the document; the
        // attribute does not, and a relative href is useless to a caller.
        return readProp(element, 'href');
      case 'src':
        return readProp(element, 'src');
      case 'value':
        return readProp(element, 'value');
      case 'checked': {
        const checked = (element as unknown as { checked?: unknown }).checked;
        return typeof checked === 'boolean' ? checked : false;
      }
      case 'textContent':
      default:
        return element.textContent ?? '';
    }
  }

  function readProp(element: Element, prop: string): string | null {
    const value = (element as unknown as Record<string, unknown>)[prop];
    if (typeof value === 'string') return value;
    return element.getAttribute(prop);
  }

  function collapse(value: string): string {
    return value.replace(/\s+/g, ' ').trim();
  }

  function parseNumber(value: string): number | null {
    // Strip the separators sites use inside numbers before parsing:
    //   \u00A0 non-breaking space, plain space, comma. Written as escapes
    // because a literal non-breaking space is invisible in a diff.
    const match = value.replace(/[\u00A0\u0020,]/g, '').match(/-?\d+(\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
}

/**
 * Rejects a spec before it reaches the browser, so a typo in a shared adapter
 * surfaces at load time with a filename attached rather than as an empty
 * result three calls into an agent's run.
 */
export function validateExtractSpec(spec: ExtractSpec, path = 'extract'): void {
  if (!spec || typeof spec !== 'object') throw new ExtractError(`${path} must be an object.`);
  if (!spec.fields || typeof spec.fields !== 'object' || Array.isArray(spec.fields)) {
    throw new ExtractError(`${path}.fields must be an object of field specs.`);
  }
  if (Object.keys(spec.fields).length === 0) {
    throw new ExtractError(`${path}.fields is empty; there is nothing to extract.`);
  }
  if (spec.limit !== undefined && (!Number.isInteger(spec.limit) || spec.limit < 1)) {
    throw new ExtractError(`${path}.limit must be a positive whole number.`);
  }
  if (spec.offset !== undefined && (!Number.isInteger(spec.offset) || spec.offset < 0)) {
    throw new ExtractError(`${path}.offset must be zero or a positive whole number.`);
  }
  for (const [name, field] of Object.entries(spec.fields)) {
    validateField(field, `${path}.fields.${name}`);
  }
}

function validateField(field: FieldSpec, path: string): void {
  if (typeof field === 'string') {
    if (!field.trim()) throw new ExtractError(`${path} is an empty selector.`);
    return;
  }
  if (!field || typeof field !== 'object') {
    throw new ExtractError(`${path} must be a selector string or a field spec object.`);
  }
  if (field.attr && field.prop) {
    throw new ExtractError(`${path} sets both "attr" and "prop"; pick one.`);
  }
  if (field.regex) {
    try {
      new RegExp(field.regex);
    } catch (error) {
      throw new ExtractError(
        `${path}.regex is not a valid expression: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  for (const [name, child] of Object.entries(field.fields ?? {})) {
    validateField(child, `${path}.fields.${name}`);
  }
}
