import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// DISPATCH-01 §4.2 / AC-3 RED phase — the existence proof's equivalence move: with the
// body CLIs gone, the proof object is the covenant package import itself. A dist
// missing ONE barrel-referenced module must fail each surface closed at assembly:
// exit 2, ONE blocked row under the surface's label, recovery command on stderr.
// Today the omitted module changes nothing (the umbrella resolves the library through
// its own node_modules), so the absent-module cases are RED by construction.
import { runClaudeCodeHook, runCovenantCheck } from '../src/index.ts';
import {
  BASELINE_FIRST_RUN_ROW,
  type CheckRepo,
  createCheckRepo,
  distWithout as sharedDistWithout,
  telemetryRows,
  writeConfigAt,
} from './helpers';

/** A library module the covenant barrel (index.js) references eagerly — not a body CLI. */
const BARREL_MODULE = 'self-mod.js';
const SESSION_FAIL_CLOSED_LABEL = 'hook';
const COMMIT_FAIL_CLOSED_LABEL = 'covenant-check';
const ADAPTER_LABEL = 'adapter-claude-code';
/** The recovery command a locked-out operator must be told (CLAUDE.md's contract). */
const RECOVERY_COMMAND = 'pnpm build';
const PROTECTED_ENTRY = 'secret.txt';
const SESSION_PROTECTED_ENTRY = 'gate';

describe('DISPATCH-01 AC-3 — commit surface: a module-gutted covenant dist fails closed', () => {
  let repo: CheckRepo;

  beforeEach(() => {
    repo = createCheckRepo('pdks-gutted-dist-commit-');
  });

  afterEach(() => {
    repo.cleanup();
    vi.restoreAllMocks();
  });

  /** Stage a protected change; advise is the level where a fake verdict passes. */
  function stageProtectedChange(enforce: 'advise' | 'block' = 'advise'): void {
    repo.writeConfig({
      protectedPaths: [PROTECTED_ENTRY],
      adapters: { git: { enforce } },
    });
    repo.write(PROTECTED_ENTRY, 'sensitive\n');
    repo.git('add', PROTECTED_ENTRY, 'polydeukes.config.json');
  }

  it('the COMPLETE mirror still judges normally (exit 0, advised self-mod rows)', async () => {
    // Mutation caught: the import proof rejecting a complete injected dist — the gutted
    // pins below would then be green while proving nothing.
    stageProtectedChange();

    const result = await runCovenantCheck({
      repoRoot: repo.repoRoot,
      telemetryPath: repo.telemetryPath,
      covenantDist: sharedDistWithout(repo.repoRoot, null),
    });

    expect(result.exitCode).toBe(0);
    // Two staged files, two advised rows — the subjects are the judged targets.
    expect(telemetryRows(repo.telemetryPath)).toEqual([
      ['advised', 'self-mod', 'polydeukes.config.json'],
      ['advised', 'self-mod', PROTECTED_ENTRY],
    ]);
  });

  it('a dist missing one barrel module: exit 2, ONE covenant-check blocked row, recovery command on stderr', async () => {
    // Mutation caught: the covenantDist seam no longer the resolution point (the run
    // quietly uses the healthy real build), or the import failure caught somewhere that
    // records a judge's verdict — only the fail-closed label proves assembly stopped.
    stageProtectedChange();
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const result = await runCovenantCheck({
      repoRoot: repo.repoRoot,
      telemetryPath: repo.telemetryPath,
      covenantDist: sharedDistWithout(repo.repoRoot, BARREL_MODULE),
    });

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(repo.telemetryPath)).toEqual([['blocked', COMMIT_FAIL_CLOSED_LABEL, '-']]);
    const emitted = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
    expect(emitted).toContain(RECOVERY_COMMAND);
    expect(emitted).toContain(BARREL_MODULE);
  });

  it('under enforce block: the SAME single covenant-check row — the label separates a fail-closed from a fabricated verdict', async () => {
    // Mutation caught: the import proof wired into the advise branch alone — block
    // already exits 2 here, but through a self-mod VERDICT no judge produced, and an
    // exit-code-only assertion cannot see that.
    stageProtectedChange('block');

    const result = await runCovenantCheck({
      repoRoot: repo.repoRoot,
      telemetryPath: repo.telemetryPath,
      covenantDist: sharedDistWithout(repo.repoRoot, BARREL_MODULE),
    });

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(repo.telemetryPath)).toEqual([['blocked', COMMIT_FAIL_CLOSED_LABEL, '-']]);
  });
});

describe('DISPATCH-01 AC-3 — session surface: a module-gutted covenant dist fails closed', () => {
  let repoRoot: string;
  let telemetryPath: string;

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'pdks-gutted-dist-session-'));
    telemetryPath = join(repoRoot, 'roi.log');
    writeConfigAt(repoRoot, telemetryPath, { protectedPaths: [SESSION_PROTECTED_ENTRY] });
  });

  afterEach(() => {
    rmSync(repoRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /** A Write payload routing to no registration — the gutted import must stop it anyway. */
  function unroutedPayload(): string {
    return JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: 's-1',
      cwd: repoRoot,
      tool_name: 'Write',
      tool_input: { file_path: join(repoRoot, 'notes/ordinary.txt'), content: 'nothing\n' },
    });
  }

  it('the COMPLETE mirror still answers normally (exit 0, one adapter passed row)', async () => {
    // Mutation caught: same as the commit control — the omitted module must be the ONLY
    // variable between a normal answer and a lockout.
    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: unroutedPayload(),
      telemetryPath,
      covenantDist: sharedDistWithout(repoRoot, null),
    });

    expect(result.exitCode).toBe(0);
    expect(telemetryRows(telemetryPath)).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['passed', ADAPTER_LABEL, '-'],
    ]);
  });

  it('a dist missing one barrel module: exit 2, ONE hook blocked row, recovery command on stderr', async () => {
    // Mutation caught: the import proof wired into the commit surface alone, or the
    // throw exiting 2 without its blocked row (a lockout with no record).
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const result = await runClaudeCodeHook({
      repoRoot,
      rawPayload: unroutedPayload(),
      telemetryPath,
      covenantDist: sharedDistWithout(repoRoot, BARREL_MODULE),
    });

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['blocked', SESSION_FAIL_CLOSED_LABEL, '-'],
    ]);
    const emitted = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
    expect(emitted).toContain(RECOVERY_COMMAND);
    expect(emitted).toContain(BARREL_MODULE);
  });
});
