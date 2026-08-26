import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigValidationError } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/index.ts';

// The umbrella `loadConfig(rootDir)` loader: discovery + parse + delegation +
// self-protection attach.
//
// testCmd bodies here are deliberately FAKE runner strings ('fake-runner {scope}', never
// vitest/pytest/go test) so the core grep covenant stays satisfied even inside fixtures.
// rootDirs are OS-tmpdir mkdtemp trees, torn down after each test.

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

describe('discovery — the three candidate filenames', () => {
  it('discovers polydeukes.config.yaml and returns the resolved config plus its rootDir-relative path', () => {
    // `config` is the defineConfig resolution, so testCmd is callable. A loader returning
    // the raw parsed object would leave it a string.
    writeInRoot('polydeukes.config.yaml', VALID_YAML);

    const { config, configPath } = loadConfig(rootDir);

    expect(configPath).toBe('polydeukes.config.yaml');
    expect(config.languages.typescript.testCmd('pkg-a')).toBe('fake-runner pkg-a');
  });

  it('discovers the .yml variant', () => {
    writeInRoot('polydeukes.config.yml', VALID_YAML);

    const { configPath } = loadConfig(rootDir);

    expect(configPath).toBe('polydeukes.config.yml');
  });

  it('discovers the .json variant through the same parser', () => {
    // JSON is read by the same yaml parser (YAML is a superset), so there is no separate
    // branch — only the discovery list has to carry the .json candidate.
    writeInRoot('polydeukes.config.json', VALID_JSON);

    const { config, configPath } = loadConfig(rootDir);

    expect(configPath).toBe('polydeukes.config.json');
    expect(config.languages.typescript.testCmd('pkg-b')).toBe('fake-runner pkg-b');
  });
});

describe('fail-closed — no config, ambiguous config', () => {
  it('throws when zero config files exist, naming all three candidate filenames', () => {
    // Silent defaults are forbidden — a missing config must fail loud, and the message
    // must name all three candidates or a user cannot tell which filenames are searched.
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
    // Ambiguity is fail-closed — the loader must not silently pick a winner. A
    // first-match-wins discovery would stop before detecting the collision.
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

describe('parse failure — surfaced with file path', () => {
  it('throws on a YAML syntax error, including the file path in the message', () => {
    // A parse failure must name the offending file so the author can find it — never a
    // generic message, and never one that omits the path.
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
    // Config data must be uncomputable so it cannot lie, and that is enforced at the
    // parser level: a custom or unresolved tag must throw, never resolve into an
    // executable value. A permissive parser schema would resolve custom tags and cross
    // the config-as-data boundary.
    writeInRoot('polydeukes.config.yaml', 'languages: !!js/function "return 1"');

    let error: unknown;
    try {
      loadConfig(rootDir);
    } catch (caught) {
      error = caught;
    }

    // Must throw a real parse or validation failure, never resolve the tag into a value.
    // Pinning that the message names the config file is what distinguishes the two.
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain('is not a function');
    expect((error as Error).message).toContain('polydeukes.config.yaml');
  });
});

describe('validation delegation — ConfigValidationError with file context', () => {
  it('propagates ConfigValidationError with the file path when the config has an unknown top-level key', () => {
    // The loader owns no structural validation — it delegates to core defineConfig and
    // re-throws WITH file-path context. Rethrowing a plain Error would lose the
    // ConfigValidationError type that callers discriminate on.
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

describe('self-protection — configPath auto-attached to protectedPaths', () => {
  it('appends the configPath to protectedPaths when the user did not list it', () => {
    // The discovered config file is itself part of the protection surface, and the loader
    // is the only place that can guarantee it. Here the user listed a different path, so
    // the loader must ADD configPath rather than return the list untouched.
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
    // Idempotent self-protection: a user who already registered the config file must not
    // get a second copy from an unconditional push.
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
