/**
 * The one property that matters: it asks once, ever.
 *
 * Everything else about a tip nudge is taste. "Once" is the promise the message
 * itself makes out loud, so a regression here would make the product a liar
 * rather than merely annoying.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { noteAdapterCall, supportState } from './support';

const THRESHOLD = 50;
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ygs-support-'));
  // The module derives its config directory from the parent of this, matching
  // how the adapters directory is configured everywhere else.
  process.env.YGS_ADAPTERS_DIR = path.join(dir, 'adapters');
  delete process.env.YGS_NO_TIP_NUDGE;
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.YGS_ADAPTERS_DIR;
  delete process.env.YGS_NO_TIP_NUDGE;
});

describe('noteAdapterCall', () => {
  it('says nothing before the work has been done', () => {
    for (let i = 0; i < THRESHOLD - 1; i++) expect(noteAdapterCall()).toBeNull();
    expect(supportState().calls).toBe(THRESHOLD - 1);
  });

  it('asks on the call that crosses the line, and never again', () => {
    for (let i = 0; i < THRESHOLD - 1; i++) noteAdapterCall();

    const asked = noteAdapterCall();
    expect(asked).not.toBeNull();
    expect(asked!.support).toContain('/api/tip');
    // The message promises this out loud, so it is worth asserting.
    expect(asked!.support).toContain('will not appear again');

    for (let i = 0; i < 200; i++) expect(noteAdapterCall()).toBeNull();
    expect(supportState().asked).toBe(true);
  });

  it('stays quiet entirely when asked to', () => {
    process.env.YGS_NO_TIP_NUDGE = '1';
    for (let i = 0; i < THRESHOLD + 5; i++) expect(noteAdapterCall()).toBeNull();
    // And does not even keep a count, so opting out leaves nothing behind.
    expect(supportState().calls).toBe(0);
  });

  it('survives a corrupt state file rather than failing the tool call', () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'support.json'), 'not json at all');
    expect(() => noteAdapterCall()).not.toThrow();
    expect(supportState().calls).toBe(1);
  });
});
