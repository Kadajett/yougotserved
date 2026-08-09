/**
 * Signing this machine in to the registry.
 *
 * An agent has no browser to be redirected in, so the usual OAuth round trip is
 * the wrong shape. It uses the device flow instead: ask the registry for a
 * code, show the human a short one to type into a page, then poll until they
 * have. That works over SSH and inside a container, which is where these agents
 * actually run, and it never needs a loopback port.
 *
 * The token is written to a file only this user can read. It is not a password
 * and cannot be turned back into one: it authorises this machine to act as the
 * account, and revoking it is a row the registry deletes.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const DEFAULT_REGISTRY = 'https://registry.yougotserved.dev';

function registryUrl(): string {
  return (process.env.YGS_REGISTRY_URL || DEFAULT_REGISTRY).replace(/\/+$/, '');
}

function configDir(): string {
  return process.env.YGS_ADAPTERS_DIR
    ? path.dirname(process.env.YGS_ADAPTERS_DIR)
    : path.join(os.homedir(), '.yougotserved');
}

function tokenFile(): string {
  return path.join(configDir(), 'account.json');
}

export interface StoredAccount {
  token: string;
  login: string;
  id: number;
  registry: string;
  savedAt: string;
}

export function readAccount(): StoredAccount | null {
  try {
    const stored = JSON.parse(fs.readFileSync(tokenFile(), 'utf8')) as StoredAccount;
    // A token minted against one registry means nothing to another, and
    // silently sending it to a different host would be the worse failure.
    if (!stored?.token || stored.registry !== registryUrl()) return null;
    return stored;
  } catch {
    return null;
  }
}

export function writeAccount(stored: StoredAccount): void {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(tokenFile(), `${JSON.stringify(stored, null, 2)}\n`, { mode: 0o600 });
}

export function forgetAccount(): boolean {
  try {
    fs.unlinkSync(tokenFile());
    return true;
  } catch {
    return false;
  }
}

/** The header to add when there is an account, and nothing when there is not. */
export function authHeader(): Record<string, string> {
  const stored = readAccount();
  return stored ? { authorization: `Bearer ${stored.token}` } : {};
}

export interface DeviceStart {
  userCode: string;
  deviceCode: string;
  verifier: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
}

export async function startDeviceLogin(): Promise<DeviceStart> {
  const response = await fetch(`${registryUrl()}/api/auth/device`, { method: 'POST' });
  const body = (await response.json()) as any;

  if (!response.ok) {
    throw new Error(body?.error?.message ?? `Registry returned ${response.status}.`);
  }
  return body as DeviceStart;
}

export type PollOutcome =
  | { status: 'ready'; token: string; account: { id: number; login: string } }
  | { status: 'pending' }
  | { status: 'expired' | 'denied' };

export async function pollDeviceLogin(start: DeviceStart): Promise<PollOutcome> {
  const response = await fetch(`${registryUrl()}/api/auth/device/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceCode: start.deviceCode, verifier: start.verifier }),
  });
  const body = (await response.json()) as any;

  if (response.status === 202) return { status: 'pending' };
  if (response.ok && body.status === 'ready') {
    return { status: 'ready', token: body.token, account: body.account };
  }
  return { status: body?.status === 'denied' ? 'denied' : 'expired' };
}

/**
 * Runs the whole flow, calling back so a CLI and an MCP tool can each say it
 * their own way.
 *
 * Polling stops at the registry's own expiry rather than a count of tries, so
 * the two cannot drift apart.
 */
export async function deviceLogin(
  announce: (start: DeviceStart) => void,
  wait: (ms: number) => Promise<void>,
): Promise<StoredAccount> {
  const start = await startDeviceLogin();
  announce(start);

  while (Date.now() < start.expiresAt) {
    await wait(start.interval * 1000);
    const outcome = await pollDeviceLogin(start);

    if (outcome.status === 'ready') {
      const stored: StoredAccount = {
        token: outcome.token,
        login: outcome.account.login,
        id: outcome.account.id,
        registry: registryUrl(),
        savedAt: new Date().toISOString(),
      };
      writeAccount(stored);
      return stored;
    }
    if (outcome.status !== 'pending') {
      throw new Error(
        outcome.status === 'denied'
          ? 'That sign-in was refused.'
          : 'That code expired before it was approved.',
      );
    }
  }

  throw new Error('That code expired before it was approved.');
}

/** Asks the registry who this machine's token belongs to. */
export async function whoami(): Promise<{ login: string; accountAgeDays?: number } | null> {
  const stored = readAccount();
  if (!stored) return null;

  const response = await fetch(`${registryUrl()}/api/auth/me`, { headers: authHeader() });
  if (!response.ok) return null;

  const body = (await response.json()) as any;
  return body.account ?? null;
}
