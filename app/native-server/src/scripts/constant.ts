export const COMMAND_NAME = 'mcp-chrome-bridge';

/**
 * Extension ID the native host will accept connections from.
 *
 * Upstream hardcoded the published Web Store ID, which makes a locally built
 * unpacked extension impossible to connect: Chrome derives an unpacked
 * extension's ID from its directory path, so it never matches.
 *
 * Resolution order:
 *   1. --extension-id on `register`
 *   2. MCP_CHROME_EXTENSION_ID in the environment
 *   3. the published default below
 */
export const DEFAULT_EXTENSION_ID = 'hbdgbgagpkpjffpklnamcljpakneikee';

/** Chrome extension IDs are 32 characters, a-p. */
export function isValidExtensionId(id: string): boolean {
  return /^[a-p]{32}$/.test(id);
}

export function resolveExtensionId(override?: string): string {
  const candidate = (override || process.env.MCP_CHROME_EXTENSION_ID || '').trim();
  if (!candidate) return DEFAULT_EXTENSION_ID;
  if (!isValidExtensionId(candidate)) {
    throw new Error(
      `"${candidate}" is not a valid Chrome extension ID (expected 32 characters, a-p).\n` +
        'Find it at chrome://extensions with Developer mode on.',
    );
  }
  return candidate;
}

/** Kept as a named export so existing imports keep working. */
export const EXTENSION_ID = resolveExtensionId();

export const HOST_NAME = 'com.chromemcp.nativehost';
export const DESCRIPTION = 'Node.js Host for Browser Bridge Extension';
