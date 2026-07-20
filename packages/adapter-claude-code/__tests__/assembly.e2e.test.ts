import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// Dogfooding-assembly E2E (ADAPTER-03 archived PRD §8 carry-over): spawn the REAL
// PreToolUse hook as a black box — real adapter dist, real dispatcher, real judge
// bodies — and pin the cross-package behavioral contract the funnel supplement
// depends on ("results: [] + exit 0 ⟺ dispatcher wrote zero rows"). Spawning the
// repo-level hook keeps the package dependency graph one-way (no covenant import),
// the same precedent as the covenant package's own dist-spawning E2E.

const repoRoot = resolve(import.meta.dirname, '../../..');
const hookPath = join(repoRoot, '.claude/hooks/covenant-pretooluse.mjs');

let tmpRoot: string;
let telemetryPath: string;

beforeAll(() => {
  // The hook imports built dist; turbo caching makes repeat runs ~1s.
  execSync('pnpm turbo run build', { cwd: repoRoot, stdio: 'pipe' });
}, 120_000);

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pdks-assembly-'));
  telemetryPath = join(tmpRoot, 'roi.log');
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/**
 * Spawn the real hook with one payload. The hatch env var is always set explicitly —
 * an empty string DISARMS it (the assembly session running this test may have it
 * armed, and inheriting that would corrupt the block cases).
 */
function runHook(payload: unknown, opts?: { bypass?: boolean }) {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return spawnSync(process.execPath, [hookPath], {
    input,
    encoding: 'utf-8',
    env: {
      ...process.env,
      POLYDEUKES_TELEMETRY_PATH: telemetryPath,
      POLYDEUKES_COVENANT_BYPASS: opts?.bypass === true ? 'e2e' : '',
    },
  });
}

function editPayload(filePath: string) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: filePath, old_string: 'a', new_string: 'b' },
  };
}

function bashPayload(command: string) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  };
}

describe('dogfooding assembly E2E — real hook, real dispatcher, real bodies', () => {
  it('a no-match call exits 0 and leaves EXACTLY one adapter passed row (cross-package funnel pin)', () => {
    // Pins the behavioral contract the adapter supplement infers from results.length:
    // when nothing matches, the real dispatcher writes zero rows, so the assembled
    // funnel total is exactly the one adapter-supplied passed row. If a future
    // dispatcher starts recording no-match calls itself, this total becomes 2 and
    // the gain double-count is caught HERE, not in a gain report months later.
    const result = runHook(editPayload('docs/example.md'));

    expect(result.status).toBe(0);
    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(1);
    expect(records[0].event).toBe('passed');
    expect(records[0].label).toBe('adapter-claude-code');
  });

  it('an Edit on a protected source path is blocked by self-mod (exit 2) with run-all rows', () => {
    const result = runHook(editPayload('packages/covenant/src/dispatch.ts'));

    expect(result.status).toBe(2);
    const { records } = readRecords(telemetryPath);
    const byLabel = (label: string) => records.filter((r) => r.label === label);
    expect(byLabel('self-mod').map((r) => r.event)).toEqual(['blocked']);
    // run-all coexistence: shell-mod judged the same call on its own axis and upheld.
    expect(byLabel('shell-mod').map((r) => r.event)).toEqual(['passed']);
    expect(records.length).toBe(2);
  });

  it('a Bash sed -i on a protected source path is blocked by shell-mod (exit 2)', () => {
    const result = runHook(
      bashPayload("sed -i 's/exit 2/exit 0/' packages/covenant/src/dispatch.ts"),
    );

    expect(result.status).toBe(2);
    const { records } = readRecords(telemetryPath);
    const byLabel = (label: string) => records.filter((r) => r.label === label);
    expect(byLabel('shell-mod').map((r) => r.event)).toEqual(['blocked']);
    expect(byLabel('self-mod').map((r) => r.event)).toEqual(['passed']);
    expect(records.length).toBe(2);
  });

  it('a read-only allowlisted command mentioning a protected path passes (exit 0)', () => {
    const result = runHook(bashPayload('cat packages/covenant/src/index.ts'));

    expect(result.status).toBe(0);
    const { records } = readRecords(telemetryPath);
    expect(records.map((r) => r.event).sort()).toEqual(['passed', 'passed']);
  });

  it('the armed escape hatch bypasses a blocked edit (exit 0) and both bypasses are measured', () => {
    const result = runHook(editPayload('packages/covenant/src/dispatch.ts'), { bypass: true });

    expect(result.status).toBe(0);
    const { records } = readRecords(telemetryPath);
    expect(records.map((r) => r.event)).toEqual(['bypassed', 'bypassed']);
  });

  it('malformed hook stdin fails closed (exit 2) with one adapter blocked row', () => {
    const result = runHook('this is not json {');

    expect(result.status).toBe(2);
    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(1);
    expect(records[0].event).toBe('blocked');
    expect(records[0].label).toBe('adapter-claude-code');
  });
});

// ===========================================================================
// COVENANT-10 §4.6 / AC §5.7 — real wired disciplines: the routing gap closes.
// A command mentioning NO protected path now reaches a registration (content-
// predicate routing), and a delta discipline judges real fileChanges end to end.
// ===========================================================================

function writePayload(filePath: string, content: string) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content },
  };
}

describe('dogfooding assembly E2E — wired disciplines (COVENANT-10)', () => {
  it('a gate-disarming command mentioning no protected path is blocked by hooks-stay-armed (exit 2)', () => {
    // The routing-gap pin: before COVENANT-10 this command matched NO registration
    // (path-mention only) and sailed through; the content predicate now routes it.
    const result = runHook(bashPayload('LEFTHOOK=0 git push origin main'));

    expect(result.status).toBe(2);
    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(1);
    expect(records[0].label).toBe('hooks-stay-armed');
    expect(records[0].event).toBe('blocked');
  });

  it('a plain push command passes (exit 0) — the command discipline does not overblock', () => {
    const result = runHook(bashPayload('git push origin main'));

    expect(result.status).toBe(0);
    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(1);
    expect(records[0].event).toBe('passed');
    expect(records[0].label).toBe('adapter-claude-code');
  });

  it('a Write adding banned vocabulary to an in-scope source path is blocked by covenant-vocabulary', () => {
    // Absolute in-scope path that does not exist on disk: pre=null, so the Write's
    // whole content is the added direction. self-mod blocks the same call by path
    // mention (run-all) — the discipline verdict is pinned by its own labeled row.
    const result = runHook(
      writePayload(
        join(repoRoot, 'packages/core/src/e2e-probe.ts'),
        'export const note = 1; // the guard word\n',
      ),
    );

    expect(result.status).toBe(2);
    const { records } = readRecords(telemetryPath);
    const byLabel = (label: string) => records.filter((r) => r.label === label);
    expect(byLabel('covenant-vocabulary').map((r) => r.event)).toEqual(['blocked']);
    expect(byLabel('self-mod').map((r) => r.event)).toEqual(['blocked']);
  });

  it('the same banned-vocabulary Write outside the discipline scope passes (exit 0)', () => {
    const result = runHook(
      writePayload(join(repoRoot, 'docs/e2e-probe.md'), 'prose mentioning the guard word\n'),
    );

    expect(result.status).toBe(0);
    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(1);
    expect(records[0].event).toBe('passed');
    expect(records[0].label).toBe('adapter-claude-code');
  });
});
