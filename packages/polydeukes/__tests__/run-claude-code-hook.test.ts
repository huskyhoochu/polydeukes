import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The session surface's assembled entry point, the counterpart of runCovenantCheck on
// the commit surface.
//
//   runClaudeCodeHook({ repoRoot, rawPayload?, telemetryPath?, covenantDist? })
//     : Promise<{ exitCode: 0 | 2 }>
//   - NEVER throws: every failure branch translates to { exitCode: 2 } inside, and a
//     failure leaves one blocked row at the telemetry path the run already knows. For a
//     CONFIG failure that is the default path, computed BEFORE config load (env-first,
//     then <repoRoot>/.polydeukes/roi.log) and INSIDE the try, so a non-string repoRoot
//     cannot escape as a rejection either. Asserted via .resolves, because an async
//     not.toThrow is a no-op.
//   - rawPayload absent means read fd 0; every case here injects it.
//   - the judge bodies resolve through the REAL covenant package dist even though this
//     suite's vitest alias maps @polydeukes/covenant to source, so the covenantDist seam
//     is the only way a test can take a body away.
//
// Each test builds a throwaway repoRoot and writes its own tmp config, so no protected
// path of THIS repository is ever referenced. Payloads deliberately omit transcript_path:
// with no transcript there is no transcript-mod registration and no witness valve,
// leaving self-mod, shell-mod and the discipline compiler's output — the smallest
// assembly that still answers.
import { runClaudeCodeHook } from '../src/index.ts';
import {
  BASELINE_FIRST_RUN_ROW,
  distWithout as sharedDistWithout,
  telemetryRows,
  writeConfigAt,
} from './helpers';

/** Injected fixture values — the config entry and the file judged under it. */
const PROTECTED_ENTRY = 'gate';
const PROTECTED_FILE = 'gate/inner.txt';
/**
 * The label the session assembly's fail-closed catch records under — never a judge's
 * label. Defined in src/claude-code-hook.ts; the delegator hook holds no telemetry logic.
 */
const FAIL_CLOSED_LABEL = 'hook';
/** The label runAdapterPath records under — the funnel supplement and payload faults. */
const ADAPTER_LABEL = 'adapter-claude-code';
/** A library module the covenant barrel imports eagerly — absent, the import throws. */
const BARREL_MODULE = 'self-mod.js';
/** A discipline whose evidence this run cannot read — it compiles to a body-less skip. */
const PRECEDENT_ID = 'needs-precedent';
const PRECEDENT_TOOL = 'WebFetch';
const DISCIPLINE_SCOPE = 'lib/**/*.ts';
const SCOPED_TARGET = 'lib/a.ts';

let repoRoot: string;
let telemetryPath: string;

/** Minimal valid config (languages is required) plus the caller's extra keys. */
function writeConfig(extra: Record<string, unknown>): void {
  writeConfigAt(repoRoot, telemetryPath, extra, DISCIPLINE_SCOPE);
}

/** This suite's dist fixtures, all rooted at the current throwaway directory. `null` omits
 * nothing: the complete mirror, which must judge exactly as the real build. */
function distWithout(moduleFileName: string | null): string {
  return sharedDistWithout(repoRoot, moduleFileName);
}

/**
 * Every telemetry row as [event, label, subject]. The label separates WHO answered — a
 * judge, the adapter funnel, or the fail-closed catch — which an exit code alone cannot,
 * since a crashed assembly and a real block both exit 2. The subject is the MATCHED
 * protected entry, never the judged file path.
 *
 * Every case with a loadable config opens with {@link BASELINE_FIRST_RUN_ROW}: this
 * repoRoot is fresh, so the state comparison finds no baseline and records the absence
 * before the judgment answers.
 */
const rows = () => telemetryRows(telemetryPath);

/** One Edit payload targeting `absoluteTarget` (its pre-state must exist on disk). */
function editPayload(absoluteTarget: string): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 's-1',
    cwd: repoRoot,
    tool_name: 'Edit',
    tool_input: { file_path: absoluteTarget, old_string: 'locked: yes', new_string: 'locked: no' },
  });
}

/** One Write payload creating `absoluteTarget`; content mentions no protected path. */
function writePayload(absoluteTarget: string, content = 'nothing special\n'): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 's-1',
    cwd: repoRoot,
    tool_name: 'Write',
    tool_input: { file_path: absoluteTarget, content },
  });
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-session-'));
  telemetryPath = join(repoRoot, 'roi.log');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe('runClaudeCodeHook — every failure resolves to exit 2, recorded', () => {
  it('resolves { exitCode: 2 } and records ONE hook blocked row when no config file exists', async () => {
    // loadConfig's throw escaping as a rejection would still exit 2 through the delegator
    // but lose the row; translating the missing config to exit 0 would leave an unjudged
    // repository looking judged.
    await expect(
      runClaudeCodeHook({
        repoRoot,
        rawPayload: writePayload(join(repoRoot, 'notes/ordinary.txt')),
        telemetryPath,
      }),
    ).resolves.toEqual({ exitCode: 2 });

    expect(rows()).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
  });

  it('records the config-failure blocked row at the DEFAULT telemetry path (no injection)', async () => {
    // Recording against spec.telemetryPath in the config-failure window hands the
    // recorder an undefined and the row silently vanishes — a fail-closed exit leaving no
    // record. So the entry point computes the default path BEFORE any load (env-first,
    // then <repoRoot>/.polydeukes/roi.log) and keeps that computation INSIDE the try, so
    // a non-string repoRoot cannot escape as a rejection. The env seam points the default
    // at a tmp file so this repository's own log stays clean.
    vi.stubEnv('POLYDEUKES_TELEMETRY_PATH', telemetryPath);
    writeFileSync(
      join(repoRoot, 'polydeukes.config.json'),
      JSON.stringify({ languages: 'not-an-object' }),
    );

    await expect(
      runClaudeCodeHook({
        repoRoot,
        rawPayload: writePayload(join(repoRoot, 'notes/ordinary.txt')),
      }),
    ).resolves.toEqual({ exitCode: 2 });

    expect(rows()).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
  });

  it('falls back to <repoRoot>/.polydeukes/roi.log when neither the spec nor the env names a path', async () => {
    // The LAST term of the precedence chain. Every other case injects telemetryPath, so
    // dropping the `<repoRoot>/.polydeukes/roi.log` fallback would leave the suite green
    // while production runs exactly that branch — the delegator passes no path and the
    // hook normally runs with no env var set — and a config failure would write its
    // blocked row nowhere.
    vi.stubEnv('POLYDEUKES_TELEMETRY_PATH', undefined);
    writeFileSync(
      join(repoRoot, 'polydeukes.config.json'),
      JSON.stringify({ languages: 'not-an-object' }),
    );

    await expect(
      runClaudeCodeHook({
        repoRoot,
        rawPayload: writePayload(join(repoRoot, 'notes/ordinary.txt')),
      }),
    ).resolves.toEqual({ exitCode: 2 });

    const fallback = readRecords(join(repoRoot, '.polydeukes', 'roi.log')).records;
    expect(fallback.map((record) => [record.event, record.label, record.subject])).toEqual([
      ['blocked', FAIL_CLOSED_LABEL, '-'],
    ]);
  });

  it('writes to the path the CONFIG names once the load succeeds', async () => {
    // The config term of the precedence chain, which no other case reaches: the two
    // default-path cases above break the config on purpose and never get past the load,
    // and every other case injects telemetryPath. Without the post-load reassignment the
    // `telemetry.logPath` key stops working for consumers — a regression this repository
    // could never observe, since its own runs always set the env.
    vi.stubEnv('POLYDEUKES_TELEMETRY_PATH', undefined);
    const configured = join(repoRoot, 'nested', 'configured-roi.log');
    writeConfig({ telemetry: { logPath: configured } });

    await expect(
      runClaudeCodeHook({
        repoRoot,
        rawPayload: writePayload(join(repoRoot, 'notes/ordinary.txt')),
      }),
    ).resolves.toEqual({ exitCode: 0 });

    // The state comparison resolves the telemetry path by the same precedence, so its
    // first-run row lands in the configured log too: a comparison falling back to the
    // default path would split one call's records across two files.
    expect(readRecords(configured).records.map((record) => [record.event, record.label])).toEqual([
      ['unattributed', 'baseline'],
      ['passed', ADAPTER_LABEL],
    ]);
  });

  it('resolves { exitCode: 2 } and records ONE hook blocked row when the covenant dist is missing a barrel module', async () => {
    // The payload touches NO protected path on purpose: an assembly that dropped the
    // existence proof, or ignored the covenantDist seam and resolved the real build,
    // would dispatch, match nothing, and answer exit 0 with an adapter passed row. Only
    // the fail-closed label proves the assembly stopped before judging.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    await expect(
      runClaudeCodeHook({
        repoRoot,
        rawPayload: writePayload(join(repoRoot, 'notes/ordinary.txt')),
        telemetryPath,
        covenantDist: distWithout(BARREL_MODULE),
      }),
    ).resolves.toEqual({ exitCode: 2 });

    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['blocked', FAIL_CLOSED_LABEL, '-']]);
  });
});

describe('parity shape — the assembled session judgment', () => {
  it('passes (exit 0) a Write payload touching no protected path, leaving one adapter passed row', async () => {
    // The over-blocking half carries the same weight as the block: a registration set
    // matching every path sends every ordinary edit to the valve. The row is the funnel
    // supplement, so no call passes unrecorded — a pass with NO row is the defect class,
    // and without the supplement the pass vanishes from gain.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: writePayload(join(repoRoot, 'notes/ordinary.txt')),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['passed', ADAPTER_LABEL, '-']]);
  });

  it('blocks (exit 2) an Edit targeting a file under a protected entry, subject = matched entry', async () => {
    // The block's shape: self-mod blocks, shell-mod matched the same mention and passed
    // (an Edit is not a shell call), in registration order. The subject is the MATCHED
    // entry, not the judged file path — the entry is a directory precisely so the two
    // cannot coincide.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    const target = join(repoRoot, PROTECTED_FILE);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, 'locked: yes\n');

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: editPayload(target),
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['blocked', 'self-mod', PROTECTED_ENTRY],
      ['passed', 'shell-mod', PROTECTED_ENTRY],
    ]);
  });
});

// The over-blocking direction: a body this run never registers is not required to be
// present, or an ordinary config shape turns into a lockout that sends people to the
// witness. runClaudeCodeHook resolves the covenant package through createRequire from the
// REAL umbrella location, so a fixture tree cannot redirect that resolution and the
// covenantDist seam is where these cases live.

describe('a registration this run never composes costs it nothing', () => {
  it('a payload carrying NO transcript composes no transcript-mod registration (exit 0)', async () => {
    // The existence proof happens where the path is PRODUCED: no transcript means no
    // transcript-mod registration, so its body path is never composed and its absence
    // proves nothing. Hoisting the proof above the registration's condition turns every
    // transcript-free call into a fail-closed block.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: writePayload(join(repoRoot, 'notes/ordinary.txt')),
      telemetryPath,
      covenantDist: distWithout(null),
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['passed', ADAPTER_LABEL, '-']]);
  });

  it('a config declaring NO disciplines still judges and still compiles the backstop (exit 0)', async () => {
    // Zero entries still compile the body-less shell-unjudgeable backstop, but nothing
    // composes the discipline body's path, so its absence is not this run's concern.
    // Demanding it would close every call in a repository that simply declares no
    // disciplines — the ordinary config shape.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: writePayload(join(repoRoot, 'notes/ordinary.txt')),
      telemetryPath,
      covenantDist: distWithout(null),
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['passed', ADAPTER_LABEL, '-']]);
  });

  it('a discipline compiling to a body-less skip records skipped, not a fail-closed (exit 0, one skipped row)', async () => {
    // Declaring a discipline is not the same as spawning one: with no transcript this
    // entry's evidence can never be read, so it compiles to a skip with no body and
    // nothing will ever run. The skipped row is the load-bearing half — it proves the
    // compiler still ran and the entry still routed, with the scoped target the trigger
    // matched as subject — so a fix that stops compiling when the body is absent cannot
    // pass.
    writeConfig({
      protectedPaths: [PROTECTED_ENTRY],
      disciplines: [
        { id: PRECEDENT_ID, requirePrecedent: { tool: PRECEDENT_TOOL }, in: DISCIPLINE_SCOPE },
      ],
    });

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: writePayload(join(repoRoot, SCOPED_TARGET), 'export const y = 2;\n'),
      telemetryPath,
      covenantDist: distWithout(null),
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['skipped', PRECEDENT_ID, SCOPED_TARGET]]);
  });
});
