/**
 * What a tool hands back.
 *
 * Adapters return structured data, not a page dump. That is the entire point:
 * `linkedin_search_people` should cost an agent a few hundred tokens of
 * results, not thirty thousand tokens of DOM it has to read to find them.
 *
 * Failures are typed because the right response differs sharply by kind. A
 * logged-out session needs the user; a moved selector needs the adapter
 * updated; a rate limit needs a wait. An agent that gets `{ isError: true }`
 * and a sentence of English guesses, and usually guesses "retry".
 */

export type AdapterErrorCode =
  /** The site says the user is not signed in. Only a human can fix this. */
  | 'not_authenticated'
  /** Signed in, but this account lacks access to the thing asked for. */
  | 'not_authorized'
  /** The page rendered but an element the adapter depends on is gone. */
  | 'selector_missing'
  /** The site asked for a captcha, MFA, or another interactive challenge. */
  | 'challenge_required'
  /** The site is throttling. `retryAfterMs` says how long to wait. */
  | 'rate_limited'
  /** A step took longer than its budget. */
  | 'timeout'
  /** The tool refused to act: origin fence, missing capability, no confirm. */
  | 'refused'
  /** Arguments did not validate. */
  | 'invalid_input'
  /** The requested thing does not exist on the site. */
  | 'not_found'
  /** Anything else. */
  | 'failed';

export interface AdapterError {
  code: AdapterErrorCode;
  message: string;
  /** What the caller should do next, in one sentence. */
  hint?: string;
  /** True when trying the same call again could plausibly work. */
  retryable?: boolean;
  retryAfterMs?: number;
  /** The URL the adapter was on when this happened. */
  url?: string;
}

export interface AdapterOk<T> {
  ok: true;
  data: T;
  /**
   * One line an agent can read instead of the payload — "12 people, showing
   * 1-10". Optional; omit it when the data is already small.
   */
  summary?: string;
  /** Set when more results exist behind a cursor the tool accepts. */
  nextCursor?: string;
  /** True when the adapter returned fewer results than the site holds. */
  truncated?: boolean;
}

export type AdapterResult<T> = AdapterOk<T> | { ok: false; error: AdapterError };

export function ok<T>(data: T, extra: Omit<AdapterOk<T>, 'ok' | 'data'> = {}): AdapterResult<T> {
  return { ok: true, data, ...extra };
}

export function err(
  code: AdapterErrorCode,
  message: string,
  extra: Omit<AdapterError, 'code' | 'message'> = {},
): AdapterResult<never> {
  return { ok: false, error: { code, message, ...extra } };
}

/**
 * Thrown by `BrowserSession` when a step fails. The host converts it to an
 * {@link AdapterResult}, so a handler that does nothing about it still
 * produces a well-typed error rather than a stack trace.
 */
export class AdapterFailure extends Error {
  constructor(
    readonly code: AdapterErrorCode,
    message: string,
    readonly detail: Omit<AdapterError, 'code' | 'message'> = {},
  ) {
    super(message);
    this.name = 'AdapterFailure';
  }

  toResult(): AdapterResult<never> {
    return err(this.code, this.message, this.detail);
  }
}

export function toAdapterResult(error: unknown): AdapterResult<never> {
  if (error instanceof AdapterFailure) return error.toResult();
  if (error instanceof Error) return err('failed', error.message);
  return err('failed', String(error));
}
