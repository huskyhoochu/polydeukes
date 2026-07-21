import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigValidationError } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// RED: `loadConfig` does not exist yet — the umbrella package currently exports nothing.
// This import is expected to fail resolution in the RED phase, taking the whole file with it.
import { loadConfig } from '../src/index.ts';

// ---------------------------------------------------------------------------
// CONFIG-03 §5.1 — the umbrella `loadConfig(rootDir)` loader.
//
// The loader is pure discovery + parse + delegation + self-protection attach: it
// finds ONE of the three candidate config files in the given rootDir, parses it with
// the `yaml` safe schema, strips a leading `$schema` key, hands the rest to core
// `defineConfig()`, and appends its own configPath to protectedPaths before returning.
//
// testCmd bodies here are deliberately FAKE runner strings ('fake-runner {scope}',
// never vitest/pytest/go test) so the core grep gate stays satisfied even inside
// fixtures. rootDirs are OS-tmpdir mkdtemp trees, torn down after each test.
// ---------------------------------------------------------------------------

/** Minimal valid config body (yaml) — one language with a {scope} template. */
const VALID_YAML = [
  'languages:',
  '  typescript:',
  "    productionGlob: 'packages/core/src/**/*'",
  "    testCmd: 'fake-runner {scope}'",
  '',
].join('\n');

/** The same minimal config expressed as JSON (YAML is a JSON superset — one parse path). */
const VALID_JSON = JSON.stringify({
  languages: {
    typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
  },
});

let rootDir: string;

beforeEach(() => {
  rootDir = mkdtempSync(join(tmpdir(), 'pdks-loadconfig-'));
});

afterEach(() => {
  rmSync(rootDir, { recursive: true, force: true });
});

/** Write a file directly under the temp rootDir. */
function writeInRoot(filename: string, contents: string): void {
  writeFileSync(join(rootDir, filename), contents);
}

describe('§5.1 discovery — the three candidate filenames', () => {
  it('discovers polydeukes.config.yaml and returns the resolved config plus its rootDir-relative path', () => {
    // AC §5.1 (item 1): yaml variant. `config` is the defineConfig resolution (compiled
    // testCmd callable), `configPath` is the bare filename relative to rootDir.
    // Mutation caught: a loader that returns the raw parsed object instead of the
    // defineConfig resolution (testCmd would still be a string, not callable).
    writeInRoot('polydeukes.config.yaml', VALID_YAML);

    const { config, configPath } = loadConfig(rootDir);

    expect(configPath).toBe('polydeukes.config.yaml');
    expect(config.languages.typescript.testCmd('pkg-a')).toBe('fake-runner pkg-a');
  });

  it('discovers the .yml variant', () => {
    // AC §5.1 (item 1): .yml is an accepted variant of the canonical .yaml name.
    writeInRoot('polydeukes.config.yml', VALID_YAML);

    const { configPath } = loadConfig(rootDir);

    expect(configPath).toBe('polydeukes.config.yml');
  });

  it('discovers the .json variant through the same parser', () => {
    // AC §5.1 (item 1): json is read by the same yaml parser (superset), no separate
    // branch. Mutation caught: a json-specific path that never runs, or a discovery
    // list missing the .json candidate.
    writeInRoot('polydeukes.config.json', VALID_JSON);

    const { config, configPath } = loadConfig(rootDir);

    expect(configPath).toBe('polydeukes.config.json');
    expect(config.languages.typescript.testCmd('pkg-b')).toBe('fake-runner pkg-b');
  });
});

describe('§5.1 fail-closed — no config, ambiguous config', () => {
  it('throws when zero config files exist, naming all three candidate filenames', () => {
    // AC §5.1 (item 2): silent defaults are forbidden — a missing config must fail loud.
    // Mutation caught: a loader that returns an empty/default config on absence, or an
    // error message that names fewer than all three candidates (a user would not know
    // which filenames are searched).
    let error: unknown;
    try {
      loadConfig(rootDir);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('polydeukes.config.yaml');
    expect(message).toContain('polydeukes.config.yml');
    expect(message).toContain('polydeukes.config.json');
  });

  it('throws when two config files coexist, naming the found files', () => {
    // AC §5.1 (item 3): ambiguity is fail-closed — the loader must not silently pick a
    // winner. Mutation caught: a first-match-wins discovery that stops after the first
    // candidate instead of detecting the collision.
    writeInRoot('polydeukes.config.yaml', VALID_YAML);
    writeInRoot('polydeukes.config.json', VALID_JSON);

    let error: unknown;
    try {
      loadConfig(rootDir);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('polydeukes.config.yaml');
    expect(message).toContain('polydeukes.config.json');
  });
});

describe('§5.1 parse failure — surfaced with file path', () => {
  it('throws on a YAML syntax error, including the file path in the message', () => {
    // AC §5.1 (item 4): a parse failure must name the offending file so the author can
    // find it. Mutation caught: a catch-all that swallows the parse error into a generic
    // message, or one that omits the path.
    writeInRoot('polydeukes.config.yaml', 'languages: [unterminated\n  broken: : :');

    let error: unknown;
    try {
      loadConfig(rootDir);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('polydeukes.config.yaml');
  });

  it('rejects a yaml custom tag without executing it (safe parsing)', () => {
    // AC §5.1 (item 7): the data-config invariant "must be uncomputable so it cannot
    // lie" is enforced at the parser level — a custom/unresolved tag must never be
    // resolved into an executable value; it must throw. Mutation caught: switching the
    // parser to a permissive schema that resolves custom tags (the security boundary of
    // config-as-data).
    writeInRoot('polydeukes.config.yaml', 'languages: !!js/function "return 1"');

    let error: unknown;
    try {
      loadConfig(rootDir);
    } catch (caught) {
      error = caught;
    }

    // Must throw a real parse/validation failure — NOT resolve the tag into a value, and
    // NOT (in RED) merely a "loadConfig is not a function" TypeError. Pinning that the
    // message names the config file keeps this test honest before AND after GREEN.
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('is not a function');
    expect((error as Error).message).toContain('polydeukes.config.yaml');
  });
});

describe('§5.1 validation delegation — ConfigValidationError with file context', () => {
  it('propagates ConfigValidationError with the file path when the config has an unknown top-level key', () => {
    // AC §5.1 (item 5): the loader owns no structural validation — it delegates to core
    // defineConfig, which rejects unknown keys, and re-throws WITH file-path context.
    // Mutation caught: a loader that catches and rethrows a plain Error (losing the
    // ConfigValidationError type), or one that drops the file-path context.
    writeInRoot(
      'polydeukes.config.yaml',
      [
        'languages:',
        '  typescript:',
        "    productionGlob: 'packages/core/src/**/*'",
        "    testCmd: 'fake-runner {scope}'",
        "unknownTopLevelKey: 'boom'",
        '',
      ].join('\n'),
    );

    let error: unknown;
    try {
      loadConfig(rootDir);
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(ConfigValidationError);
    expect((error as Error).message).toContain('polydeukes.config.yaml');
  });
});

describe('§5.1 self-protection — configPath auto-attached to protectedPaths', () => {
  it('appends the configPath to protectedPaths when the user did not list it', () => {
    // AC §5.1 (item 6): schema rule 6 — the discovered config file is itself part of the
    // protection surface, and the loader is the only place that can guarantee it. Here
    // the user listed a different path, so the loader must ADD configPath.
    // Mutation caught: a loader that returns config.protectedPaths untouched.
    writeInRoot(
      'polydeukes.config.yaml',
      [
        'languages:',
        '  typescript:',
        "    productionGlob: 'packages/core/src/**/*'",
        "    testCmd: 'fake-runner {scope}'",
        'protectedPaths:',
        "  - 'packages/core/src'",
        '',
      ].join('\n'),
    );

    const { config } = loadConfig(rootDir);

    expect(config.protectedPaths).toContain('polydeukes.config.yaml');
    expect(config.protectedPaths).toContain('packages/core/src');
  });

  it('does not duplicate the configPath when the user already listed it', () => {
    // AC §5.1 (item 6, second clause): idempotent self-protection — if the user already
    // registered the config file, the loader must not add a second copy.
    // Mutation caught: an unconditional push that appends configPath even when present.
    writeInRoot(
      'polydeukes.config.yaml',
      [
        'languages:',
        '  typescript:',
        "    productionGlob: 'packages/core/src/**/*'",
        "    testCmd: 'fake-runner {scope}'",
        'protectedPaths:',
        "  - 'polydeukes.config.yaml'",
        '',
      ].join('\n'),
    );

    const { config } = loadConfig(rootDir);

    const occurrences = (config.protectedPaths ?? []).filter((p) => p === 'polydeukes.config.yaml');
    expect(occurrences.length).toBe(1);
  });
});
