import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants } from '../src/dispatch.ts';
import { inputWithArgs } from './helpers.js';

// `dispatchCovenants` takes the world axis as a spec field and attaches it to the parsed
// input the bodies judge: the composition roots hand over a string payload built by the
// adapter path and must not reopen it to splice `world` in. The same input object reaches
// the witness, so the valve judges the world the body judged.

// Subject and world contents are fixture values.
const SUBJECT = 'src/a.ts';
const WORLD: NonNullable<CovenantInput['world']> = {
  files: { 'locales/en.json': '{"a":1}' },
  changes: ['docs/a.md', 'docs/a.ko.md'],
};

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-dispatch-world-'));
  telemetryPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A routed registration whose body (and witness, when breaking) records the input it saw. */
function recording(exitCode: 0 | 1) {
  const seen: { body?: CovenantInput; witness?: CovenantInput } = {};
  const registration: CovenantRegistration = {
    label: 'recording',
    protectedPaths: [],
    matches: () => SUBJECT,
    body: async (input) => {
      seen.body = input;
      return exitCode === 0 ? { exitCode } : { exitCode, reason: 'broken' };
    },
    witness: (input) => {
      seen.witness = input;
      return false;
    },
  };
  return { registration, seen };
}

describe('dispatchCovenants — the world axis rides the spec onto the parsed input', () => {
  it('spec.world wins over a world the payload already carries; a payload-only world is kept', async () => {
    // The composition roots always pass the supply layer's result, so a `world` inside the
    // payload string can never stand in for it; an embedder driving the stdin protocol with
    // no root supplies its world through the payload, and that is honoured.
    const carried: CovenantInput['world'] = { files: { 'locales/en.json': 'payload' } };
    const first = recording(0);
    await dispatchCovenants({
      stdinPayload: JSON.stringify({ ...inputWithArgs({ file_path: SUBJECT }), world: carried }),
      registrations: [first.registration],
      telemetryPath,
      world: WORLD,
    });
    expect(first.seen.body?.world).toEqual(WORLD);

    const second = recording(0);
    await dispatchCovenants({
      stdinPayload: JSON.stringify({ ...inputWithArgs({ file_path: SUBJECT }), world: carried }),
      registrations: [second.registration],
      telemetryPath,
    });
    expect(second.seen.body?.world).toEqual(carried);
  });

  it('the body sees spec.world as input.world, deep-equal', async () => {
    // Dropping the field leaves every `sources` declaration absent-sourced (2 under
    // `error`), and every commit-surface `changes` list collapses to one path.
    const { registration, seen } = recording(0);

    await dispatchCovenants({
      stdinPayload: JSON.stringify(inputWithArgs({ file_path: SUBJECT })),
      registrations: [registration],
      telemetryPath,
      world: WORLD,
    });

    expect(seen.body?.world).toEqual(WORLD);
  });

  it('without spec.world the body sees input.world undefined', async () => {
    // A default `{}` or `{ files: {} }` is not absence: a root that meant "no supply"
    // must not read as "supplied nothing" — the derivation of `changes` keys off the
    // field's absence, and an empty object here would make the check meaningless.
    const { registration, seen } = recording(0);

    await dispatchCovenants({
      stdinPayload: JSON.stringify(inputWithArgs({ file_path: SUBJECT })),
      registrations: [registration],
      telemetryPath,
    });

    expect(seen.body).toBeDefined();
    expect(seen.body?.world).toBeUndefined();
  });

  it('the witness receives the same input object the body judged, world included', async () => {
    // The declare registration caches its judgment by input identity; a witness handed a
    // second object (or one without `world`) re-judges an absent-sourced world, reads
    // unjudgeable, and the valve stays shut on a break the human could have witnessed.
    const { registration, seen } = recording(1);

    await dispatchCovenants({
      stdinPayload: JSON.stringify(inputWithArgs({ file_path: SUBJECT })),
      registrations: [registration],
      telemetryPath,
      world: WORLD,
    });

    expect(seen.witness).toBeDefined();
    expect(seen.witness).toBe(seen.body);
    expect(seen.witness?.world).toEqual(WORLD);
  });
});
