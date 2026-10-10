import { type SpawnSyncReturns, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { telemetryRows } from './helpers.ts';

// The single executable and `node dist/bin.js` are the same umbrella, so on one fixed input
// they answer the same stdout, stderr, and exit code. Each case runs both against its own
// copy of a fixture tree that holds no `node_modules`: the executable carries memory and the
// Korean analyzer inside itself, and the JS path resolves them through this workspace. The
// executable is the one `PDKS_SEA` names, or the one the build script writes to a temp path.

const BIN = resolve(import.meta.dirname, '../dist/bin.js');
const BUILD_SCRIPT = resolve(import.meta.dirname, '../scripts/build-sea.mjs');
const PACKAGE_DIR = resolve(import.meta.dirname, '..');
/** Copying the node binary and injecting the blob takes well over the default timeout. */
const BUILD_TIMEOUT_MS = 180_000;

/** Injected fixture values — the host's shell tool and the command the discipline forbids. */
const SHELL_TOOL = 'shell';
const COMMAND_ARG = 'command';
const TOOLS = { mutating: [], shell: [SHELL_TOOL], commandArgs: [COMMAND_ARG] };
const DISCIPLINE_ID = 'hardly-held-command';
const FORBIDDEN_COMMAND = 'zzz_probe_cmd';
const WHY = 'the probe command reshapes state no review has seen';
const PASSING_COMMAND = 'echo hello';
const BREAKING_COMMAND = `${FORBIDDEN_COMMAND} --run`;
/** A shell call changes no file, so its telemetry subject is `-`. */
const SHELL_SUBJECT = '-';
const TELEMETRY_REL = 'roi.log';
const DB_REL = '.polydeukes/memory.db';
/**
 * A section holding `훅이` and `막은`: neither query word below is in it as written, so a
 * search that reaches it went through the analyzer, which the executable must carry.
 */
const KOREAN_DOC_REL = 'notes/hooks.md';
const KOREAN_DOC_TEXT =
  '---\ntitle: Hooks\ntype: note\n---\n## One\n\n세션 훅이 막은 호출의 기록.\n';
const KOREAN_SECTION_ID = 'notes/hooks#one';
const KOREAN_QUERY = ['훅을', '막는'];
/** A document id in the bundled catalog. */
const DOC_ID = 'cli-docs';
/** The version `docs show --json` reports: the umbrella's own manifest. */
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf-8')) as { version: string }
).version;

const config = (telemetryPath: string): string => `languages:
  typescript:
    productionGlob: lib/**/*.ts
    testCmd: echo {scope}
telemetry:
  logPath: ${telemetryPath}
sessionDisciplines:
  - id: ${DISCIPLINE_ID}
    why: ${WHY}
    enforce: block
    declare:
      mechanism: forbidden-command
      scope:
        source: ${COMMAND_ARG}
      extract:
        hits:
          - op: source
            of: ${COMMAND_ARG}
          - op: lines
          - op: matches
            re: ${FORBIDDEN_COMMAND}
      relate:
        - id: no-probe
          relation:
            op: empty
            of: hits
          message: "{value}"
memory:
  include:
    - notes/**/*.md
`;

function shellIr(command: string): CovenantInput {
  return {
    toolCalls: [{ name: SHELL_TOOL, args: { [COMMAND_ARG]: command } }],
    subagentSpawns: [],
    userMessages: [],
    tools: TOOLS,
  };
}

type Runner = {
  root: string;
  telemetryPath: string;
  run: (args: string[], input?: string, env?: Record<string, string>) => SpawnSyncReturns<string>;
};

let executable: string;
let buildDir: string | undefined;
let js: Runner;
let sea: Runner;

beforeAll(() => {
  if (process.env.PDKS_SEA !== undefined) {
    executable = process.env.PDKS_SEA;
    return;
  }
  buildDir = mkdtempSync(join(tmpdir(), 'pdks-sea-build-'));
  executable = join(buildDir, 'pdks');
  const built = spawnSync(process.execPath, [BUILD_SCRIPT, executable], {
    cwd: PACKAGE_DIR,
    encoding: 'utf-8',
  });
  if (built.status !== 0) {
    throw new Error(`build-sea.mjs exited ${built.status}: ${built.stderr}`);
  }
}, BUILD_TIMEOUT_MS);

/** A fixture tree of its own per runner, so neither reads an index or a log the other wrote. */
function makeRunner(command: string, leadingArgs: string[]): Runner {
  const root = mkdtempSync(join(tmpdir(), 'pdks-sea-e2e-'));
  const telemetryPath = join(root, TELEMETRY_REL);
  writeFileSync(join(root, 'polydeukes.config.yaml'), config(telemetryPath));
  mkdirSync(dirname(join(root, KOREAN_DOC_REL)), { recursive: true });
  writeFileSync(join(root, KOREAN_DOC_REL), KOREAN_DOC_TEXT);
  return {
    root,
    telemetryPath,
    run: (args, input = '', env = {}) =>
      spawnSync(command, [...leadingArgs, ...args], {
        cwd: root,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        input,
        env: { ...process.env, ...env },
      }),
  };
}

beforeEach(() => {
  js = makeRunner(process.execPath, [BIN]);
  sea = makeRunner(executable, []);
  expect(existsSync(join(js.root, 'node_modules'))).toBe(false);
  expect(existsSync(join(sea.root, 'node_modules'))).toBe(false);
});

afterEach(() => {
  rmSync(js.root, { recursive: true, force: true });
  rmSync(sea.root, { recursive: true, force: true });
});

function checkArgs(runner: Runner): string[] {
  return ['covenant', 'check', '--enforce', 'block', '--telemetry-path', runner.telemetryPath];
}

function ingested(runner: Runner): void {
  const result = runner.run(['memory', 'ingest']);
  if (result.status !== 0) throw new Error(`fixture ingest failed: ${result.stderr}`);
}

describe('the executable answers as node dist/bin.js does', () => {
  // An executable whose bundle fails to import exits 2 before any judgment; one that judged
  // but could not read the config fails closed under the runner's own label. The row under
  // the discipline id is what says the discipline itself passed the call on both paths.
  it('covenant check on a passing IR exits 0 on both with the same streams and a passed row', () => {
    const input = JSON.stringify(shellIr(PASSING_COMMAND));

    const fromJs = js.run(checkArgs(js), input);
    const fromSea = sea.run(checkArgs(sea), input);

    expect(fromJs.status, fromJs.stderr).toBe(0);
    expect(fromSea.status, fromSea.stderr).toBe(0);
    expect(fromSea.stdout).toBe(fromJs.stdout);
    expect(fromSea.stderr).toBe(fromJs.stderr);
    expect(telemetryRows(js.telemetryPath)).toEqual([['passed', DISCIPLINE_ID, SHELL_SUBJECT]]);
    expect(telemetryRows(sea.telemetryPath)).toEqual(telemetryRows(js.telemetryPath));
  });

  // Exit 2 alone is also what a crashed bundle leaves, so the stderr must carry the why and
  // the row must sit under the discipline id: a break judged, not an executable that failed.
  it('covenant check on a breaking IR exits 2 on both with the same stderr and a blocked row', () => {
    const input = JSON.stringify(shellIr(BREAKING_COMMAND));

    const fromJs = js.run(checkArgs(js), input);
    const fromSea = sea.run(checkArgs(sea), input);

    expect(fromJs.status).toBe(2);
    expect(fromSea.status).toBe(2);
    expect(fromJs.stderr).toContain(WHY);
    expect(fromSea.stderr).toBe(fromJs.stderr);
    expect(fromSea.stdout).toBe(fromJs.stdout);
    expect(telemetryRows(js.telemetryPath)).toEqual([['blocked', DISCIPLINE_ID, SHELL_SUBJECT]]);
    expect(telemetryRows(sea.telemetryPath)).toEqual(telemetryRows(js.telemetryPath));
  });

  // The tree has no `@polydeukes/memory` install: an executable that still runs the install
  // check prints the install hint and exits 2 here, and one that resolves memory through
  // the filesystem instead of its bundle finds nothing. Each path writes its own index.
  it('memory ingest exits 0 on both with the same stdout and an index in each tree', () => {
    const fromJs = js.run(['memory', 'ingest']);
    const fromSea = sea.run(['memory', 'ingest']);

    expect(fromJs.status, fromJs.stderr).toBe(0);
    expect(fromSea.status, fromSea.stderr).toBe(0);
    expect(fromJs.stdout).toMatch(/^indexed 1 document/);
    expect(fromSea.stdout).toBe(fromJs.stdout);
    expect(fromSea.stderr).toBe(fromJs.stderr);
    expect(existsSync(join(js.root, DB_REL))).toBe(true);
    expect(existsSync(join(sea.root, DB_REL))).toBe(true);
  });

  // Neither query word is in the document as written, so an executable whose analyzer
  // cannot load its wasm or model from the bundle answers an empty list or exits 2; one
  // whose loader lets a deprecation line through differs on stderr.
  it('memory search with a Korean query answers the same non-empty results on both', () => {
    ingested(js);
    ingested(sea);

    const fromJs = js.run(['memory', 'search', ...KOREAN_QUERY, '--json']);
    const fromSea = sea.run(['memory', 'search', ...KOREAN_QUERY, '--json']);

    expect(fromJs.status, fromJs.stderr).toBe(0);
    expect(fromSea.status, fromSea.stderr).toBe(0);
    expect(fromSea.stderr).toBe(fromJs.stderr);
    const jsResults = JSON.parse(fromJs.stdout).results;
    const seaResults = JSON.parse(fromSea.stdout).results;
    expect(jsResults.map((hit: { id: string }) => hit.id)).toEqual([KOREAN_SECTION_ID]);
    expect(seaResults).toEqual(jsResults);
  });

  // Inside the executable `import.meta.url` is a `data:` URL, so a docs root computed from
  // it names no directory: exit 2 and an empty stdout. The executable writes the bundled
  // documents into a private directory under `TMPDIR` for one call and removes it, so a
  // fresh `TMPDIR` is empty again after each call; a directory kept across calls would serve
  // what another user or an older build left there. `packageVersion` in the JSON is the
  // version the executable read from its own manifest — a `data:` URL walked for
  // `../../package.json` yields none.
  it('docs show <id> --json prints the same document and version on both, leaving nothing behind', () => {
    const seaTmp = mkdtempSync(join(tmpdir(), 'pdks-sea-docs-tmp-'));

    const fromJs = js.run(['docs', 'show', DOC_ID, '--json']);
    const firstSea = sea.run(['docs', 'show', DOC_ID, '--json'], '', { TMPDIR: seaTmp });
    const leftAfterFirst = readdirSync(seaTmp);
    const secondSea = sea.run(['docs', 'show', DOC_ID, '--json'], '', { TMPDIR: seaTmp });
    const leftAfterSecond = readdirSync(seaTmp);
    rmSync(seaTmp, { recursive: true, force: true });

    expect(fromJs.status, fromJs.stderr).toBe(0);
    expect(JSON.parse(fromJs.stdout)).toMatchObject({
      documentId: DOC_ID,
      packageVersion: PACKAGE_VERSION,
    });
    expect(firstSea.status, firstSea.stderr).toBe(0);
    expect(firstSea.stdout).toBe(fromJs.stdout);
    expect(firstSea.stderr).toBe(fromJs.stderr);
    expect(leftAfterFirst).toEqual([]);
    expect(secondSea.status, secondSea.stderr).toBe(0);
    expect(secondSea.stdout).toBe(fromJs.stdout);
    expect(leftAfterSecond).toEqual([]);
  });
});

afterAll(() => {
  if (buildDir !== undefined) rmSync(buildDir, { recursive: true, force: true });
});
