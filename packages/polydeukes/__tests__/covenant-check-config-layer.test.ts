import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// `runCovenantCheck` with `configLayer`: a path, resolved against `repoRoot`, to a second
// discipline file the runner reads after the target config and hands the loader as a layer.
// A layer that cannot be read or does not merge fails the run closed like any other load
// failure. The config-repair exception asks the same loader the same question — "does the
// text this edit writes load?" — so with a layer the answer includes the layer: a repaired
// config whose entries collide with the layer's does not load, and the repair stays closed.
import { runCovenantCheck } from '../src/covenant-check.ts';
import { telemetryRows, writeConfigAt } from './helpers.ts';

/** Injected fixture values. */
const CONFIG_FILE = 'polydeukes.config.json';
const LAYER_FILE = 'discipline-layer.json';
const EDIT_TOOL = 'Edit';
const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const TOOLS = { mutating: [EDIT_TOOL], shell: [SHELL_TOOL], commandArgs: [COMMAND_ARG] };
/** The layer's entry and the command it forbids. */
const LAYER_ID = 'host-no-flushall';
const LAYER_WHY = 'a cache flush in a shared environment erases every other tenant’s state';
const FORBIDDEN_COMMAND = 'redis-cli FLUSHALL';
/** The target's own entry — an id no layer carries. */
const TARGET_ID = 'target-no-force-push';
/** The runner's own label — the row a config-load outcome lands under. */
const CHECK_LABEL = 'covenant-check';
/** The subject a run that failed closed before judging writes, and a shell call's own. */
const NO_SUBJECT = '-';
/** The loader's message for the invalid target fixture (a `union` over three names). */
const VALIDATION_MESSAGE = "takes 'of' as two extract names";

let repoRoot: string;
/** The layer and the telemetry both live outside the observed directory. */
let outside: string;
let layerPath: string;
let telemetryPath: string;
let stderrWrites: string[];

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-config-layer-'));
  outside = mkdtempSync(join(tmpdir(), 'pdks-config-layer-outside-'));
  layerPath = join(outside, LAYER_FILE);
  telemetryPath = join(outside, 'roi.log');
  stderrWrites = [];
  vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    stderrWrites.push(String(chunk));
    return true;
  }) as typeof process.stderr.write);
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function stderrText(): string {
  return stderrWrites.join('');
}

/** A command entry forbidding `re` on the command line, at the default (advise) level. */
function commandEntry(id: string, re: string, why: string = LAYER_WHY) {
  return {
    id,
    why,
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

/** The layer every case merges: one session entry forbidding the cache flush. */
function writeFlushBanLayer(): void {
  writeLayer({ sessionDisciplines: [commandEntry(LAYER_ID, 'FLUSHALL')] });
}

/** A config that parses but fails `defineConfig`: `union` given three extract names. */
function writeValidationFailure(): void {
  writeConfigAt(repoRoot, telemetryPath, {
    sessionDisciplines: [
      {
        id: 'bad',
        why: 'x',
        declare: {
          mechanism: 'precedent',
          sources: { session: { transcript: true } },
          extract: { a: [{ op: 'union', of: ['a', 'b', 'c'] }] },
          relate: [{ id: 'r', relation: { op: 'nonEmpty', of: 'a' }, message: 'm' }],
        },
      },
    ],
  });
}

/** A config text that loads on its own, carrying one session entry under `id`. */
function repairedConfigText(id: string): string {
  return JSON.stringify({
    languages: { typescript: { productionGlob: 'lib/**/*.ts', testCmd: 'echo {scope}' } },
    telemetry: { logPath: telemetryPath },
    sessionDisciplines: [commandEntry(id, 'git push --force', 'y')],
  });
}

function onDiskConfigText(): string {
  return existsSync(join(repoRoot, CONFIG_FILE))
    ? readFileSync(join(repoRoot, CONFIG_FILE), 'utf-8')
    : '';
}

/** One Edit rewriting the config file from its on-disk text into `post`. */
function repairCall(post: string): CovenantInput['toolCalls'][number] {
  return {
    name: EDIT_TOOL,
    args: { file_path: CONFIG_FILE },
    fileChange: { kind: 'modify', path: CONFIG_FILE, pre: onDiskConfigText(), post },
  };
}

function shellCall(command: string): CovenantInput['toolCalls'][number] {
  return { name: SHELL_TOOL, args: { [COMMAND_ARG]: command } };
}

function ir(toolCalls: CovenantInput['toolCalls']): CovenantInput {
  return { toolCalls, subagentSpawns: [], userMessages: [], tools: TOOLS };
}

async function runSession(toolCalls: CovenantInput['toolCalls'], configLayer?: string) {
  return runCovenantCheck({
    surface: 'session',
    repoRoot,
    telemetryPath,
    input: ir(toolCalls),
    ...(configLayer === undefined ? {} : { configLayer }),
  });
}

describe('a layer’s entries judge alongside the target’s', () => {
  it('the layer’s command entry breaks on the forbidden command: exit 0, one advised row under its id, the why on stderr', async () => {
    // The feature itself. The label separates a judgment by the layer entry from a
    // fail-closed crash (exit 2 under the runner's label) and from a pass with no row; the
    // why on stderr is the only place the reason reaches a caller.
    writeConfigAt(repoRoot, telemetryPath, {});
    writeFlushBanLayer();

    const result = await runSession([shellCall(FORBIDDEN_COMMAND)], layerPath);

    expect(result.exitCode).toBe(0);
    expect(telemetryRows(telemetryPath)).toContainEqual(['advised', LAYER_ID, NO_SUBJECT]);
    expect(stderrText()).toContain(LAYER_WHY);
  });

  it('an ordinary command under the same layer passes — no row under the layer id is a break', async () => {
    // The over-blocking end: the layer must not turn every shell call into a break.
    writeConfigAt(repoRoot, telemetryPath, {});
    writeFlushBanLayer();

    const result = await runSession([shellCall('redis-cli PING')], layerPath);

    expect(result.exitCode).toBe(0);
    expect(telemetryRows(telemetryPath)).toContainEqual(['passed', LAYER_ID, NO_SUBJECT]);
  });

  it('the same call with no configLayer leaves no row under the layer id', async () => {
    // A runner that discovers the layer from a fixed location, or keeps one from an
    // earlier run, judges with a policy the caller never named.
    writeConfigAt(repoRoot, telemetryPath, {});
    writeFlushBanLayer();

    const result = await runSession([shellCall(FORBIDDEN_COMMAND)]);

    expect(result.exitCode).toBe(0);
    expect(telemetryRows(telemetryPath).filter(([, label]) => label === LAYER_ID)).toEqual([]);
  });

  it('a relative configLayer resolves against repoRoot, not the process cwd', async () => {
    // The host calls from its own directory; a path read against `process.cwd()` finds
    // nothing there and fails every call closed on a machine where the two differ.
    writeConfigAt(repoRoot, telemetryPath, {});
    writeFlushBanLayer();
    // `repoRoot` and `outside` are siblings under the temp directory; the cwd is neither.
    const previousCwd = process.cwd();
    process.chdir(outside);
    try {
      const result = await runSession(
        [shellCall(FORBIDDEN_COMMAND)],
        relative(repoRoot, layerPath),
      );

      expect(result.exitCode).toBe(0);
      expect(telemetryRows(telemetryPath)).toContainEqual(['advised', LAYER_ID, NO_SUBJECT]);
    } finally {
      process.chdir(previousCwd);
    }
  });
});

describe('a layer that does not load fails the run closed', () => {
  it('a configLayer path that does not exist: exit 2, one blocked row under the runner label, the path on stderr', async () => {
    // Judging without the layer would switch the host policy off silently; the path on
    // stderr is what tells the host which file it failed to place.
    writeConfigAt(repoRoot, telemetryPath, {});

    const result = await runSession([shellCall('git status')], layerPath);

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', CHECK_LABEL, NO_SUBJECT]]);
    expect(stderrText()).toContain(layerPath);
  });
});

describe('the config-repair exception sees the layer', () => {
  it('a repair whose post duplicates a layer id stays blocked', async () => {
    // The exception asks whether the text the edit writes loads. With a layer, "loads" means
    // "merges with the layer": a runner that checks the post alone opens the valve for a
    // config that the very next call fails to load.
    writeValidationFailure();
    writeFlushBanLayer();

    const result = await runSession([repairCall(repairedConfigText(LAYER_ID))], layerPath);

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', CHECK_LABEL, NO_SUBJECT]]);
    expect(stderrText()).toContain(LAYER_ID);
  });

  it('a repair whose post merges with the layer passes: exit 0, one advised row naming the config path', async () => {
    // The control for the case above: a runner that fails every repair closed whenever a
    // layer is present locks the session the moment a host policy is in force.
    writeValidationFailure();
    writeFlushBanLayer();

    const result = await runSession([repairCall(repairedConfigText(TARGET_ID))], layerPath);

    expect(result.exitCode).toBe(0);
    expect(telemetryRows(telemetryPath)).toEqual([['advised', CHECK_LABEL, CONFIG_FILE]]);
    expect(stderrText()).toContain(VALIDATION_MESSAGE);
  });

  it('a target that loads on its own but shares an id with the layer opens no repair', async () => {
    // The exception exists for a config that is broken by itself. A clash only the layer
    // creates would otherwise let one unjudged rewrite of the protected config through.
    writeConfigAt(repoRoot, telemetryPath, {
      sessionDisciplines: [commandEntry(LAYER_ID, 'git reset --hard', 'z')],
    });
    writeFlushBanLayer();

    const result = await runSession([repairCall(repairedConfigText(TARGET_ID))], layerPath);

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', CHECK_LABEL, NO_SUBJECT]]);
  });

  it('a layer that is invalid on its own opens no repair and names the layer', async () => {
    // No edit to the discovered file can fix the layer, so the hint to rewrite that file
    // would send an unattended agent around the wrong file.
    writeValidationFailure();
    writeLayer({ protectedPaths: ['pipeline'] });

    const result = await runSession([repairCall(repairedConfigText(TARGET_ID))], layerPath);

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', CHECK_LABEL, NO_SUBJECT]]);
    expect(stderrText()).toContain('invalid config layer');
    expect(stderrText()).not.toContain('in one Edit or Write');
  });

  it('a repair while the layer itself is missing stays blocked', async () => {
    // Two broken files, one edit: the post cannot make the layer readable, so the merged
    // config still does not load and the call has nothing to pass on.
    writeValidationFailure();

    const result = await runSession([repairCall(repairedConfigText(TARGET_ID))], layerPath);

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', CHECK_LABEL, NO_SUBJECT]]);
  });
});
