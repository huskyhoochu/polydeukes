import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/index.ts';

// ---------------------------------------------------------------------------
// CONFIG-09 §4.3 / AC-6 — loadConfig parse diagnostics. A file with n parse
// problems must surface ALL n in one thrown message (per-problem parser location
// preserved), so the author fixes the file in one pass instead of n fix-rerun
// loops. The single-problem message keeps its current shape
// (`failed to parse <path>: <message>`).
//
// The two-problem fixture carries two structurally different yaml errors with
// distinct texts (probed against yaml@2.9.0): a DUPLICATE_KEY ("Map keys must be
// unique", line 2) and a BAD_INDENT ("Flow sequence in block collection must be
// sufficiently indented and end with a ]", line 3).
// ---------------------------------------------------------------------------

const TWO_PROBLEM_YAML = 'a: 1\na: [1, 2\nb: 3\n';
const ONE_PROBLEM_YAML = 'languages: [1, 2\n';

let rootDir: string;

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'pdks-diagnostics-'));
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

/** Write the yaml config into the temp root and capture what loadConfig throws. */
function loadAndCatch(contents: string): Error {
  writeFileSync(join(rootDir, 'polydeukes.config.yaml'), contents);
  let error: unknown;
  try {
    loadConfig(rootDir);
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(Error);
  return error as Error;
}

describe('§4.3 parse diagnostics — every problem enumerated (AC-6)', () => {
  it('carries BOTH problem messages when the yaml has two parse problems', () => {
    // P0 (AC-6): a truncated report costs one fix-rerun loop per hidden problem.
    // Mutation caught: reporting problems[0] only — the second (BAD_INDENT) text
    // never appears in the first problem's message or its code frame.
    const error = loadAndCatch(TWO_PROBLEM_YAML);

    expect(error.message).toContain('polydeukes.config.yaml');
    expect(error.message).toContain('Map keys must be unique');
    expect(error.message).toContain(
      'Flow sequence in block collection must be sufficiently indented and end with a ]',
    );
  });

  it('enumerates a warning alongside an error (unresolved tags arrive as warnings)', () => {
    // Coverage-gap fixture (documented-trap mirror, config-and-schema rule): an
    // unresolved custom tag surfaces as a WARNING, not a parse error, and the loader
    // merges [...errors, ...warnings]. Mutation caught: enumerating doc.errors only —
    // the warning text vanishes while the throw (driven by the error) still happens.
    // Texts probed against yaml@2.9.0.
    const error = loadAndCatch('a: !custom 1\na: 2\n');

    expect(error.message).toContain('Map keys must be unique');
    expect(error.message).toContain('Unresolved tag: !custom');
  });

  it('keeps the current single-problem message shape (failed to parse <path>: <message>)', () => {
    // P0 regression net (§4.3): the enumeration widens the n>1 case only — a lone
    // problem keeps the established shape downstream tooling reads today. Mutation
    // caught: the reshaping leaking into the n=1 path (a count header or list framing
    // replacing the direct message).
    const error = loadAndCatch(ONE_PROBLEM_YAML);

    expect(error.message).toMatch(/failed to parse .*polydeukes\.config\.yaml: /);
    expect(error.message).toContain(
      'Flow sequence in block collection must be sufficiently indented and end with a ]',
    );
  });
});
