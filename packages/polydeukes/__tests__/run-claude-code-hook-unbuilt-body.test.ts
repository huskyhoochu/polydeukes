import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// DIST-01 / CONFIG-06b's session half — the `covenantDist` seam from the side that must
// keep WORKING. runClaudeCodeHook resolves '@polydeukes/covenant' through createRequire
// from the REAL umbrella location, so a fixture tree's packages/covenant/dist is never
// consulted; the seam is the only injection point, and these pins hold it to judging an
// injected dist exactly as the real one.
//
// The fail-closed half moved to covenant-dist-module-missing.test.ts when DISPATCH-01
// folded the judges in-process: with no body file left to stat, a per-FILE absence no
// longer means anything and the proof object became the package import itself.
import { runClaudeCodeHook } from '../src/index.ts';
import {
  BASELINE_FIRST_RUN_ROW,
  distWithout as sharedDistWithout,
  telemetryRows,
  writeConfigAt,
} from './helpers';

// ---------------------------------------------------------------------------
// Each test builds a throwaway repoRoot and writes its own tmp config, so no
// protected path of THIS repository is ever referenced. The fixture dists are
// symlink mirrors of the real build living INSIDE the throwaway repo — a symlinked
// body resolves its imports out of the real build and actually runs, which is what
// keeps the absent-body pins honest (covenant-check-unbuilt-body precedent).
// ---------------------------------------------------------------------------

/** Injected fixture values — the config entries and payload targets under test. */
const PROTECTED_ENTRY = 'gate';
const PROTECTED_FILE = 'gate/inner.txt';
/** The label runAdapterPath records under — the funnel supplement. */
const ADAPTER_LABEL = 'adapter-claude-code';
/** A write whose target cannot be derived — the class the backstop registration owns. */
const OPAQUE_WRITE = 'echo x > $F';

let repoRoot: string;
let telemetryPath: string;

/** Minimal valid config (languages is required) plus the caller's extra keys. */
function writeConfig(extra: Record<string, unknown>): void {
  writeConfigAt(repoRoot, telemetryPath, extra);
}

/**
 * This suite's dist fixtures. `null` omits nothing and is the COMPLETE mirror the control
 * cases run on, so the one omitted symlink stays the only difference between a green run
 * and a red one.
 */
function distWithout(omitBody: string | null): string {
  return sharedDistWithout(repoRoot, omitBody);
}

/**
 * Every telemetry row as [event, label, subject] — the label separates who answered.
 * Each case's repoRoot is fresh, so every row list opens with the state comparison's
 * first-run row (COVENANT-14 §2-e), which the broken dist below never reaches.
 */
const rows = () => telemetryRows(telemetryPath);

/** One PreToolUse payload string with the session envelope around `toolInput`. */
function payload(
  toolName: string,
  toolInput: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 's-1',
    cwd: repoRoot,
    tool_name: toolName,
    tool_input: toolInput,
    ...extra,
  });
}

/** The default probe: a Write that routes to no registration. */
function unroutedPayload(extra: Record<string, unknown> = {}): string {
  return payload(
    'Write',
    { file_path: join(repoRoot, 'notes/ordinary.txt'), content: 'nothing special\n' },
    extra,
  );
}

/** A call that really routes: an Edit on a file under the protected entry. */
function routedPayload(): string {
  const target = join(repoRoot, PROTECTED_FILE);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, 'locked: yes\n');
  return payload('Edit', {
    file_path: target,
    old_string: 'locked: yes',
    new_string: 'locked: no',
  });
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-session-unbuilt-'));
  telemetryPath = join(repoRoot, 'roi.log');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('DIST-01 / CONFIG-06b — an injected dist judges the session surface normally', () => {
  it('the COMPLETE mirror behaves normally (exit 0, one adapter passed row)', async () => {
    // The premise every absent-body case below rests on: a broken mirror — or a seam
    // that rejects any injected covenantDist — would fail closed at the SAME exit 2
    // under the SAME label those cases assert, and they would go green while proving
    // nothing. A normal pass here leaves the omitted body as the only variable.
    // Mutation caught: the existence proof rejecting a present body (a reversed join,
    // a filename the build does not emit), which locks every call in a healthy repo.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: unroutedPayload(),
      telemetryPath,
      covenantDist: distWithout(null),
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['passed', ADAPTER_LABEL, '-']]);
  });

  it('the same routed call on a COMPLETE mirror is judged by the real bodies (exit 2)', async () => {
    // The control for the pin above, and this file's only proof that a body EXECUTES
    // out of the symlink mirror: shell-mod's `passed` row is unreachable for a module
    // that never loaded — a missing or unrunnable body can only produce blocked. A
    // mirror reverted to copies (relative imports dying inside the fixture dir) turns
    // both rows into exit-1 verdicts and refutes this. Mutation caught: the mirror
    // mechanism no longer producing runnable bodies, which would leave every
    // absent-body pin above green while proving nothing.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: routedPayload(),
      telemetryPath,
      covenantDist: distWithout(null),
    });

    expect(result.exitCode).toBe(2);
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['blocked', 'self-mod', PROTECTED_ENTRY],
      ['passed', 'shell-mod', PROTECTED_ENTRY],
    ]);
  });

  it('an uncomputable shell write is still recorded skipped when NO disciplines are declared (exit 0)', async () => {
    // The silence defence (COVENANT-10b, e2e F1): the compiler appends the body-less
    // shell-unjudgeable backstop whatever the entry count, so an assembly that skips
    // the compiler call on an empty list deletes the ONE record this class produces —
    // the call would answer `passed`, reporting a clean judgment of a write whose
    // target was never determined. Mutation caught: the compile gated on
    // disciplines.length, restoring the unrecorded pass (the defect class, never a
    // declared limit).
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: payload('Bash', { command: OPAQUE_WRITE }),
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(rows()).toEqual([BASELINE_FIRST_RUN_ROW, ['skipped', 'shell-unjudgeable', '-']]);
  });
});
