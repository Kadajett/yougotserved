/**
 * The two properties the design rests on: it keeps asking, and one call ends it.
 *
 * Either half alone is a worse product. Asking once is missable; asking forever
 * with no way out is the thing everyone hates. Both are asserted here because
 * the reminder tells the reader that hiding is permanent, and a regression would
 * make that a lie rather than merely an annoyance.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { hideTip, supportState, tipNote } from './support';

const WARMUP = 3;
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ygs-support-'));
  // The module takes its config directory from the parent of this, matching how
  // the adapters directory is configured everywhere else.
  process.env.YGS_ADAPTERS_DIR = path.join(dir, 'adapters');
  delete process.env.YGS_NO_TIP_NUDGE;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.YGS_ADAPTERS_DIR;
  delete process.env.YGS_NO_TIP_NUDGE;
});

describe('tipNote', () => {
  it('says nothing on the first calls, so a first search is not met with this', () => {
    for (let i = 0; i < WARMUP - 1; i++) expect(tipNote()).toBeNull();
    expect(supportState().calls).toBe(WARMUP - 1);
  });

  it('keeps asking once the warmup is past, rather than firing once', () => {
    for (let i = 0; i < WARMUP - 1; i++) tipNote();

    for (let i = 0; i < 25; i++) {
      const note = tipNote();
      expect(note).not.toBeNull();
      expect(note!.tipJar).toContain('ygs_tip');
      // The line has to say this every time. In tool output a payment mention
      // reads as a wall being hit unless it explicitly says it is not one.
      expect(note!.tipJar).toContain('nothing here is gated');
    }
  });

  it('stops for good the moment something hides it', () => {
    for (let i = 0; i < WARMUP + 5; i++) tipNote();
    expect(hideTip()).toBe(true);

    for (let i = 0; i < 100; i++) expect(tipNote()).toBeNull();
    expect(supportState().hidden).toBe(true);
    expect(supportState().hiddenAt).toBeTruthy();
  });

  it('survives a restart, since the state is on disk and not in memory', () => {
    hideTip();
    // A fresh read is what the next process would do.
    expect(supportState().hidden).toBe(true);
    expect(tipNote()).toBeNull();
  });

  it('stays quiet entirely when the environment says so', () => {
    process.env.YGS_NO_TIP_NUDGE = '1';
    for (let i = 0; i < WARMUP + 5; i++) expect(tipNote()).toBeNull();
    // And keeps no count, so opting out leaves nothing behind.
    expect(supportState().calls).toBe(0);
  });

  it('survives a corrupt state file rather than failing the tool call', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'support.json'), 'not json at all');
    expect(() => tipNote()).not.toThrow();
    expect(supportState().calls).toBe(1);
  });
});
