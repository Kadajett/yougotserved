/**
 * File uploads.
 *
 * Uploading is the one capability that moves data *out* of the user's machine
 * and into a site, which makes it the sharpest edge in the whole SDK. A tool
 * that can upload can, if handed the wrong path, post `~/.ssh/id_ed25519` to a
 * web form. So this module does two things:
 *
 *  1. Describes a file reference in the shape an agent can actually produce —
 *     a local path, a URL, or inline base64.
 *  2. Classifies a path *before* the host reads a byte of it, so obviously
 *     sensitive locations are refused outright and anything outside the
 *     adapter's declared roots needs the user to confirm.
 *
 * The classification is pure string work on purpose: no filesystem access, so
 * it runs anywhere and is cheap to test. The host does the stat, the size
 * check, and the actual read.
 */

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

/**
 * Where the bytes come from.
 *
 * `path` is the common case: coding agents run on the same machine as the
 * browser, so "upload ~/Documents/resume.pdf" is a path, not an upload.
 */
export interface FileRef {
  /** Absolute path on the machine running the host. */
  path?: string;
  /** URL for the host to fetch. Subject to the adapter's origin fence. */
  url?: string;
  /** Inline contents. Needs `filename`. */
  base64?: string;
  /** Name shown to the site. Defaults to the basename of `path` or `url`. */
  filename?: string;
  /** Content type shown to the site. The host sniffs one if omitted. */
  mimeType?: string;
}

export type UploadVerdict =
  /** Inside a declared root and not sensitive. Proceed. */
  | { decision: 'allow'; path: string }
  /** Readable in principle, but the user should say so first. */
  | { decision: 'confirm'; path: string; reason: string }
  /** Never, whatever the caller passes. */
  | { decision: 'deny'; path: string; reason: string };

export interface UploadPolicy {
  /**
   * Directories an adapter may upload from without asking. Absolute paths.
   * Empty means every path needs confirmation, which is the safe default for
   * an adapter installed from a link.
   */
  allowedRoots?: readonly string[];
  /** Extensions to accept, without the dot. Empty means any. */
  allowedExtensions?: readonly string[];
  /** Refuse anything larger. The host enforces this after stat. */
  maxBytes?: number;
}

/**
 * Locations that hold credentials, keys, or session state. An upload from any
 * of these is a mistake or an attack; there is no third case, so it is refused
 * rather than confirmed.
 */
const SENSITIVE_SEGMENTS: readonly { pattern: RegExp; what: string }[] = [
  { pattern: /(^|\/)\.ssh(\/|$)/, what: 'SSH keys' },
  { pattern: /(^|\/)\.gnupg(\/|$)/, what: 'GnuPG keyring' },
  { pattern: /(^|\/)\.aws(\/|$)/, what: 'AWS credentials' },
  { pattern: /(^|\/)\.azure(\/|$)/, what: 'Azure credentials' },
  { pattern: /(^|\/)\.kube(\/|$)/, what: 'Kubernetes credentials' },
  { pattern: /(^|\/)\.docker(\/|$)/, what: 'Docker credentials' },
  { pattern: /(^|\/)\.config\/gcloud(\/|$)/, what: 'gcloud credentials' },
  { pattern: /(^|\/)\.gitconfig$/, what: 'git configuration' },
  { pattern: /(^|\/)\.git-credentials$/, what: 'git credentials' },
  { pattern: /(^|\/)\.netrc$/, what: 'netrc credentials' },
  { pattern: /(^|\/)\.npmrc$/, what: 'npm token' },
  { pattern: /(^|\/)\.pypirc$/, what: 'PyPI token' },
  { pattern: /(^|\/)\.env(\.[^/]+)?$/, what: 'environment file' },
  { pattern: /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/, what: 'private key' },
  { pattern: /(^|\/)library\/keychains(\/|$)/, what: 'macOS keychain' },
  // Browser profile directories are named differently on every platform:
  // ~/.config/google-chrome on Linux, Google/Chrome under Application Support
  // on macOS and AppData on Windows. Both spellings, or the check passes on
  // exactly the platform this project targets first.
  { pattern: /(^|\/)google[/-]chrome(\/|$)/, what: 'Chrome profile' },
  { pattern: /(^|\/)chromium(\/|$)/, what: 'Chromium profile' },
  { pattern: /(^|\/)microsoft[/-]edge(\/|$)/, what: 'Edge profile' },
  { pattern: /(^|\/)mozilla(\/|$)/, what: 'Firefox profile' },
  { pattern: /(^|\/)bravesoftware(\/|$)/, what: 'browser profile' },
  { pattern: /(^|\/)\.mozilla(\/|$)/, what: 'Firefox profile' },
  { pattern: /(^|\/)appdata\/(roaming|local)(\/|$)/, what: 'Windows application data' },
  { pattern: /(^|\/)windows\/system32(\/|$)/, what: 'Windows system files' },
  { pattern: /(^|\/)ntuser\.dat$/, what: 'Windows user registry' },
  { pattern: /^\/etc\/(shadow|passwd|sudoers)$/, what: 'system account files' },
  { pattern: /(^|\/)\.claude(\/|$)/, what: 'agent configuration' },
];

const SENSITIVE_EXTENSIONS: readonly { extension: string; what: string }[] = [
  { extension: 'pem', what: 'private key' },
  { extension: 'key', what: 'private key' },
  { extension: 'p12', what: 'key bundle' },
  { extension: 'pfx', what: 'key bundle' },
  { extension: 'keystore', what: 'key bundle' },
  { extension: 'jks', what: 'key bundle' },
  { extension: 'kdbx', what: 'password database' },
];

/** Windows separators and case folded away, so one set of patterns covers both. */
export function normalisePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function basename(input: string): string {
  const parts = normalisePath(input).split('/').filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

export function extensionOf(input: string): string {
  const name = basename(input);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function isAbsolute(path: string): boolean {
  return path.startsWith('/') || /^[a-z]:\//i.test(normalisePath(path));
}

function isInside(root: string, path: string): boolean {
  const normalisedRoot = normalisePath(root).replace(/\/$/, '').toLowerCase();
  const normalisedPath = normalisePath(path).toLowerCase();
  return normalisedPath === normalisedRoot || normalisedPath.startsWith(`${normalisedRoot}/`);
}

/**
 * Decides what to do with a path before anything reads it.
 *
 * Relative paths and `..` segments are refused rather than resolved, because
 * resolving them means guessing a working directory the agent never stated,
 * and a wrong guess here uploads the wrong file.
 */
export function classifyUploadPath(rawPath: string, policy: UploadPolicy = {}): UploadVerdict {
  const path = normalisePath(rawPath.trim());

  if (!path) return { decision: 'deny', path, reason: 'The path is empty.' };
  if (!isAbsolute(path)) {
    return {
      decision: 'deny',
      path,
      reason:
        'Upload paths must be absolute. A relative path depends on a working directory the caller never stated.',
    };
  }
  if (path.split('/').includes('..')) {
    return { decision: 'deny', path, reason: 'Upload paths must not contain "..".' };
  }
  if (path.includes('\0')) {
    return { decision: 'deny', path, reason: 'The path contains a null byte.' };
  }

  const lower = path.toLowerCase();
  for (const { pattern, what } of SENSITIVE_SEGMENTS) {
    if (pattern.test(lower)) {
      return { decision: 'deny', path, reason: `That path holds ${what}.` };
    }
  }

  const extension = extensionOf(path);
  for (const entry of SENSITIVE_EXTENSIONS) {
    if (extension === entry.extension) {
      return { decision: 'deny', path, reason: `A .${extension} file is a ${entry.what}.` };
    }
  }

  if (policy.allowedExtensions?.length && !policy.allowedExtensions.includes(extension)) {
    return {
      decision: 'deny',
      path,
      reason: `This tool accepts ${policy.allowedExtensions.join(', ')} files; got "${
        extension || 'no extension'
      }".`,
    };
  }

  const roots = policy.allowedRoots ?? [];
  if (roots.length === 0) {
    return {
      decision: 'confirm',
      path,
      reason: 'No upload roots are configured, so every upload is confirmed individually.',
    };
  }
  if (!roots.some((root) => isInside(root, path))) {
    return {
      decision: 'confirm',
      path,
      reason: `That path is outside the configured upload roots (${roots.join(', ')}).`,
    };
  }

  return { decision: 'allow', path };
}

/**
 * Checks a {@link FileRef} is well formed and names the file. The host still
 * classifies the path and checks the URL against the adapter's origins.
 */
export function normaliseFileRef(ref: FileRef): Required<Pick<FileRef, 'filename'>> & FileRef {
  const sources = (['path', 'url', 'base64'] as const).filter((key) => {
    const value = ref[key];
    return typeof value === 'string' && value.trim() !== '';
  });

  if (sources.length === 0) {
    throw new UploadError('A file needs one of "path", "url", or "base64".');
  }
  if (sources.length > 1) {
    throw new UploadError(`A file must have exactly one source; got ${sources.join(' and ')}.`);
  }

  if (ref.base64 && !ref.filename?.trim()) {
    throw new UploadError('Inline base64 content needs a "filename" to present to the site.');
  }

  const filename =
    ref.filename?.trim() ||
    (ref.path ? basename(ref.path) : '') ||
    (ref.url ? basename(new URL(ref.url).pathname) : '');

  if (!filename) {
    throw new UploadError('Could not work out a filename; pass one explicitly.');
  }
  if (filename.includes('/') || filename.includes('\\')) {
    throw new UploadError(`Filename "${filename}" must not contain a path separator.`);
  }

  return { ...ref, filename };
}
