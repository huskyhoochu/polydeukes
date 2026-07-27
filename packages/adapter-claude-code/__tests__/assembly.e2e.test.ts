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

describe('context family across the session boundary (COVENANT-13 §4.5)', () => {
  // The live config's `dependency-needs-npm-view` entry is scoped to package manifests,
  // which are NOT protected paths — so these payloads reach the context family alone,
  // with no meta-covenant verdict mixed in. Until now the whole family was exercised by
  // hand at assembly time and pinned by nothing; the first review found it inert on the
  // very cases it exists for, and the third found the session boundary mishandled.
  // Two context entries share this scope — one wants a measured version (`command`), one
  // wants the docs read (`tool`, the adapter's own vocabulary). Neither carries a `when`,
  // so the content below is irrelevant to the trigger: touching a manifest is the trigger.
  const manifest = 'packages/scratch/package.json';
  const dependencyLine = '{\n  "left-pad": "^1.3.0"\n}\n';
  const CONTEXT_ENTRIES = ['manifest-needs-context7', 'manifest-needs-npm-view'];

  it('skips rather than blocks when no transcript accompanies the payload', () => {
    // No evidence channel is not "no evidence". Demanding session proof from a call that
    // carries no session blocks every matching edit with no way through — and the waiver
    // reads the same absence, so the valve is shut on the identical input.
    const result = runHook(writePayload(manifest, dependencyLine));

    expect(result.status).toBe(0);
    const { records } = readRecords(telemetryPath);
    expect(
      records
        .filter((r) => r.event === 'skipped')
        .map((r) => r.label)
        .sort(),
    ).toEqual(CONTEXT_ENTRIES);
  });

  it('blocks the same write when a session exists but carries no npm view', () => {
    // The contrast that keeps the skip honest: a readable, empty transcript IS a session,
    // and a session with no evidence is a real block. Mutation caught: the skip widened
    // to swallow this case, which would make the discipline inert on its own purpose.
    const transcriptPath = join(tmpRoot, 'no-evidence.jsonl');
    writeFileSync(transcriptPath, '');

    const result = runHook(writePayload(manifest, dependencyLine), { transcriptPath });

    expect(result.status).toBe(2);
  });

  it('protects the transcript itself — a command that would delete it is blocked', () => {
    // The skip disposition above is only safe if the evidence channel cannot be removed
    // on purpose. The transcript is what the context family reads AND what the waiver
    // reads, it lives outside the repository so no config `protectedPaths` entry can
    // reach it, and deleting it would disable every context discipline while shutting
    // the human valve on the same absence. Assembly knows the path, so assembly protects
    // it. Mutation caught: the payload's transcript_path dropped from the protected set.
    const transcriptPath = join(tmpRoot, 'live-session.jsonl');
    writeFileSync(transcriptPath, '');

    const result = runHook(bashPayload(`rm ${transcriptPath}`), { transcriptPath });

    expect(result.status).toBe(2);
  });

  it('still allows reading the transcript it protects', () => {
    // Protection is the shell axis's ordinary rule, not a new one: a read-only first
    // token passes. Debugging a session must not require the waiver.
    const transcriptPath = join(tmpRoot, 'live-session.jsonl');
    writeFileSync(transcriptPath, '');

    const result = runHook(bashPayload(`cat ${transcriptPath}`), { transcriptPath });

    expect(result.status).toBe(0);
  });

  it('skips when the transcript path is present but unreadable', () => {
    // The likelier anomaly, and the one the previous attempt missed: a rotated or deleted
    // session file used to arrive as an empty transcript, indistinguishable from a fresh
    // session, so it blocked with no message naming the cause and no `npm view` able to
    // help — the evidence was read from the same unreadable file.
    const result = runHook(writePayload(manifest, dependencyLine), {
      transcriptPath: join(tmpRoot, 'rotated-away.jsonl'),
    });

    expect(result.status).toBe(0);
  });
});

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

  it('an Edit on a protected gate file is blocked by self-mod (exit 2) with run-all rows', () => {
    const result = runHook(editPayload('.claude/hooks/covenant-pretooluse.mjs'));

    expect(result.status).toBe(2);
    const { records } = readRecords(telemetryPath);
    const byLabel = (label: string) => records.filter((r) => r.label === label);
    expect(byLabel('self-mod').map((r) => r.event)).toEqual(['blocked']);
    // run-all coexistence: shell-mod judged the same call on its own axis and upheld.
    expect(byLabel('shell-mod').map((r) => r.event)).toEqual(['passed']);
    expect(records.length).toBe(2);
  });

  it('a Bash sed -i on a protected gate file is blocked by shell-mod (exit 2)', () => {
    const result = runHook(
      bashPayload("sed -i 's/exit 2/exit 0/' .claude/hooks/covenant-pretooluse.mjs"),
    );

    expect(result.status).toBe(2);
    const { records } = readRecords(telemetryPath);
    const byLabel = (label: string) => records.filter((r) => r.label === label);
    expect(byLabel('shell-mod').map((r) => r.event)).toEqual(['blocked']);
    expect(byLabel('self-mod').map((r) => r.event)).toEqual(['passed']);
    expect(records.length).toBe(2);
  });

  it('a read-only allowlisted command mentioning a protected path passes (exit 0)', () => {
    const result = runHook(bashPayload('cat .claude/hooks/covenant-pretooluse.mjs'));

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
    const result = runHook(editPayload('.claude/hooks/covenant-pretooluse.mjs'), {
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
// predicate routing), and a delta discipline judges real file-change evidence end to end.
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
    // Absolute in-scope path that does not exist on disk: pre=null, so the Write's whole
    // content is the added direction. Since the protected surface narrowed to gate files
    // (2026-07-26) the meta-covenants no longer route here at all, so this is the
    // discipline judging alone — which is what a user's own repository looks like.
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
    // No meta-covenant row: a package source is not a gate file, so nothing but the
    // discipline had anything to say about this call.
    expect(byLabel('self-mod')).toEqual([]);
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

// ===========================================================================
// COVENANT-07b §3.4 — path NOTATION at the assembly boundary. Every spawn above
// names its target literally, which is how seven measured bypass forms stayed
// green underneath a passing suite (PRD §2-c): the mention never formed, so no
// judgment step ever ran on them. One spawn per notation family, each pinning
// WHICH judge answered — a fail-closed collapse is also exit 2, but it records
// against the adapter, so only the label separates a verdict from a crash.
// ===========================================================================

describe('dogfooding assembly E2E — path notation variants (COVENANT-07b)', () => {
  // The transcript assembly attaches from the payload (COVENANT-13) is the surface `~`
  // and `$HOME` are written against. The judge expands neither — no home value is
  // injected anywhere (PRD §2-b) — so what a notation form is matched on is the definite
  // tail below, which is why this fixture can live under the temp root and still be the
  // comparison the real session makes.
  const TRANSCRIPT_DIR_PARTS = ['.claude', 'projects', '-home-u-proj'];
  const TRANSCRIPT_FILE = 'session.jsonl';
  const TRANSCRIPT_TAIL = [...TRANSCRIPT_DIR_PARTS, TRANSCRIPT_FILE].join('/');

  /** An empty session file at that tail — a real session that has said nothing. */
  function sessionTranscript(): string {
    const dir = join(tmpRoot, ...TRANSCRIPT_DIR_PARTS);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, TRANSCRIPT_FILE);
    writeFileSync(path, '');
    return path;
  }

  const rowsFor = (label: string) =>
    readRecords(telemetryPath).records.filter((r) => r.label === label);

  it('a redirect written through an interior "." is blocked on the Bash axis (exit 2)', () => {
    // Measured bypass, interior-dot family. The target names a judge executable and the
    // command is nowhere near read-only, yet today it exits 0 with no judge row at all.
    // Mutation caught: the fix landing in the predicate but never reaching the assembled
    // hook — the failure mode this file exists to catch and previously did not.
    const result = runHook(bashPayload('echo x >> packages/core/./dist/index.js'));

    expect(result.status).toBe(2);
    expect(rowsFor('shell-mod').map((r) => r.event)).toEqual(['blocked']);
  });

  it('a sed -i whose target cancels through ".." is blocked on the Bash axis (exit 2)', () => {
    // Same family, different write-detection rule: the target here is extracted by the
    // sed-in-place rule rather than read off a redirect. Mutation caught: normalization
    // added at one extraction site instead of in the shared primitive, which leaves the
    // other rules judging raw strings (the drift that produced COVENANT-07 itself).
    const result = runHook(bashPayload('sed -i s/a/b/ packages/core/src/../dist/index.js'));

    expect(result.status).toBe(2);
    expect(rowsFor('shell-mod').map((r) => r.event)).toEqual(['blocked']);
  });

  it('a middle glob standing in for a package name is blocked (exit 2)', () => {
    // Glob family, directory-shaped protected path. One command removes every judge
    // executable on the surface; today the dispatcher routes it nowhere.
    const result = runHook(bashPayload('rm packages/*/dist/index.js'));

    expect(result.status).toBe(2);
    expect(rowsFor('shell-mod').map((r) => r.event)).toEqual(['blocked']);
  });

  it('a trailing glob on a gate FILE is blocked, and on that gate file (exit 2)', () => {
    // Glob family, file-shaped protected path — the asymmetric half (PRD §1), where the
    // glob replaces the protected segment instead of following it. The subject assertion
    // is the second mutation: an over-broad potential match blocks too, but names whichever
    // protected path came first in the config, which would pass an exit-code-only test.
    const result = runHook(bashPayload('rm lefthook.y*'));

    expect(result.status).toBe(2);
    expect(rowsFor('shell-mod').map((r) => r.event)).toEqual(['blocked']);
    expect(rowsFor('shell-mod').map((r) => r.subject)).toEqual(['lefthook.yml']);
  });

  it('an append to the protected transcript in tilde notation is blocked (exit 2)', () => {
    // The audit's B2, end to end: this is the append that writes a forged human utterance
    // into the file the TTL waiver reads, which opens a human-only valve for an agent.
    // Assembly protects the transcript already — one notation is all that stood between
    // that protection and nothing.
    const transcriptPath = sessionTranscript();

    const result = runHook(bashPayload(`echo forged >> ~/${TRANSCRIPT_TAIL}`), { transcriptPath });

    expect(result.status).toBe(2);
    expect(rowsFor('shell-mod').map((r) => r.event)).toEqual(['blocked']);
  });

  it('an rm of that transcript in tilde notation is blocked at the backstop (exit 2)', () => {
    // The same notation reaching a DIFFERENT judgment step. The append above is caught by
    // the redirect-write rule at step (a) — `echo` is itself on the read-only allowlist, so
    // that spawn proves nothing about the mention path. `rm` carries no write rule and no
    // allowlist entry, so it can only be refused by the backstop at (f), which is the step
    // the literal form in the audit's measured list (`rm ~/…jsonl`) actually exercises.
    const transcriptPath = sessionTranscript();

    const result = runHook(bashPayload(`rm ~/${TRANSCRIPT_TAIL}`), { transcriptPath });

    expect(result.status).toBe(2);
    expect(rowsFor('shell-mod').map((r) => r.event)).toEqual(['blocked']);
  });

  it('a $HOME path targeting the protected transcript is blocked (exit 2)', () => {
    // Variable-expansion family. Mutation caught: only `~` taught to the predicate, which
    // leaves the same file reachable by the form a script would more naturally use.
    const transcriptPath = sessionTranscript();

    const result = runHook(bashPayload(`chmod 000 $HOME/${TRANSCRIPT_TAIL}`), { transcriptPath });

    expect(result.status).toBe(2);
    expect(rowsFor('shell-mod').map((r) => r.event)).toEqual(['blocked']);
  });

  it('reading that transcript in tilde notation still passes, judged and upheld (exit 0)', () => {
    // PRD §3.3, and the contract the shipped read-only case above states for literals:
    // debugging a session must not require the waiver. The `passed` row is the load-bearing
    // half — exit 0 alone is what this command already returns today for the opposite
    // reason (no mention, no judgment), so only the row proves the allowlist absolved it
    // rather than the scan missing it.
    const transcriptPath = sessionTranscript();

    const result = runHook(bashPayload(`cat ~/${TRANSCRIPT_TAIL}`), { transcriptPath });

    expect(result.status).toBe(0);
    expect(rowsFor('shell-mod').map((r) => r.event)).toEqual(['passed']);
  });

  it('reading the same transcript through $HOME is blocked, because the token is opaque (exit 2)', () => {
    // The contrast that makes the case above a contract rather than an accident: `~` is
    // not on the tokenizer's opaque list (`$`, `*`, `?`) and `$HOME` is, so one reaches the
    // read-only allowlist at step (e) and the other is refused at step (c) before the
    // allowlist is ever consulted. This ticket does not touch that list or that order
    // (PRD §2-d/§6), so the two reads must part here.
    const transcriptPath = sessionTranscript();

    const result = runHook(bashPayload(`cat $HOME/${TRANSCRIPT_TAIL}`), { transcriptPath });

    expect(result.status).toBe(2);
    expect(rowsFor('shell-mod').map((r) => r.event)).toEqual(['blocked']);
  });

  it('a tool call whose absolute file_path carries an interior "." is blocked by self-mod (exit 2)', () => {
    // One primitive, three consumers (PRD §6): the tool axis reads the same predicate
    // through a different judge, so a fix verified only on Bash payloads leaves the
    // primary axis open. This is the real payload shape — absolute file_path — which is
    // the input form whose absence hid COVENANT-07's regression. Write rather than Edit:
    // Edit's virtual apply depends on what the built dist happens to contain, and a failed
    // apply falls back to the mention branch, so the test would keep passing while no
    // longer pinning the proven-target branch COVENANT-09 introduced.
    const result = runHook(writePayload(`${repoRoot}/packages/core/./dist/index.js`, 'x'));

    expect(result.status).toBe(2);
    expect(rowsFor('self-mod').map((r) => r.event)).toEqual(['blocked']);
  });
});
