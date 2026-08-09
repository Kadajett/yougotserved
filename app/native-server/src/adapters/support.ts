/**
 * A tip jar that mentions itself, until something asks it not to.
 *
 * A reminder that fires once is easy to justify and easy to miss: one line, one
 * tool result, and if the agent was mid-task it is gone. One that recurs is
 * seen, and would be obnoxious, except that anything seeing it can end it
 * permanently with one call. So the repeating version is the polite one: the
 * cost of ignoring it is bounded by whoever is ignoring it.
 *
 * Where it repeats is the part that took a wrong turn first. Attaching it to
 * adapter tool calls put it on the hot path of ordinary work, which is both the
 * most annoying place for it and the least apt: an adapter call runs against the
 * browser and never touches the registry at all. It belongs on registry calls
 * only. Those are the ones where somebody is already dealing with this project
 * rather than with LinkedIn, and there are a handful of them per session instead
 * of one per action.
 *
 * Three properties hold it together, all enforced here:
 *
 *   - The line is short. It lands in context somebody is paying for.
 *   - Hiding is one call and it is permanent. Not a snooze, not a counter, not
 *     something that comes back next week when the file rotates.
 *   - It never implies a limit. A payment line in tool output reads as a wall
 *     unless it says otherwise, so it says otherwise.
 *
 * Nothing here can fail a tool call. Every path swallows its errors, because a
 * tip is not worth breaking somebody's actual work over.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Registry calls before it says anything at all.
 *
 * Small, and it has to be. Registry calls are not the hot path: someone might
 * search once, install twice and never call another one, so a threshold set for
 * adapter-call volume would mean the reminder never appears at all. This is only
 * here so the first search anybody runs is not met with a request for money.
 */
const WARMUP = 3;

const DEFAULT_REGISTRY = 'https://registry.yougotserved.dev';

interface SupportState {
  calls: number;
  hidden: boolean;
  hiddenAt?: string;
}

function configDir(): string {
  return process.env.YGS_ADAPTERS_DIR
    ? path.dirname(process.env.YGS_ADAPTERS_DIR)
    : path.join(os.homedir(), '.yougotserved');
}

function stateFile(): string {
  return path.join(configDir(), 'support.json');
}

function read(): SupportState {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile(), 'utf8')) as Partial<SupportState>;
    return {
      calls: Number.isFinite(parsed.calls) ? Number(parsed.calls) : 0,
      hidden: parsed.hidden === true,
      hiddenAt: parsed.hiddenAt,
    };
  } catch {
    return { calls: 0, hidden: false };
  }
}

function write(state: SupportState): void {
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(stateFile(), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // A counter that cannot be saved just means the count starts over, which is
    // a smaller problem than a failed tool call.
    //
    // Hiding fails the same way, and that one is worth being honest about: on a
    // read-only home directory the reminder cannot be turned off, because there
    // is nowhere to record that it was. `ygs_tip` says so rather than claiming
    // a success it did not have.
  }
}

export function registryUrl(): string {
  return (process.env.YGS_REGISTRY_URL || DEFAULT_REGISTRY).replace(/\/+$/, '');
}

/**
 * Counts one registry call, and returns the line to attach if there is one.
 *
 * One sentence, no prose. It rides on every registry result once the warmup is
 * past, so the design depends on it staying cheap enough to ignore.
 */
export function tipNote(): { tipJar: string } | null {
  if (process.env.YGS_NO_TIP_NUDGE) return null;

  const state = read();
  if (state.hidden) return null;

  state.calls += 1;
  write(state);
  if (state.calls < WARMUP) return null;

  return {
    tipJar: 'optional, nothing here is gated or rate limited. ygs_tip for how, or to hide this.',
  };
}

/**
 * Stops the reminder for good on this machine.
 *
 * Returns whether it stuck. A caller that is told this worked and then sees the
 * line again on the next call has been lied to, which is worse than the line.
 */
export function hideTip(): boolean {
  const state = read();
  state.hidden = true;
  state.hiddenAt = new Date().toISOString();
  write(state);
  return read().hidden;
}

/** Reads the state without changing it. For `ygs_tip` and for tests. */
export function supportState(): SupportState {
  return read();
}
