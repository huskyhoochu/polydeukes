import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// DIST-05 AC-1/AC-7 — the umbrella build's schema copy step (§3-b/§3-c). The copy exists
// because npm's `files` whitelist cannot reach outside the package directory, so the
// schema has to travel into `dist/` to ship at all; `copy-docs.mjs` solves the same
// problem the same way and this step matches its failure posture.
//
// Contract asserted (the implementer matches this script path and behaviour):
//   node packages/polydeukes/scripts/copy-schema.mjs
//     - reads `packages/core/schema/polydeukes.schema.json` (core owns the one source,
//       §5 invariant 2) and writes `packages/polydeukes/dist/schema/polydeukes.schema.json`.
//     - a missing source is FATAL: copyFileSync throws ENOENT and the script exits
//       non-zero, failing the build (§3-c). Skipping what is absent ships a package whose
//       `$schema` line points at nothing, and the consumer's editor says nothing at all.
//
// The script is driven as a spawned process rather than imported: its exit code IS the
// contract AC-7 names, and a build step that throws in-process would still leave a green
// import in a suite that only asserted on the thrown error.

const repoRoot = resolve(import.meta.dirname, '../../..');
const umbrellaRoot = resolve(import.meta.dirname, '..');

/** The copy script under test — the build step DIST-05 adds beside `copy-docs.mjs`. */
const COPY_SCRIPT = join(umbrellaRoot, 'scripts', 'copy-schema.mjs');
/** §3-b's source row: core's schema, the single origin. */
const SOURCE_REL = join('packages', 'core', 'schema', 'polydeukes.schema.json');
/** §3-b's build-output row, umbrella-package-relative. */
const OUTPUT_REL = join('dist', 'schema', 'polydeukes.schema.json');

/**
 * Run the copy script against a synthetic repository laid out like this one, so the
 * absent-source case can be built without removing anything from the working tree. The
 * script derives both roots from its own location (the `copy-docs.mjs` shape), so the
 * script is copied into the fixture's `packages/polydeukes/scripts/` and reads the
 * fixture's `packages/core/schema/` from there.
 */
function runInFixture(spec: { source: string | null; preexisting?: string[] }): {
  status: number | null;
  stderr: string;
  fixtureRoot: string;
} {
  const fixtureRoot = fixtureRoots[fixtureRoots.length - 1];
  const scriptCopy = join(fixtureRoot, 'packages', 'polydeukes', 'scripts', 'copy-schema.mjs');
  mkdirSync(dirname(scriptCopy), { recursive: true });
  writeFileSync(scriptCopy, readFileSync(COPY_SCRIPT, 'utf-8'));

  if (spec.source !== null) {
    const source = join(fixtureRoot, SOURCE_REL);
    mkdirSync(dirname(source), { recursive: true });
    writeFileSync(source, spec.source);
  }

  // Whatever the earlier build steps already put in `dist`, as umbrella-relative paths.
  for (const relative of spec.preexisting ?? []) {
    const path = join(fixtureRoot, 'packages', 'polydeukes', relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, 'built by an earlier step\n');
  }

  const result = spawnSync(process.execPath, [scriptCopy], { encoding: 'utf-8' });
  return { status: result.status, stderr: result.stderr, fixtureRoot };
}

const fixtureRoots: string[] = [];

beforeEach(() => {
  fixtureRoots.push(mkdtempSync(join(tmpdir(), 'pdks-copy-schema-')));
});

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('DIST-05 AC-1 — the umbrella build copies the core schema into dist', () => {
  it('writes dist/schema/polydeukes.schema.json byte-identical to the core source', () => {
    // Mutation caught: the copy transforming the file on its way through — a re-serialized
    // JSON.parse/stringify round trip, a rewritten `$schema`, an appended banner comment.
    // Any of those still produces a file at the right path, so a mere existence check goes
    // green while the editor validates against a schema that is no longer core's. §5
    // invariant 2 says the two files may only diverge by a build defect; byte equality is
    // the only assertion that states it.
    const source = readFileSync(join(repoRoot, SOURCE_REL));
    const { status, stderr, fixtureRoot } = runInFixture({ source: source.toString('utf-8') });

    expect(status, `copy stderr: ${stderr}`).toBe(0);
    const copied = readFileSync(join(fixtureRoot, 'packages', 'polydeukes', OUTPUT_REL));
    expect(copied.equals(source)).toBe(true);
  });

  it('leaves the rest of dist untouched', () => {
    // Mutation caught: a clearing step aimed at `dist` instead of `dist/schema`. The build
    // runs `tsc && copy-docs && copy-schema`, so by the time this step runs the directory
    // holds the compiled output and the bundled docs; widening the target erases both and
    // says nothing — `dist` is gitignored, and the next local build refills it. Only the
    // tarball shows the loss.
    const preexisting = [join('dist', 'bin.js'), join('dist', 'docs', 'installation.md')];
    const { status, stderr, fixtureRoot } = runInFixture({
      source: '{"a":1}\n',
      preexisting,
    });

    expect(status, `copy stderr: ${stderr}`).toBe(0);
    for (const relative of preexisting) {
      expect(
        existsSync(join(fixtureRoot, 'packages', 'polydeukes', relative)),
        `${relative} was removed by the copy step`,
      ).toBe(true);
    }
  });
});

describe('DIST-05 AC-7 — an absent source schema fails the build', () => {
  it('exits non-zero when the core schema is missing', () => {
    // Fail-open is the defect class here: a copy that skips what is absent exits 0, the
    // build goes green, and the tarball ships with no schema. Nothing downstream reports
    // it — `$schema` is a static string an editor reads, so the consumer sees validation
    // simply not happening rather than an error. Mutation caught: the copy wrapped in an
    // existsSync check, or in a try/catch that swallows ENOENT.
    const { status, stderr } = runInFixture({ source: null });

    expect(status).not.toBe(0);
    expect(stderr).toContain('ENOENT');
  });

  it('leaves no output file behind when the source is missing', () => {
    // Mutation caught: the step touching or truncating the destination before reading the
    // source. A zero-byte `dist/schema/polydeukes.schema.json` is worse than no file — the
    // path the consumer's `$schema` names exists, so the editor loads it and fails to
    // parse, and the earlier good copy from a cached build is gone.
    const { fixtureRoot } = runInFixture({ source: null });

    expect(() => readFileSync(join(fixtureRoot, 'packages', 'polydeukes', OUTPUT_REL))).toThrow();
  });
});
