import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The umbrella build's schema copy step. The copy exists because npm's `files` whitelist
// cannot reach outside the package directory, so the schema has to travel into `dist/` to
// ship at all; `copy-docs.mjs` solves the same problem the same way and this step matches
// its failure posture.
//
// A missing source is FATAL: the script exits non-zero and fails the build. Skipping what
// is absent would ship a package whose `$schema` line points at nothing, and the consumer's
// editor would say nothing at all.
//
// The script is driven as a spawned process rather than imported: its exit code IS the
// contract, and a build step that throws in-process would still leave a green import in a
// suite that only asserted on the thrown error.

const repoRoot = resolve(import.meta.dirname, '../../..');
const umbrellaRoot = resolve(import.meta.dirname, '..');

/** The copy script under test — the build step beside `copy-docs.mjs`. */
const COPY_SCRIPT = join(umbrellaRoot, 'scripts', 'copy-schema.mjs');
/** Core's schema, the single origin. */
const SOURCE_REL = join('packages', 'core', 'schema', 'polydeukes.schema.json');
/** The build output, umbrella-package-relative. */
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
    // A copy that transforms what passes through it — a JSON.parse/stringify round trip,
    // an appended banner — still produces a file at the right path, so an existence check
    // goes green while an editor validates against something that is no longer the schema.
    //
    // The fixture supplies the source, so this measures the step in isolation: bytes in
    // equal bytes out, not that the step read core's file. That the shipped copy matches
    // core's own is asserted on the installed tree in clean-install.e2e, where the two
    // files arrive from separately packed tarballs.
    const source = readFileSync(join(repoRoot, SOURCE_REL));
    const { status, stderr, fixtureRoot } = runInFixture({ source: source.toString('utf-8') });

    expect(status, `copy stderr: ${stderr}`).toBe(0);
    const copied = readFileSync(join(fixtureRoot, 'packages', 'polydeukes', OUTPUT_REL));
    expect(copied.equals(source)).toBe(true);
  });

  it('leaves the rest of dist untouched', () => {
    // A clearing step aimed at `dist` instead of `dist/schema` erases the compiled output
    // and the bundled docs, which are already there by the time this step runs, and says
    // nothing — `dist` is gitignored and the next local build refills it. Only the tarball
    // would show the loss.
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
    // Fail-open is the defect class here: a copy wrapped in an existsSync check, or a
    // try/catch swallowing ENOENT, exits 0, the build goes green, and the tarball ships
    // with no schema. Nothing downstream reports it — `$schema` is a static string an
    // editor reads, so the consumer sees validation simply not happening.
    const { status, stderr } = runInFixture({ source: null });

    expect(status).not.toBe(0);
    expect(stderr).toContain('ENOENT');
  });

  it('leaves no output file behind when the source is missing', () => {
    // A step that truncates the destination before reading the source leaves a zero-byte
    // schema, which is worse than no file: the path the consumer's `$schema` names exists,
    // so the editor loads it and fails to parse, and the earlier good copy is gone.
    const { status, fixtureRoot } = runInFixture({ source: null });

    expect(status).not.toBe(0);
    expect(() => readFileSync(join(fixtureRoot, 'packages', 'polydeukes', OUTPUT_REL))).toThrow();
  });
});
