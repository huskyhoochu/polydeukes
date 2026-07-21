import { execSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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
 * Spawn the real hook with one payload. The valve is the TTL waiver (the 2026-07-21
 * assembly removed the env hatch): a test that wants the valve open passes
 * `transcriptPath` pointing at a JSONL transcript carrying a fresh human-typed
 * token, and the hook parses it out of the raw payload. Block cases simply omit it —
 * no transcript, no valve (the dispatcher stays on its noopTranscript default).
 */
function runHook(payload: unknown, opts?: { transcriptPath?: string }) {
  const withTranscript =
    typeof payload === 'string' || opts?.transcriptPath === undefined
      ? payload
      : { ...(payload as Record<string, unknown>), transcript_path: opts.transcriptPath };
  const input =
    typeof withTranscript === 'string' ? withTranscript : JSON.stringify(withTranscript);
  return spawnSync(process.execPath, [hookPath], {
    input,
    encoding: 'utf-8',
    env: {
      ...process.env,
      POLYDEUKES_TELEMETRY_PATH: telemetryPath,
    },
  });
}

/**
 * The waiver token the hook will judge against comes from the real root config (this
 * file IS the dogfooding-assembly E2E — it already couples to the repo's own config
 * for protected paths, and the token is no different). Extracted textually so the
 * adapter package gains no dependency on the umbrella loader.
 */
function configuredToken(): string {
  const cfg = readFileSync(join(repoRoot, 'polydeukes.config.yaml'), 'utf-8');
  const match = /^\s*token:\s*'([^']+)'/m.exec(cfg);
  if (!match) throw new Error('waiver token not found in polydeukes.config.yaml');
  return match[1];
}

/** A JSONL transcript whose only entry is a human-typed invocation of the token, sent now. */
function invokingTranscript(): string {
  const path = join(tmpRoot, 'transcript.jsonl');
  writeFileSync(
    path,
    `${JSON.stringify({
      type: 'user',
      origin: { kind: 'human' },
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: configuredToken() },
    })}\n`,
  );
  return path;
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

  it('a fresh human-typed waiver token bypasses a blocked edit (exit 0) and both bypasses are measured', () => {
    // The valve property the removed env hatch used to pin, restated for the TTL
    // waiver: a transcript carrying the config token as a fresh human utterance
    // (first line, alone — COVENANT-15) opens the valve for this dispatch, the edit
    // rides through with exit 0, and every skipped judgment is measured `bypassed`,
    // never silent. This is the only hook-level test of the transcript_path →
    // dispatcher → waiver wiring; the predicate itself is pinned in the covenant
    // package and the provider in transcript-waiver.e2e.
    const result = runHook(editPayload('packages/covenant/src/dispatch.ts'), {
      transcriptPath: invokingTranscript(),
    });

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

// ===========================================================================
// CONFIG-03 §5.3 — config-file consumption: config-absence fail-closed and the
// config file itself joining the protection surface.
// ===========================================================================

describe('CONFIG-03 assembly E2E — config discovery is fail-closed and self-protecting', () => {
  it('an Edit targeting polydeukes.config.yaml itself is blocked (exit 2, config self-protection)', () => {
    // AC §5.3 (last item): after the dogfooding migration the discovered config file is
    // auto-attached to the protection surface (schema rule 6), so editing it must block.
    // Mutation caught: the loader failing to self-attach configPath, leaving the config
    // file editable. This passes only AFTER migration — expected to fail in RED.
    const result = runHook(editPayload('polydeukes.config.yaml'));

    expect(result.status).toBe(2);
    const { records } = readRecords(telemetryPath);
    // The config file lives on the self-mod (tool-axis) protection surface.
    const byLabel = (label: string) => records.filter((r) => r.label === label);
    expect(byLabel('self-mod').map((r) => r.event)).toEqual(['blocked']);
  });

  it('the hook fails closed (exit 2) when spawned against a rootDir that has no config file', () => {
    // AC §5.3 (item "config 파일이 없는 rootDir → exit 2"): silent defaults are
    // forbidden, so a repoRoot with no polydeukes.config.{yaml,yml,json} must block
    // EVERY call. Mutation caught: the loader returning an empty/default config on
    // absence instead of throwing (the whole covenant surface would silently vanish).
    //
    // Harness note: the real hook resolves repoRoot purely from its own file location
    // (`.claude/hooks/../..`) with no env override. To exercise a configless rootDir at
    // the E2E level we copy the hook into a temp tree whose `packages` is a symlink back
    // to the real repo (so the dist imports still resolve) but which has NO config file.
    // This is the most faithful configless-root spawn the current harness supports; if a
    // future hook gains a repoRoot seam this can collapse to a plain env override.
    const configlessRoot = mkdtempSync(join(tmpdir(), 'pdks-configless-'));
    try {
      mkdirSync(join(configlessRoot, '.claude', 'hooks'), { recursive: true });
      cpSync(hookPath, join(configlessRoot, '.claude', 'hooks', 'covenant-pretooluse.mjs'));
      symlinkSync(join(repoRoot, 'packages'), join(configlessRoot, 'packages'), 'dir');

      const copiedHook = join(configlessRoot, '.claude', 'hooks', 'covenant-pretooluse.mjs');
      const result = spawnSync(process.execPath, [copiedHook], {
        input: JSON.stringify(editPayload('docs/example.md')),
        encoding: 'utf-8',
        env: {
          ...process.env,
          POLYDEUKES_TELEMETRY_PATH: telemetryPath,
        },
      });

      expect(result.status).toBe(2);
    } finally {
      rmSync(configlessRoot, { recursive: true, force: true });
    }
  });
});
