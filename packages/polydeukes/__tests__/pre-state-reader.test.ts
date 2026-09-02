import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessionPreStateReader, unobservedPreStateReader } from '../src/pre-state-reader.ts';

// The shipped readers, executed. The judge's own suites drive this contract through their
// own restated copy — covenant may not import the umbrella — so without this file the
// symbols the composition roots actually inject run in no test at all, and a fail-open
// mutant of the ENOENT branch survives the whole repository.
//
// The tri-state is what these cases pin. Each answer means something different downstream:
// text is a modify carrying that pre, `null` is a create, and `undefined` is a location
// that could not be read, which the judge escalates to the fail-closed exit rather than
// recording the call as passed.

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-pre-state-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('sessionPreStateReader — the session surface reads the working tree', () => {
  it('answers the file content, byte for byte', () => {
    // The content becomes the `pre` of a modify, and the delta family forgives exactly what
    // it already contains — a reader that normalized or trimmed would forgive the wrong set.
    const path = join(dir, 'target.ts');
    writeFileSync(path, 'first\nsecond\n');

    expect(sessionPreStateReader(path)).toBe('first\nsecond\n');
  });

  it('answers an empty string for an empty file, not null', () => {
    // `''` and `null` are different facts — an existing empty file is a modify, an absent
    // one is a create. Collapsing them makes a truncate look like a fresh write.
    const path = join(dir, 'empty.ts');
    writeFileSync(path, '');

    expect(sessionPreStateReader(path)).toBe('');
  });

  it('answers null for a file that is not there', () => {
    // ENOENT is the create signal. Answering `undefined` here would make every new file
    // unjudgeable, blocking writes the covenants were never meant to stop.
    expect(sessionPreStateReader(join(dir, 'absent.ts'))).toBeNull();
  });

  it('answers undefined for a location that cannot be read at all', () => {
    // A path whose parent is a file yields ENOTDIR, standing for the whole class of
    // unreadable locations (permission errors, races). This must NOT collapse into `null`:
    // routing has already matched, so a create verdict here records an unreadable
    // pre-state as `passed` — the fail-open this reader's tri-state exists to prevent.
    const blocker = join(dir, 'blocker.txt');
    writeFileSync(blocker, 'not a directory');

    expect(sessionPreStateReader(join(blocker, 'inside.ts'))).toBeUndefined();
  });

  it('answers undefined for a directory, which is not an empty file', () => {
    // Reading a directory yields EISDIR. The same discrimination as above from the other
    // side: a directory is unreadable-as-a-file, never content and never absence.
    const path = join(dir, 'a-directory');
    mkdirSync(path);

    expect(sessionPreStateReader(path)).toBeUndefined();
  });
});

describe('unobservedPreStateReader — the commit surface cannot answer', () => {
  it('answers undefined for any location, including one that exists', () => {
    // That surface judges a staged diff, whose payloads carry the `pre` their own
    // observation saw. Answering from the working tree would compare the diff against the
    // wrong baseline, so this reader fails closed on every path rather than reading one.
    const path = join(dir, 'present.ts');
    writeFileSync(path, 'staged content');

    expect(unobservedPreStateReader()).toBeUndefined();
  });
});
