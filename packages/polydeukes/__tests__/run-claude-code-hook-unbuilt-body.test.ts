import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// DIST-01 RED phase — CONFIG-06b's session half, ported from the e2e mirroredRoot
// block (assembly.e2e.test.ts). That technique's premise is retired by this ticket:
// runClaudeCodeHook resolves '@polydeukes/covenant' through createRequire from the REAL
// umbrella location, so a fixture tree's packages/covenant/dist is never consulted —
// path assembly became installation-graph resolution, and mimicking a tree cannot
// redirect a graph. The covenantDist seam is the injection point these pins move to.
//
// One case of the e2e block is NOT here: the unrouted self-mod-body omission already
// lives in run-claude-code-hook.test.ts as the §3-c AC-7 pin. runClaudeCodeHook does not
// exist yet, so every case below is RED by construction.
import { runClaudeCodeHook } from '../src/index.ts';

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
/** The fail-closed catch's label (the current hook's record) — never a judge's label. */
const FAIL_CLOSED_LABEL = 'hook';
/** The label runAdapterPath records under — the funnel supplement. */
const ADAPTER_LABEL = 'adapter-claude-code';
/** Bodies removed one at a time — each is composed under a different condition. */
const SELF_MOD_BODY = 'self-mod-body.js';
const SHELL_MOD_BODY = 'shell-mod-body.js';
const TRANSCRIPT_MOD_BODY = 'transcript-mod-body.js';
const DISCIPLINE_BODY = 'discipline-body.js';
/** A delta discipline — the entry shape that makes the compiler compose a body. */
const DELTA_ENTRIES = [{ id: 'no-todo', forbid: { added: 'TODO' }, in: 'lib/**/*.ts' }];
/** A write whose target cannot be derived — the class the backstop registration owns. */
const OPAQUE_WRITE = 'echo x > $F';
/** The real built dist — the mirror source for distWithout(). */
const REAL_COVENANT_DIST = resolve(import.meta.dirname, '../../covenant/dist');

let repoRoot: string;
let telemetryPath: string;

/** Minimal valid config (languages is required) plus the caller's extra keys. */
function writeConfig(extra: Record<string, unknown>): void {
  const config = {
    languages: {
      typescript: { productionGlob: 'lib/**/*.ts', testCmd: 'echo {scope}' },
    },
    telemetry: { logPath: telemetryPath },
    ...extra,
  };
  writeFileSync(join(repoRoot, 'polydeukes.config.json'), JSON.stringify(config, null, 2));
}

/**
 * A covenant dist mirroring the real build entry-by-entry, minus `omitBody` — `null`
 * omits nothing and is the COMPLETE mirror the control cases run on, so the one
 * omitted symlink stays the only difference between a green run and a red one.
 */
function distWithout(omitBody: string | null): string {
  const fixtureDist = join(repoRoot, 'covenant-dist-fixture');
  mkdirSync(fixtureDist, { recursive: true });
  for (const entry of readdirSync(REAL_COVENANT_DIST)) {
    if (entry === omitBody) continue;
    symlinkSync(join(REAL_COVENANT_DIST, entry), join(fixtureDist, entry));
  }
  return fixtureDist;
}

/** Every telemetry row as [event, label, subject] — the label separates who answered. */
function rows(): [string, string, string][] {
  return readRecords(telemetryPath).records.map((record) => [
    record.event,
    record.label,
    record.subject,
  ]);
}

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

/** An empty session file — a real transcript that has said nothing. */
function emptyTranscript(): string {
  const path = join(repoRoot, 'session.jsonl');
  writeFileSync(path, '');
  return path;
}

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-session-unbuilt-'));
  telemetryPath = join(repoRoot, 'roi.log');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('DIST-01 / CONFIG-06b — an unbuilt judge body fails the session surface closed', () => {
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
    expect(rows()).toEqual([['passed', ADAPTER_LABEL, '-']]);
  });

  it('fails closed (exit 2, one hook blocked row) when the shell-mod body was never built', async () => {
    // The second unconditional composition site. Mutation caught: the existence proof
    // wired into the self-mod path alone — an asymmetric proof gives one cause two
    // dispositions, and a shell-mod-less dist would dispatch and answer exit 0 with
    // an adapter passed row on this unrouted probe.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    await expect(
      runClaudeCodeHook({
        repoRoot,
        rawPayload: unroutedPayload(),
        telemetryPath,
        covenantDist: distWithout(SHELL_MOD_BODY),
      }),
    ).resolves.toEqual({ exitCode: 2 });

    expect(rows()).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
  });

  it('fails closed when the transcript-mod body was never built and a transcript IS attached', async () => {
    // The conditional composition site's OTHER end: run-claude-code-hook.test.ts pins that
    // a transcript-free call never demands this body, and this pin is why that one is
    // not vacuous — when the payload DOES carry a transcript, the registration is
    // composed and the absent body must stop assembly. Mutation caught: the proof
    // dropped from the conditional branch (the spawn of the missing module would exit
    // 1 and be recorded as a transcript-mod VERDICT on a later routed call).
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    await expect(
      runClaudeCodeHook({
        repoRoot,
        rawPayload: unroutedPayload({ transcript_path: emptyTranscript() }),
        telemetryPath,
        covenantDist: distWithout(TRANSCRIPT_MOD_BODY),
      }),
    ).resolves.toEqual({ exitCode: 2 });

    expect(rows()).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
  });

  it('fails closed when the discipline body was never built and a delta discipline IS declared', async () => {
    // The compiler's thunk fires exactly where a body is composed: a declared delta
    // entry composes one, so the absent module must stop assembly even though this
    // probe routes nowhere. Mutation caught: the thunk resolved lazily at spawn time
    // — the unrouted probe would answer exit 0 with an adapter passed row, and a
    // scoped edit later would record the missing module's exit 1 as a no-todo verdict.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY], disciplines: DELTA_ENTRIES });

    await expect(
      runClaudeCodeHook({
        repoRoot,
        rawPayload: unroutedPayload(),
        telemetryPath,
        covenantDist: distWithout(DISCIPLINE_BODY),
      }),
    ).resolves.toEqual({ exitCode: 2 });

    expect(rows()).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
  });

  it('a ROUTED call whose judge body is missing answers under the hook label, not the judge one', async () => {
    // The exit code alone cannot carry this pin — a fabricated verdict is also 2.
    // Without the assembly-time proof, spawning the missing module exits 1, which the
    // session's always-block level translates up: a self-mod VERDICT against an entry
    // no judge ever compared, byte-identical in exit code to the real block below.
    // Mutation caught: the existence proof reached only on the no-match path, leaving
    // every routed call fabricating verdicts out of build failures.
    writeConfig({ protectedPaths: [PROTECTED_ENTRY] });

    await expect(
      runClaudeCodeHook({
        repoRoot,
        rawPayload: routedPayload(),
        telemetryPath,
        covenantDist: distWithout(SELF_MOD_BODY),
      }),
    ).resolves.toEqual({ exitCode: 2 });

    expect(rows()).toEqual([['blocked', FAIL_CLOSED_LABEL, '-']]);
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
    expect(rows()).toEqual([['skipped', 'shell-unjudgeable', '-']]);
  });
});
