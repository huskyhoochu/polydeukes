import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// DIST-01 §3-c — the session surface's assembled entry point, the exact counterpart of
// runCovenantCheck on the commit surface.
//
// Contract asserted:
//   runClaudeCodeHook({ repoRoot, rawPayload?, telemetryPath?, covenantDist? })
//     : Promise<{ exitCode: 0 | 2 }>
//   - NEVER throws: every failure branch translates to { exitCode: 2 } inside, and a
//     failure leaves one blocked row at the telemetry path the run already knows —
//     which for a CONFIG failure is the default path, computed BEFORE config load
//     (env-first, then <repoRoot>/.polydeukes/roi.log) and INSIDE the try, so a
//     non-string repoRoot cannot escape as a rejection either.
//     Asserted via .resolves — an async not.toThrow is a no-op (testing-fixtures).
//   - rawPayload absent means read fd 0; every test here injects it (the seam exists
//     for exactly this). The stdin default is exercised by the AC-1/2 real-hook
//     parity spawns, not here.
//   - the judge bodies resolve through the REAL covenant package dist (createRequire,
//     the commit-surface precedent) even though this suite's vitest alias maps
//     @polydeukes/covenant to source — the covenantDist seam is the only way a test
//     can take a body away, and the real-dist cases below lean on that asymmetry
//     instead of fighting it.
import { runClaudeCodeHook } from '../src/index.ts';
import { telemetryRows } from './helpers';

// ---------------------------------------------------------------------------
// Each test builds a throwaway repoRoot and writes its own tmp config, so no
// protected path of THIS repository is ever referenced. Payloads deliberately omit
// transcript_path: with no transcript there is no transcript-mod registration and no
// witness valve, leaving the assembled set at self-mod + shell-mod + the discipline
// compiler's output — the smallest assembly that still answers.
// ---------------------------------------------------------------------------

/** Injected fixture values — the config entry and the file judged under it. */
const PROTECTED_ENTRY = 'gate';
const PROTECTED_FILE = 'gate/inner.txt';
/**
 * The label the session assembly's fail-closed catch records under — never a judge's
 * label. Origin: the current hook's fail-closed record (.claude/hooks/
 * covenant-pretooluse.mjs before DIST-01 moved it), carried over verbatim — §5-e: no
 * judgment change. The live definition is src/claude-code-hook.ts; the delegator that
 * file replaced the hook with holds no telemetry logic at all.
 */
const FAIL_CLOSED_LABEL = 'hook';
/** The label runAdapterPath records under — the funnel supplement and payload faults. */
const ADAPTER_LABEL = 'adapter-claude-code';
/** Bodies this surface composes paths for, removed one at a time to model build skew. */
const SELF_MOD_BODY = 'self-mod-body.js';
const TRANSCRIPT_MOD_BODY = 'transcript-mod-body.js';
const DISCIPLINE_BODY = 'discipline-body.js';
/** A discipline whose evidence this run cannot read — it compiles to a body-less skip. */
const PRECEDENT_ID = 'needs-precedent';
const PRECEDENT_TOOL = 'WebFetch';
const DISCIPLINE_SCOPE = 'lib/**/*.ts';
const SCOPED_TARGET = 'lib/a.ts';
/** The real built dist — the mirror source for distWithout(). */
const REAL_COVENANT_DIST = resolve(import.meta.dirname, '../../covenant/dist');

let repoRoot: string;
let telemetryPath: string;

/** Minimal valid config (languages is required) plus the caller's extra keys. */
function writeConfig(extra: Record<string, unknown>): void {
  const config = {
    languages: {
      typescript: { productionGlob: DISCIPLINE_SCOPE, testCmd: 'echo {scope}' },
    },
    telemetry: { logPath: telemetryPath },
    ...extra,
  };
  writeFileSync(join(repoRoot, 'polydeukes.config.json'), JSON.stringify(config, null, 2));
}

/**
 * A covenant dist mirroring the real build entry-by-entry with exactly ONE judge body
 * omitted — the state a checkout nobody rebuilt leaves behind. Symlinks, not copies:
 * a symlinked body resolves its imports out of the real build and actually runs
 * (the covenant-check-unbuilt-body precedent, verbatim).
 */
function distWithout(bodyFileName: string): string {
  const fixtureDist = join(repoRoot, 'covenant-dist-fixture');
  mkdirSync(fixtureDist, { recursive: true });
  for (const entry of readdirSync(REAL_COVENANT_DIST)) {
    if (entry === bodyFileName) continue;
    symlinkSync(join(REAL_COVENANT_DIST, entry), join(fixtureDist, entry));
  }
  return fixtureDist;
}

/**
 * Every telemetry row as [event, label, subject]. The label separates WHO answered —
 * a judge, the adapter funnel, or the fail-closed catch — which an exit code alone
 * cannot (a crashed assembly and a real block both exit 2). The subject is the
 * MATCHED protected entry, never the judged file path
 * (covenant.dev-log.telemetry-subject-is-matched-entry).
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

describe('DIST-01 §3-c runClaudeCodeHook — every failure resolves to exit 2, recorded', () => {
  it('resolves { exitCode: 2 } and records ONE hook blocked row when no config file exists', async () => {
    // Mutation caught: loadConfig's throw escaping as a rejection (the delegator would
    // still exit 2 but the row would be lost — §3-d widens the recording window to
    // everything the umbrella can reach, and this pin is that window), or the missing
    // config translated to exit 0 (an unjudged repo that looks judged — fail-open).
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
    // The audit's finding, closed here: a copy of runCovenantCheck's shape hands
    // recordFailClosed(spec.telemetryPath) an undefined in the config-failure window
    // and the row silently vanishes — a fail-closed exit that leaves no record. The
    // entry point computes the default path BEFORE any load (env-first, then
    // <repoRoot>/.polydeukes/roi.log — src/claude-code-hook.ts, the try's first
    // statement) so a config failure still has somewhere to write. That order is the
    // contract, and its other half is that the computation stays INSIDE the try so a
    // non-string repoRoot cannot escape as a rejection (PR #46 review). The env
    // seam points the default at a tmp file so this repository's log stays clean.
    // Mutation caught: the telemetry default resolved only after config load, or the
    // env-first precedence dropped (either leaves this env path empty).
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
    // The case above pins the ENV term of the precedence chain; this one pins the LAST
    // term's existence. Every other case in this file injects telemetryPath, so deleting
    // `?? join(spec.repoRoot, '.polydeukes', 'roi.log')` would leave the whole suite green
    // — while production runs exactly that branch, since the delegator passes no path and
    // the hook normally runs with no env var set. A config failure would then write its
    // blocked row nowhere and the fail-closed exit would leave no record (PR #46 review).
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
    // The THIRD term of the precedence chain, and the only one no case reached: the two
    // default-path cases above break the config on purpose, so they never get past the load,
    // and every other case injects telemetryPath. Deleting the post-load reassignment
    // entirely would leave the whole suite green while the `telemetry.logPath` config key
    // stopped working for consumers — a regression this repository could never observe,
    // since its own runs always set the env (PR #46 review).
    vi.stubEnv('POLYDEUKES_TELEMETRY_PATH', undefined);
    const configured = join(repoRoot, 'nested', 'configured-roi.log');
    writeConfig({ telemetry: { logPath: configured } });

    await expect(
      runClaudeCodeHook({
        repoRoot,
        rawPayload: writePayload(join(repoRoot, 'notes/ordinary.txt')),
      }),
    ).resolves.toEqual({ exitCode: 0 });

    expect(readRecords(configured).records.map((record) => [record.event, record.label])).toEqual([
      ['passed', ADAPTER_LABEL],
    ]);
  });

  it('resolves { exitCode: 2 } and records ONE hook blocked row when the covenant dist lacks the self-mod body', async () => {
    // AC-7, on a payload touching NO protected path on purpose: a mutant that drops
    // the existence proof — or ignores the covenantDist seam and resolves the real
    // build — dispatches, matches nothing, and answers exit 0 with an adapter passed
    // row. Both directions are refuted by this exact-row pin, and only the
    // fail-closed label proves the assembly stopped before judging
    // (the covenant-check-unbuilt-body precedent).
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    await expect(
      runClaudeCodeHook({
        repoRoot,
        rawPayload: writePayload(join(repoRoot, 'notes/ordinary.txt')),
        telemetryPath,
        covenantDist: distWithout(SELF_MOD_BODY),
      }),
    ).resolves.toEqual({ exitCode: 2 });

    expect(rows()).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
  });
});

describe('DIST-01 §3-e parity shape — the assembled session judgment', () => {
  it('passes (exit 0) a Write payload touching no protected path, leaving one adapter passed row', async () => {
    // The over-blocking half carries the same weight as the block: a registration set
    // that matches every path sends every ordinary edit to the valve. The row is the
    // funnel supplement — no call passes unrecorded (a pass with NO row is the defect
    // class, blocker B7). Mutation caught: over-matching registrations, or the
    // supplement dropped so the pass vanishes from gain.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: writePayload(join(repoRoot, 'notes/ordinary.txt')),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([['passed', ADAPTER_LABEL, '-']]);
  });

  it('blocks (exit 2) an Edit targeting a file under a protected entry, subject = matched entry', async () => {
    // The §3-e block baseline's shape on fixture data: self-mod blocks, shell-mod
    // matched the same mention and passed (an Edit is not a shell call), in
    // registration order. The subject pins the MATCHED entry ('gate'), not the judged
    // file path — the entry is a directory precisely so the two cannot coincide.
    // Mutation caught: self-mod dropped from the assembly (exit 0), shell-mod dropped
    // (one row instead of two), or the subject recorded as the file path.
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
      ['blocked', 'self-mod', PROTECTED_ENTRY],
      ['passed', 'shell-mod', PROTECTED_ENTRY],
    ]);
  });
});

// ---------------------------------------------------------------------------
// CONFIG-06b over-block defences, ported from the e2e mirroredRoot cases (DIST-01):
// runClaudeCodeHook resolves the covenant package through createRequire from the REAL
// umbrella location, so a fixture tree can never redirect that resolution — the
// covenantDist seam is where these pins now live. The direction under test is the
// OVER-BLOCKING one: a body this run never registers is not required to be present,
// or an ordinary config shape turns into a lockout that sends people to the witness.
// ---------------------------------------------------------------------------

describe('DIST-01 / CONFIG-06b — a body this run never registers is not required to be present', () => {
  it('a payload carrying NO transcript is untouched by a missing transcript-mod body (exit 0)', async () => {
    // Proof happens where the path is PRODUCED (CONFIG-06b §4.2 corollary): no
    // transcript means no transcript-mod registration, so its body path is never
    // composed and its absence proves nothing. Mutation caught: the proof hoisted
    // above the registration's condition, turning every transcript-free call into a
    // fail-closed block (exit 2, hook row — the exact shape this pin refuses).
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: writePayload(join(repoRoot, 'notes/ordinary.txt')),
      telemetryPath,
      covenantDist: distWithout(TRANSCRIPT_MOD_BODY),
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([['passed', ADAPTER_LABEL, '-']]);
  });

  it('a config declaring NO disciplines is untouched by a missing discipline body (exit 0)', async () => {
    // Zero entries still compile (the body-less shell-unjudgeable backstop), but
    // nothing composes the discipline body's path, so its absence is not this run's
    // concern — demanding it would close every call in a repository that simply
    // declares no disciplines, the ordinary config shape. Mutation caught: the body
    // path obtained eagerly (or gated on entry count) instead of inside the one
    // return that composes a body.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: writePayload(join(repoRoot, 'notes/ordinary.txt')),
      telemetryPath,
      covenantDist: distWithout(DISCIPLINE_BODY),
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([['passed', ADAPTER_LABEL, '-']]);
  });

  it('a discipline compiling to a body-less skip does not demand the discipline body (exit 0, one skipped row)', async () => {
    // Declaring a discipline is not the same as spawning one: with no transcript this
    // entry's evidence can never be read, so it compiles to a skip with no body and
    // nothing will ever run. The skipped row is the load-bearing half — it proves the
    // compiler still ran and the entry still routed (subject = the scoped target the
    // trigger matched), so a fix that stops compiling when the body is absent cannot
    // pass. Mutation caught: the spawn question answered at assembly by entry count,
    // where the answer is not known.
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
      covenantDist: distWithout(DISCIPLINE_BODY),
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([['skipped', PRECEDENT_ID, SCOPED_TARGET]]);
  });
});
