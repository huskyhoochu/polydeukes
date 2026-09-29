import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The built bin with `--config-layer <path>` and `--telemetry-path <path>`: a fixture tree
// carrying the target config, and a layer file OUTSIDE that tree carrying one session entry
// the target does not have. Only a real spawn proves the flags reach the runner — that the
// layer's entry judges and its row lands where the flag says — and that the argv table
// refuses a repeated flag, a missing value, or a value that is itself a flag.
import { telemetryRows, writeConfigAt } from './helpers.ts';

const BIN = resolve(import.meta.dirname, '../dist/bin.js');

/** Injected fixture values. */
const LAYER_FILE = 'discipline-layer.json';
const SHELL_TOOL = 'shell-tool';
const EDIT_TOOL = 'edit-tool';
const COMMAND_ARG = 'command';
const TOOLS = { mutating: [EDIT_TOOL], shell: [SHELL_TOOL], commandArgs: [COMMAND_ARG] };
/** The layer's entry and the command it forbids. */
const LAYER_ID = 'host-no-flushall';
const LAYER_WHY = 'a cache flush in a shared environment erases every other tenant’s state';
const FORBIDDEN_COMMAND = 'redis-cli FLUSHALL';
const ORDINARY_COMMAND = 'redis-cli PING';
/** The runner's own label — the row a run that failed closed before judging writes. */
const CHECK_LABEL = 'covenant-check';
/** The subject a shell call that changes no file carries, and a fail-closed run's. */
const NO_SUBJECT = '-';

let projectRoot: string;
/** The layer and both telemetry files live outside the judged tree. */
let outside: string;
let layerPath: string;
/** Where the target config sends rows. */
let configLogPath: string;
/** Where `--telemetry-path` sends rows. */
let flagLogPath: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pdks-config-layer-e2e-'));
  outside = mkdtempSync(join(tmpdir(), 'pdks-config-layer-e2e-outside-'));
  layerPath = join(outside, LAYER_FILE);
  configLogPath = join(outside, 'config-roi.log');
  flagLogPath = join(outside, 'flag-roi.log');
  writeConfigAt(projectRoot, configLogPath, {});
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

/** A command entry forbidding `re` on the command line, at the default (advise) level. */
function commandEntry(id: string, re: string) {
  return {
    id,
    why: LAYER_WHY,
    declare: {
      mechanism: 'forbidden-command',
      scope: { source: COMMAND_ARG },
      extract: {
        hits: [{ op: 'source', of: COMMAND_ARG }, { op: 'lines' }, { op: 'matches', re }],
      },
      relate: [{ id: 'no-hit', relation: { op: 'empty', of: 'hits' }, message: '{value}' }],
    },
  };
}

function writeLayer(layer: Record<string, unknown>): void {
  writeFileSync(layerPath, JSON.stringify(layer));
}

function writeFlushBanLayer(): void {
  writeLayer({ sessionDisciplines: [commandEntry(LAYER_ID, 'FLUSHALL')] });
}

/** The IR of one shell call by the host's shell tool, roster attached, no session. */
function shellIr(command: string): CovenantInput {
  return {
    toolCalls: [{ name: SHELL_TOOL, args: { [COMMAND_ARG]: command } }],
    subagentSpawns: [],
    userMessages: [],
    tools: TOOLS,
  };
}

/** Spawn the bin with `input` on stdin and nothing inherited, cwd = the judged tree. */
function spawnCheck(input: string, ...extra: string[]) {
  return spawnSync(process.execPath, [BIN, 'covenant', 'check', ...extra], {
    cwd: projectRoot,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    input,
  });
}

describe('--config-layer: the layer’s entry judges the call', () => {
  it('the forbidden command under the layer exits 0 with an advised row under the layer id at the --telemetry-path file', () => {
    // Three defects, one spawn: a bin that ignores `--config-layer` leaves no row under the
    // layer id; one that fails closed on the layer exits 2 under the runner's label; one
    // that parses `--telemetry-path` and never hands it on writes the row to the config's
    // own log.
    writeFlushBanLayer();

    const result = spawnCheck(
      JSON.stringify(shellIr(FORBIDDEN_COMMAND)),
      '--config-layer',
      layerPath,
      '--telemetry-path',
      flagLogPath,
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('usage:');
    expect(telemetryRows(flagLogPath)).toContainEqual(['advised', LAYER_ID, NO_SUBJECT]);
    expect(telemetryRows(configLogPath)).toEqual([]);
    expect(result.stderr).toContain(LAYER_WHY);
  });
});

describe('--config-layer: a layer that does not load fails the run closed', () => {
  it('a layer path that does not exist exits 2 with one blocked row naming the path', () => {
    // Judging without the layer switches the host policy off silently. The IR carries a
    // command the layer would have passed, so a bin that dropped the layer exits 0 here.
    const result = spawnCheck(
      JSON.stringify(shellIr(ORDINARY_COMMAND)),
      '--config-layer',
      layerPath,
      '--telemetry-path',
      flagLogPath,
    );

    expect(result.status).toBe(2);
    expect(result.stderr).not.toContain('usage:');
    expect(telemetryRows(flagLogPath)).toEqual([['blocked', CHECK_LABEL, NO_SUBJECT]]);
    expect(result.stderr).toContain(LAYER_FILE);
  });
});

describe('the argv table: each new flag at most once, with a value that is not a flag', () => {
  it.each([
    ['--config-layer twice', ['--config-layer', 'a.json', '--config-layer', 'b.json']],
    ['--config-layer with no value', ['--config-layer']],
    ['--config-layer with a flag as its value', ['--config-layer', '--enforce']],
    ['--telemetry-path twice', ['--telemetry-path', 'a.log', '--telemetry-path', 'b.log']],
    ['--telemetry-path with no value', ['--telemetry-path']],
    ['--telemetry-path with a flag as its value', ['--telemetry-path', '--diff']],
    ['--telemetry-path with an empty value', ['--telemetry-path', '']],
  ])('%s prints the usage line naming both flags and exits 2 without judging', (_name, extra) => {
    // Stdin carries a diff of nothing, which exits 0 with no row when judged, so a bin that
    // accepted the malformed argv and went on would show exit 0 here. A flag value that
    // starts with `--` is a shifted grid, never a path.
    writeFlushBanLayer();

    const result = spawnCheck('', '--diff', ...extra);

    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage:');
    expect(result.stderr).toContain('--config-layer');
    expect(result.stderr).toContain('--telemetry-path');
    expect(telemetryRows(configLogPath)).toEqual([]);
    expect(telemetryRows(flagLogPath)).toEqual([]);
  });

  it.each([
    [
      'telemetry, diff, enforce, layer',
      ['--telemetry-path', 'T', '--diff', '--enforce', 'block', '--config-layer', 'L'],
    ],
  ])(
    '%s is accepted in that order — exit 0 on a diff of nothing, no usage line',
    (_name, extra) => {
      // The table is order-free for the flags it already has; a grid that reads the new
      // flags only at a fixed position refuses the host's spelling as usage.
      writeFlushBanLayer();
      const argv = extra.map((arg) => (arg === 'L' ? layerPath : arg === 'T' ? flagLogPath : arg));

      const result = spawnCheck('', ...argv);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).not.toContain('usage:');
    },
  );
});
