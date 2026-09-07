import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The judges' existence proof is the covenant package import itself. A dist missing ONE
// barrel-referenced module fails each surface closed at assembly: exit 2, ONE blocked row
// under the surface's own label, and the recovery command on stderr.
import { runClaudeCodeHook } from '../src/claude-code-hook.ts';
import { runCovenantCheck } from '../src/covenant-check.ts';
import { covenantInputFromUnifiedDiff } from '../src/diff-ir.ts';
import {
  BASELINE_FIRST_RUN_ROW,
  type CheckRepo,
  createCheckRepo,
  distWithout as sharedDistWithout,
  telemetryRows,
  writeConfigAt,
} from './helpers.ts';

/** A library module the covenant barrel (index.js) references eagerly — not a body CLI. */
const BARREL_MODULE = 'self-mod.js';
const SESSION_FAIL_CLOSED_LABEL = 'hook';
const COMMIT_FAIL_CLOSED_LABEL = 'covenant-check';
const ADAPTER_LABEL = 'adapter-claude-code';
/** The recovery command a locked-out operator must be told. */
const RECOVERY_COMMAND = 'pnpm build';
const PROTECTED_ENTRY = 'secret.txt';
const SESSION_PROTECTED_ENTRY = 'gate';

describe('commit surface: a module-gutted covenant dist fails closed', () => {
  let repo: CheckRepo;

  beforeEach(() => {
    repo = createCheckRepo('pdks-gutted-dist-commit-');
  });

  afterEach(() => {
    repo.cleanup();
    vi.restoreAllMocks();
  });

  /** Stage a protected change — the self-mod label is what a real judgment leaves. */
  function stageProtectedChange(): void {
    repo.writeConfig({ protectedPaths: [PROTECTED_ENTRY] });
    repo.write(PROTECTED_ENTRY, 'sensitive\n');
    repo.git('add', PROTECTED_ENTRY, 'polydeukes.config.json');
  }

  it('the COMPLETE mirror still judges normally (exit 2, self-mod rows naming the targets)', async () => {
    // Without this control, an import proof that rejected any injected dist would leave
    // the gutted cases below green while proving nothing.
    stageProtectedChange();

    const result = await runCovenantCheck({
      enforce: 'block',
      repoRoot: repo.repoRoot,
      telemetryPath: repo.telemetryPath,
      input: covenantInputFromUnifiedDiff({ text: repo.git('diff', '--cached') }),
      covenantDist: sharedDistWithout(repo.repoRoot, null),
    });

    expect(result.exitCode).toBe(2);
    // Two staged files, two self-mod rows — the subjects are the judged targets, and the
    // label is what separates a real verdict from the fail-closed handler's row.
    expect(telemetryRows(repo.telemetryPath)).toEqual([
      ['blocked', 'self-mod', 'polydeukes.config.json'],
      ['blocked', 'self-mod', PROTECTED_ENTRY],
    ]);
  });

  it('a dist missing one barrel module: exit 2, ONE covenant-check blocked row, recovery command on stderr', async () => {
    // Only the fail-closed label proves assembly stopped: an import failure caught
    // somewhere that records a judge's verdict exits 2 the same way.
    stageProtectedChange();
    const stderrWrite = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    const result = await runCovenantCheck({
      repoRoot: repo.repoRoot,
      telemetryPath: repo.telemetryPath,
      input: covenantInputFromUnifiedDiff({ text: repo.git('diff', '--cached') }),
      covenantDist: sharedDistWithout(repo.repoRoot, BARREL_MODULE),
    });

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(repo.telemetryPath)).toEqual([['blocked', COMMIT_FAIL_CLOSED_LABEL, '-']]);
    const emitted = stderrWrite.mock.calls.map((call) => String(call[0])).join('');
    expect(emitted).toContain(RECOVERY_COMMAND);
    expect(emitted).toContain(BARREL_MODULE);
  });

  it('a gutted dist leaves ONE covenant-check row — the label separates a fail-closed from a fabricated verdict', async () => {
    // The exit code alone cannot tell the two apart: a self-mod VERDICT no judge produced
    // exits 2 the same way an assembly that never started does. The label is the
    // discriminator.
    stageProtectedChange();

    const result = await runCovenantCheck({
      repoRoot: repo.repoRoot,
      telemetryPath: repo.telemetryPath,
      input: covenantInputFromUnifiedDiff({ text: repo.git('diff', '--cached') }),
      covenantDist: sharedDistWithout(repo.repoRoot, BARREL_MODULE),
    });

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(repo.telemetryPath)).toEqual([['blocked', COMMIT_FAIL_CLOSED_LABEL, '-']]);
  });
});

describe('session surface: a module-gutted covenant dist fails closed', () => {
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
    // The omitted module must be the ONLY variable between a normal answer and a lockout.
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
    // The throw must exit 2 WITH its blocked row: a lockout leaving no record is the
    // defect class.
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
