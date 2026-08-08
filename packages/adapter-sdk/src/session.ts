/**
 * The capability object a tool handler is given.
 *
 * A handler receives a `BrowserSession` and nothing else. There is no ambient
 * `fetch`, no `require`, no filesystem — if a capability is not on this
 * interface, an adapter cannot reach it. The host builds the session per call,
 * fenced to the adapter's declared origins and trimmed to the capabilities the
 * adapter declared, so an adapter that never asked for `evaluate` has no
 * `evaluate` to call.
 */

import type { ExtractSpec, ExtractedRecord } from './extract.js';
import type { FileRef } from './files.js';

/**
 * What an adapter is allowed to do. The host enforces this list; the adapter
 * only declares it. Anything not declared throws `refused` at call time.
 */
export type Capability =
  /** Move the tab between pages inside the declared origins. */
  | 'navigate'
  /** Read text, structure, and declarative extractions off the page. */
  | 'read'
  /** Click, type, select, scroll — anything that changes page state. */
  | 'interact'
  /** Capture a screenshot of the tab. */
  | 'screenshot'
  /** Observe network requests the page makes. */
  | 'network'
  /** Save files the site serves. */
  | 'download'
  /**
   * Put a file from the user's machine into a form on the page.
   *
   * The only capability that moves data off the machine, so it is never
   * implied by a risk level and the host classifies every path before reading
   * it. See files.ts.
   */
  | 'upload'
  /**
   * Run arbitrary JavaScript in the page.
   *
   * This is the capability that undoes the others: page JS in an authenticated
   * origin can read tokens, call the site's API as the user, and post the
   * result anywhere. Declarative extraction covers nearly every real case.
   * Hosts surface an adapter that asks for this differently, and users should
   * read one before installing it.
   */
  | 'evaluate';

export const ALL_CAPABILITIES: readonly Capability[] = [
  'navigate',
  'read',
  'interact',
  'screenshot',
  'network',
  'download',
  'upload',
  'evaluate',
];

/** Capabilities that can change something the user cares about. */
export const MUTATING_CAPABILITIES: readonly Capability[] = [
  'interact',
  'evaluate',
  'download',
  'upload',
];

/**
 * Capabilities a tool never gets by default, however it declares its risk.
 * Both can reach past the page: `evaluate` runs as the origin, `upload` reads
 * the local disk.
 */
export const OPT_IN_CAPABILITIES: readonly Capability[] = ['upload', 'evaluate'];

export interface WaitOptions {
  /** Milliseconds before the wait fails with `timeout`. Host default applies. */
  timeoutMs?: number;
}

export type WaitTarget =
  /** Wait for at least one element to match. */
  | { selector: string; visible?: boolean }
  /** Wait for every match to disappear — spinners, skeletons, overlays. */
  | { selectorGone: string }
  /** Wait for the address to contain a substring or match a pattern. */
  | { url: string | RegExp }
  /** Wait for the page to stop making requests. */
  | { networkIdle: true; forMs?: number }
  /** A flat delay. A last resort; prefer a condition. */
  | { ms: number };

export interface NavigateOptions extends WaitOptions {
  /** Open in a new tab rather than reusing the current one. */
  newTab?: boolean;
  /** Reload if already on this URL. */
  refresh?: boolean;
  /** Condition that means the page is ready. */
  until?: WaitTarget;
}

export interface ClickOptions extends WaitOptions {
  /** Scroll the element into view first. Default true. */
  scrollIntoView?: boolean;
  /** Wait for this condition after clicking. */
  until?: WaitTarget;
}

export interface FillOptions extends WaitOptions {
  /** Clear existing content first. Default true. */
  clear?: boolean;
  /**
   * Fire per-character key events instead of setting the value. Slower, but
   * some sites only react to real typing.
   */
  typed?: boolean;
  /** Press Enter afterwards. */
  submit?: boolean;
}

export interface ScrollOptions extends WaitOptions {
  /** Scroll this element into view. */
  selector?: string;
  /** Scroll the page by this many pixels; negative scrolls up. */
  by?: number;
  /** Scroll to the bottom, which is how most feeds page. */
  toBottom?: boolean;
}

export interface Screenshot {
  mimeType: string;
  base64: string;
  width: number;
  height: number;
}

export interface UploadOptions extends WaitOptions {
  /**
   * Wait for the selector to appear first. File inputs are routinely rendered
   * only after a dialog opens, so this defaults to true.
   */
  waitForSelector?: boolean;
  /** Condition that means the site has accepted the file — a filename, a progress bar, a thumbnail. */
  until?: WaitTarget;
  /**
   * Fire `input` and `change` after setting the files. Default true; React and
   * Vue forms ignore a file input that changes without them.
   */
  dispatchEvents?: boolean;
}

export interface UploadedFile {
  filename: string;
  bytes: number;
  mimeType: string;
}

export interface UploadReceipt {
  files: UploadedFile[];
  /** What the page shows for the attachment, when the tool waited for it. */
  confirmedBy?: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  /** Readable text, already stripped of chrome and scripts. */
  text: string;
  truncated: boolean;
}

export interface CapturedRequest {
  url: string;
  method: string;
  status?: number;
  mimeType?: string;
  /** Present only when the adapter asked for bodies and the host allowed it. */
  body?: unknown;
}

export interface NetworkAccess {
  /** Start recording. Returns a handle to stop and read. */
  capture(options?: { urlPattern?: string; includeBodies?: boolean }): Promise<NetworkCapture>;
}

export interface NetworkCapture {
  stop(): Promise<CapturedRequest[]>;
}

/**
 * Everything a handler can do to the page.
 *
 * Methods throw `AdapterFailure` on failure rather than returning a result, so
 * a handler reads top to bottom without a check after every line. The host
 * converts anything thrown into a typed {@link AdapterResult}.
 */
export interface BrowserSession {
  /** Where the tab is right now. */
  readonly url: string;
  readonly title: string;

  /** Aborted when the caller cancels or the tool's deadline passes. */
  readonly signal: AbortSignal;

  /** Goes to a URL. Rejected if it falls outside the adapter's origins. */
  goto(url: string, options?: NavigateOptions): Promise<void>;

  /** Blocks until the condition holds, or fails with `timeout`. */
  waitFor(target: WaitTarget, options?: WaitOptions): Promise<void>;

  /**
   * Pulls structured data out of the page. The main way to read a site.
   *
   * A spec with `each` returns one record per match; without it, a single
   * record. The return type follows the spec, so callers do not narrow a union
   * on every call — that dance is pure noise in a handler.
   */
  extract<S extends ExtractSpec>(
    spec: S,
  ): Promise<S extends { each: string } ? ExtractedRecord[] : ExtractedRecord>;

  /** Collapsed text content of the first match, or null. */
  text(selector: string): Promise<string | null>;

  exists(selector: string): Promise<boolean>;
  count(selector: string): Promise<number>;

  click(selector: string, options?: ClickOptions): Promise<void>;
  fill(selector: string, value: string, options?: FillOptions): Promise<void>;
  /** Chooses an option in a `<select>` by value or visible label. */
  select(selector: string, value: string): Promise<void>;
  /** Sends keys to the focused element: 'Enter', 'Escape', 'Control+a'. */
  press(keys: string): Promise<void>;
  scroll(options: ScrollOptions): Promise<void>;

  screenshot(options?: { selector?: string; fullPage?: boolean }): Promise<Screenshot>;

  /* ---------------------------------------------------------------- *
   * Uploads
   *
   * Three methods rather than one because sites accept files in three
   * genuinely different ways, and picking the wrong one fails silently —
   * the click lands, nothing attaches, and the agent reports success.
   *
   * All three require the `upload` capability, and the host classifies every
   * path before reading it.
   * ---------------------------------------------------------------- */

  /**
   * Sets files on an `<input type="file">`.
   *
   * The right choice whenever the input exists in the DOM, including the very
   * common case of a hidden input behind a styled "Attach" button — the input
   * does not need to be visible, only present.
   */
  upload(
    selector: string,
    files: FileRef | FileRef[],
    options?: UploadOptions,
  ): Promise<UploadReceipt>;

  /**
   * Clicks something that opens the OS file picker, and answers the picker.
   *
   * For sites that create the input only on click, or use the File System
   * Access API and so have no input at all. The host intercepts the chooser
   * before the native dialog appears, so nothing opens on the user's desktop.
   */
  uploadViaPicker(
    triggerSelector: string,
    files: FileRef | FileRef[],
    options?: UploadOptions,
  ): Promise<UploadReceipt>;

  /**
   * Drops files onto a drag-and-drop target that has no file input behind it.
   *
   * The last resort: it synthesises drag events, so it depends on how the page
   * listens for them. Try `upload` first — most drop zones have a hidden input
   * as their own fallback.
   */
  uploadToDropZone(
    selector: string,
    files: FileRef | FileRef[],
    options?: UploadOptions,
  ): Promise<UploadReceipt>;

  /** Whole-page text. Costs an agent real tokens; prefer `extract`. */
  readPage(options?: { maxChars?: number }): Promise<PageSnapshot>;

  readonly network: NetworkAccess;

  /**
   * Runs JavaScript in the page. Only present when the adapter declared the
   * `evaluate` capability; otherwise calling it fails with `refused`.
   */
  evaluate?<T = unknown>(expression: string): Promise<T>;

  /** Writes to the host's log. Never reaches the agent's context. */
  log(message: string): void;
}

/** Per-call context, separate from the page itself. */
export interface ToolContext {
  /** The adapter this call belongs to. */
  readonly adapterId: string;
  readonly toolId: string;
  /**
   * True when the caller passed `confirm: true`. Tools declared with
   * `confirm: true` are not invoked at all without it; this is here for tools
   * that want to vary behaviour rather than refuse.
   */
  readonly confirmed: boolean;
  /** Wall-clock budget remaining, in milliseconds. */
  readonly remainingMs: number;
}
