import { execSync, spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
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
 * Spawn the real hook with one payload. The valve is the TTL witness (the 2026-07-21
 * assembly removed the env witness): a test that wants the valve open passes
 * `transcriptPath` pointing at a JSONL transcript carrying a fresh human-typed
 * token, and the hook parses it out of the raw payload. Block cases simply omit it —
 * no transcript, no valve (the dispatcher stays on its noopTranscript default).
 * `env` entries are spread over the spawn env last, so a test can hand the hook a
 * real HOME (the COVENANT-07c block) without touching the telemetry seam callers rely on.
 */
function runHook(
  payload: unknown,
  opts?: { transcriptPath?: string; env?: Record<string, string> },
) {
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
      ...opts?.env,
    },
  });
}

/**
 * The witness token the hook will judge against comes from the real root config (this
 * file IS the dogfooding-assembly E2E — it already couples to the repo's own config
 * for protected paths, and the token is no different). Extracted textually so the
 * adapter package gains no dependency on the umbrella loader.
 */
function configuredToken(): string {
  const cfg = readFileSync(join(repoRoot, 'polydeukes.config.yaml'), 'utf-8');
  const match = /^\s*token:\s*'([^']+)'/m.exec(cfg);
  if (!match) throw new Error('witness token not found in polydeukes.config.yaml');
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
  // The live config's `manifest-needs-npm-view` entry is scoped to package manifests, which
  // are not protected AT THE SESSION SURFACE this suite drives (CONFIG-08 put them on the
  // commit surface's additive list) — so these payloads reach the context family alone,
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
    // carries no session blocks every matching edit with no way through — and the witness
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

    const result = runHook(writePayload(manifest, dependencyLine), {
      transcriptPath,
    });

    expect(result.status).toBe(2);
  });

  it('protects the transcript itself — a command that would delete it is blocked', () => {
    // The skip disposition above is only safe if the evidence channel cannot be removed
    // on purpose. The transcript is what the context family reads AND what the witness
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
    // token passes. Debugging a session must not require the witness.
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

  it('a fresh human-typed witness token witnesses the blocked edit open (exit 0), would-block only', () => {
    // The valve property the removed env witness used to pin, restated for the TTL
    // witness AFTER COVENANT-17 moved it behind the verdict: a transcript carrying the
    // config token as a fresh human utterance (first line, alone — COVENANT-15) lets a
    // judgment that actually BLOCKED through as `witnessed`, while the sibling
    // registration that upheld records its true `passed` — under the old routing-time
    // valve both rows collapsed into bypasses. This is the only hook-level test of the
    // transcript_path → dispatcher → witness wiring; the predicate itself is pinned in
    // the covenant package and the provider in transcript-witness.e2e.
    const result = runHook(editPayload('.claude/hooks/covenant-pretooluse.mjs'), {
      transcriptPath: invokingTranscript(),
    });

    expect(result.status).toBe(0);
    const { records } = readRecords(telemetryPath);
    const byLabel = (label: string) => records.filter((r) => r.label === label);
    expect(byLabel('self-mod').map((r) => r.event)).toEqual(['witnessed']);
    expect(byLabel('shell-mod').map((r) => r.event)).toEqual(['passed']);
    expect(records.length).toBe(2);
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
      // DIST-01: the delegator hook resolves its packages through BARE specifiers
      // (`await import('polydeukes')`), so the fixture tree must also reach the real
      // installation graph. Without this link the spawn dies ERR_MODULE_NOT_FOUND at
      // the SAME exit 2 this case asserts — green for the wrong reason.
      symlinkSync(join(repoRoot, 'node_modules'), join(configlessRoot, 'node_modules'), 'dir');

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

// The transcript fixture the 07c block below spawns against (hoisted out of the 07b
// block when its B2 pin flipped). The definite tail is what a path-notation form is
// matched on, which is why the fixture can live under the temp root and still be the
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

describe('dogfooding assembly E2E — path notation variants (COVENANT-07b)', () => {
  // The transcript assembly attaches from the payload (COVENANT-13) is the surface `~`
  // and `$HOME` are written against. The path-mention judges expand neither — but since
  // COVENANT-07c the home value IS injected, as plain data, into the transcript-mod
  // predicate alone (its block sits below this one); the path-mention judges exercised
  // here still expand nothing, so a notation form is matched on the definite tail only.
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

  it('a cancelling prefix that descends again is blocked on the Bash axis (exit 2)', () => {
    // The axis end that broke the previous attempt: cancellation in the MIDDLE of a path
    // rather than at its end. `tmp/../.claude` is the same directory as `.claude`, and a
    // resolution pass that only handles a trailing `..` loses the match while every fixture
    // it wrote stayed green.
    const result = runHook(bashPayload('rm -rf tmp/../.claude/hooks'));

    expect(result.status).toBe(2);
    expect(rowsFor('shell-mod').map((r) => r.event)).toEqual(['blocked']);
    expect(rowsFor('shell-mod').map((r) => r.subject)).toEqual(['.claude/hooks']);
  });

  it('a glob spelling of the same target is recorded skipped — the silence removed (COVENANT-10b)', () => {
    // 07b's silence pin, flipped by 10b exactly as its comment promised. The pass stays —
    // expanding a glob still needs the filesystem, so no judge guesses a target — but a
    // mutation-capable command whose target cannot be judged now leaves ONE common skipped
    // row instead of nothing (PRD §3.2).
    const result = runHook(bashPayload('rm packages/*/dist/index.js'));

    expect(result.status).toBe(0);
    const skipped = readRecords(telemetryPath).records.filter((r) => r.event === 'skipped');
    expect(skipped.map((r) => r.label)).toEqual(['shell-unjudgeable']);
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

// ===========================================================================
// COVENANT-07c — the transcript moves off protectedPaths into its own matches
// predicate, so protecting it stops making the home directory a protected
// ancestor. The forgery spellings close (audit B2, pinned OPEN by 07b in this
// file until now) and the COVENANT-13 over-block on the literal absolute home
// dissolves with the root that caused it.
// ===========================================================================

describe('dogfooding assembly E2E — transcript protection without a home ancestor (COVENANT-07c)', () => {
  // Every spawn hands the hook a real HOME (raw env, injected into the transcript-mod
  // predicate as data) and attaches a real session under that home, so the home-relative
  // spellings below name the same file the payload declares.
  const rowsFor = (label: string) =>
    readRecords(telemetryPath).records.filter((r) => r.label === label);

  it('a "~" append to the transcript is blocked by transcript-mod, not shell-mod (exit 2) — audit B2 closes', () => {
    // The flip of 07b's "audit B2 stays open" pin, which lived in the block above until
    // this ticket. Asserting WHO answered: the subject must be the ABSOLUTE transcript
    // path (the canonical spelling, not the typed one — roi.log rows must name the real
    // file), and shell-mod must stay silent — the transcript is no longer in its
    // protectedPaths, so a shell-mod row here means the home-ancestor root is back.
    const transcriptPath = sessionTranscript();

    const result = runHook(bashPayload(`echo forged >> ~/${TRANSCRIPT_TAIL}`), {
      transcriptPath,
      env: { HOME: tmpRoot },
    });

    expect(result.status).toBe(2);
    expect(rowsFor('transcript-mod').map((r) => [r.event, r.subject])).toEqual([
      ['blocked', transcriptPath],
    ]);
    expect(rowsFor('shell-mod')).toEqual([]);
  });

  it('cd into the literal absolute home passes with no judge row (exit 0) — the COVENANT-13 over-block dissolves', () => {
    // `cd /home/<user>` has blocked since COVENANT-13: the transcript in protectedPaths
    // made home a protected ANCESTOR (§1 — unnoticed only because nobody types the
    // absolute spelling). Mutation caught: a fix that closes the `~` spellings but keeps
    // the transcript in protectedPaths (07b's withdrawn shape) leaves this blocked —
    // §3 demands the root goes, not the symptom.
    const transcriptPath = sessionTranscript();

    const result = runHook(bashPayload(`cd ${tmpRoot}`), {
      transcriptPath,
      env: { HOME: tmpRoot },
    });

    expect(result.status).toBe(0);
    expect(rowsFor('transcript-mod')).toEqual([]);
    expect(rowsFor('shell-mod')).toEqual([]);
  });

  it('ancestor destruction outside the repo stays out of scope — transcript-mod silent (exit 0)', () => {
    // §2 scope principle, designed pass made audible (07b's non-goal convention): the
    // predicate protects the transcript FILE only, never an ancestor directory — that
    // surface is declared out of observation scope and parked with agent deny policy.
    // The disciplines layer MAY leave a shell-unjudgeable skipped row for the rm;
    // deliberately not asserted either way — the pin is that the transcript predicate
    // stays silent and nothing blocks.
    const transcriptPath = sessionTranscript();

    const result = runHook(bashPayload('rm -rf ~/.claude/projects'), {
      transcriptPath,
      env: { HOME: tmpRoot },
    });

    expect(result.status).toBe(0);
    expect(rowsFor('transcript-mod')).toEqual([]);
  });

  it('an edit whose CONTENT carries a bare "~" and the transcript spelling passes (exit 0)', () => {
    // Content is mention, not target: the Edit's own fileChange proves the unrelated
    // file, so the tool axis never reads args. Mutation caught: the predicate's fallback
    // (or an args scan on the evidence branch) breaking on the spelling inside
    // new_string — the withdrawn 07b registration refused exactly this edit shape.
    const transcriptPath = sessionTranscript();
    const notesPath = join(tmpRoot, 'notes.md');
    writeFileSync(notesPath, 'draft line\n');

    const result = runHook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Edit',
        tool_input: {
          file_path: notesPath,
          old_string: 'draft line',
          new_string: `see ~/${TRANSCRIPT_TAIL} and the bare ~ marker`,
        },
      },
      { transcriptPath, env: { HOME: tmpRoot } },
    );

    expect(result.status).toBe(0);
    expect(rowsFor('transcript-mod')).toEqual([]);
  });
});

// ===========================================================================
// COVENANT-10b §3.1–3.3 — the shell axis stops passing mutations silently.
// The same banned content a Write delivers blocked (COVENANT-10 above) arrived
// by heredoc/redirect as exit 0 with ZERO rows (audit B3): no evidence, no
// routing, not even a skipped. 10b derives evidence where the command text
// makes it computable, records an entry-scoped or common `skipped` where it
// does not, and keeps signal-free calls silent. NotebookEdit closes the same
// gap's tool-axis form. Every case spawns the real hook; all but the two
// volume-defence pins are RED against the current dist by design.
// ===========================================================================

describe('dogfooding assembly E2E — shell-delivered mutations and NotebookEdit (COVENANT-10b)', () => {
  // A probe path inside covenant-vocabulary's scope that never exists on disk, so the
  // judgment-time pre read answers ENOENT and the whole delivered text is the added
  // direction — same fixture logic as the COVENANT-10 Write block above.
  const SCOPED_SOURCE = 'packages/core/src/e2e-probe.ts';
  const BANNED_LINE = 'export const note = 1; // the guard word';

  const rowsFor = (label: string) =>
    readRecords(telemetryPath).records.filter((r) => r.label === label);
  const skippedRows = () => readRecords(telemetryPath).records.filter((r) => r.event === 'skipped');

  it('a heredoc delivering a banned word into a discipline-scoped file is blocked (exit 2)', () => {
    // The B3 bypass itself: a quoted delimiter makes the body literal, so the text is computable.
    const result = runHook(
      bashPayload([`cat > ${SCOPED_SOURCE} <<'EOF'`, BANNED_LINE, 'EOF'].join('\n')),
    );

    expect(result.status).toBe(2);
    expect(rowsFor('covenant-vocabulary').map((r) => r.event)).toEqual(['blocked']);
  });

  it('an append redirect delivering a banned word into the same scope is blocked (exit 2)', () => {
    // Append composes pre at judgment time (absence = create), so the echoed line IS the added text.
    const result = runHook(bashPayload(`echo '${BANNED_LINE}' >> ${SCOPED_SOURCE}`));

    expect(result.status).toBe(2);
    expect(rowsFor('covenant-vocabulary').map((r) => r.event)).toEqual(['blocked']);
  });

  it('a sed -i over a scoped file is recorded skipped under EACH discipline scoping it (exit 0)', () => {
    // Content incomputable, target known: one row per entry whose scope covers this path,
    // attributed to the entry id and never the common label. Since the CONFIG-08 review
    // widened covenant-vocabulary to the wildcard pair, adapter-git src is inside two
    // scopes — this pin also proves the widening reached the live config.
    //
    // The third row skips for a DIFFERENT reason: it is a context-family entry, and this
    // run injects no transcript, so its evidence question cannot be asked at all. Two
    // reasons share one lane, which is why the pin enumerates rather than counts.
    const result = runHook(
      bashPayload("sed -i 's/alpha/beta/' packages/adapter-git/src/collect.ts"),
    );

    expect(result.status).toBe(0);
    expect(skippedRows().map((r) => [r.label, r.subject])).toEqual([
      ['covenant-vocabulary', 'packages/adapter-git/src/collect.ts'],
      ['english-only-sources', 'packages/adapter-git/src/collect.ts'],
      ['adapter-needs-knowledge-read', 'packages/adapter-git/src/collect.ts'],
    ]);
  });

  it('a redirect to an opaque target leaves one common skipped row, never one per entry (exit 0)', () => {
    // No target path means no entry attribution — fan-out would multiply noise by the entry count.
    const result = runHook(bashPayload('echo x > $F'));

    expect(result.status).toBe(0);
    expect(skippedRows().map((r) => r.label)).toEqual(['shell-unjudgeable']);
  });

  it('a nested shell invocation leaves one common skipped row (exit 0)', () => {
    // 04a already answers nested shells indeterminate; 10b records that answer instead of dropping it.
    const result = runHook(bashPayload('bash x.sh'));

    expect(result.status).toBe(0);
    expect(skippedRows().map((r) => r.label)).toEqual(['shell-unjudgeable']);
  });

  it('a signal-free command stays silent — the volume defence (exit 0, adapter row only)', () => {
    // No detected mutation, no write redirect, no opaque token: a recovery build must never cost a row.
    const result = runHook(bashPayload('pnpm build'));

    expect(result.status).toBe(0);
    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(1);
    expect(records[0].event).toBe('passed');
    expect(records[0].label).toBe('adapter-claude-code');
  });

  it('a read-only command carrying a glob stays silent — an opaque token alone is no signal (exit 0)', () => {
    // `ls` sits on the read-only allowlist, so its glob cannot mean a write the derivation missed.
    const result = runHook(bashPayload('ls *.md'));

    expect(result.status).toBe(0);
    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(1);
    expect(records[0].event).toBe('passed');
    expect(records[0].label).toBe('adapter-claude-code');
  });

  it('a NotebookEdit delivering a banned word into a scoped cell is blocked (exit 2)', () => {
    // The tool-axis half of B3: the hook matcher names four tools, the evidence set covered
    // three. The notebook must exist — cell evidence reads the target cell's pre from it.
    const notebookPath = join(repoRoot, 'packages/core/src/e2e-probe.ipynb');
    writeFileSync(
      notebookPath,
      JSON.stringify({
        cells: [{ id: 'cell-one', cell_type: 'code', source: "print('original')", metadata: {} }],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      }),
    );
    try {
      const result = runHook({
        hook_event_name: 'PreToolUse',
        tool_name: 'NotebookEdit',
        tool_input: {
          notebook_path: notebookPath,
          cell_id: 'cell-one',
          new_source: "print('x')  # the guard word",
          cell_type: 'code',
          edit_mode: 'replace',
        },
      });

      expect(result.status).toBe(2);
      expect(rowsFor('covenant-vocabulary').map((r) => r.event)).toEqual(['blocked']);
    } finally {
      rmSync(notebookPath, { force: true });
    }
  });
});

// ===========================================================================
// COVENANT-10b §2-d / §3.1–3.3 — gap-closing round (set-level audit). The 10b
// block above pins each disposition once; these pin the set ends it never
// tried: a protected-path notebook surviving the evidence takeover (§2-d,
// "evidence must not narrow existing blocking"), both attribution boundaries
// of the computable axis (out of every scope / clean in scope), a real
// on-disk pre for append composition, and a violation arriving second in a
// chain. G4' and G2' hold against the current dist (mention fallback, silent
// no-match) and exist to keep holding once the derivation lands; the rest
// are RED by design.
// ===========================================================================

describe('dogfooding assembly E2E — evidence set gaps (COVENANT-10b gap round)', () => {
  const SCOPED_SOURCE = 'packages/core/src/e2e-probe.ts';
  const BANNED_LINE = 'export const note = 1; // the guard word';

  const rowsFor = (label: string) =>
    readRecords(telemetryPath).records.filter((r) => r.label === label);
  const skippedRows = () => readRecords(telemetryPath).records.filter((r) => r.event === 'skipped');

  it('a NotebookEdit on a protected-path notebook stays blocked by self-mod (exit 2)', () => {
    // G4' — the fail-open direction §2-d names: today the mention fallback blocks this
    // call; once NotebookEdit carries cell evidence the proven-target branch answers
    // instead, and an evidence path that passes validity while dodging protected matching
    // would replay the 07b fail-open shape. The notebook is real and parseable ON PURPOSE
    // so evidence lands and the pin holds across the takeover.
    const notebookPath = join(repoRoot, 'packages/core/dist/e2e-probe.ipynb');
    writeFileSync(
      notebookPath,
      JSON.stringify({
        cells: [{ id: 'cell-one', cell_type: 'code', source: "print('original')", metadata: {} }],
        metadata: {},
        nbformat: 4,
        nbformat_minor: 5,
      }),
    );
    try {
      const result = runHook({
        hook_event_name: 'PreToolUse',
        tool_name: 'NotebookEdit',
        tool_input: {
          notebook_path: notebookPath,
          cell_id: 'cell-one',
          // Clean cell content on purpose: only the protected PATH can explain a block.
          new_source: "print('probe')",
          cell_type: 'code',
          edit_mode: 'replace',
        },
      });

      expect(result.status).toBe(2);
      expect(rowsFor('self-mod').map((r) => r.event)).toEqual(['blocked']);
    } finally {
      rmSync(notebookPath, { force: true });
    }
  });

  it('a computable write outside every scope leaves only the adapter funnel row (exit 0)', () => {
    // G2' — computable-but-unmatched is a pass, not an unjudgeable: a target no entry
    // scopes must produce zero discipline rows AND zero common-skip rows.
    const result = runHook(bashPayload('echo x > /tmp/y.ts'));

    expect(result.status).toBe(0);
    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(1);
    expect(records[0].event).toBe('passed');
    expect(records[0].label).toBe('adapter-claude-code');
  });

  it('a clean computable write into scope is passed and never also skipped (exit 0)', () => {
    // G3' — one derivation, one answer: a judged write that ALSO drops a skipped row
    // would double-record every computable call and drown the skip lane it feeds.
    const result = runHook(bashPayload(`echo 'const ok = 1;' >> ${SCOPED_SOURCE}`));

    expect(result.status).toBe(0);
    expect(rowsFor('covenant-vocabulary').map((r) => r.event)).toEqual(['passed']);
    // Every entry that JUDGED this write is absent from the skip lane, and a computable
    // derivation forbids the common shell-unjudgeable row — that pair is G3'. The one row
    // left belongs to a context-family entry, which judged nothing: this run injects no
    // transcript, so its question was unaskable rather than answered a second time.
    expect(skippedRows().map((r) => r.label)).toEqual(['core-needs-knowledge-read']);
  });

  it('an append composing a real on-disk pre still blocks the banned addition (exit 2)', () => {
    // G1' — every sibling's pre is ENOENT (= create); a real pre exercises the judgment-
    // time disk read and pre/post composition, and the relative target sits where only a
    // repo-root resolution finds it — the hook process cwd holds no such file.
    const realTarget = 'packages/core/src/e2e-probe-real.ts';
    const realTargetAbs = join(repoRoot, realTarget);
    writeFileSync(realTargetAbs, 'export const cleanBase = 1;\n');
    try {
      const result = runHook(bashPayload(`echo '${BANNED_LINE}' >> ${realTarget}`));

      expect(result.status).toBe(2);
      expect(rowsFor('covenant-vocabulary').map((r) => r.event)).toEqual(['blocked']);
    } finally {
      rmSync(realTargetAbs, { force: true });
    }
  });

  it('a violation delivered by the second command of a chain is still blocked (exit 2)', () => {
    // G5' — two writes, two targets, the banned one second: an implementation keeping a
    // single evidence per call would let chain position launder the violation.
    const chained = `echo probe > /tmp/pdks-chain.ts && echo '${BANNED_LINE}' > ${SCOPED_SOURCE}`;
    const result = runHook(bashPayload(chained));

    expect(result.status).toBe(2);
    expect(rowsFor('covenant-vocabulary').map((r) => r.event)).toEqual(['blocked']);
  });
});

// ===========================================================================
// CONFIG-08 §4.2 — the session surface never reads the git namespace. The
// commit-only additive list (adapters.git.protectedPaths) exists so judgment-
// chain sources can block at promotion time while staying free during work;
// that split only holds if the hook's observation scope stays the COMMON
// list. Spawned through the configless-root harness shape (hook copied into
// a fixture tree whose packages/ symlinks back to the real dist) because the
// pinned vocabulary must live in a config the TEST authors — the real repo
// config cannot carry throwaway entries.
// ===========================================================================

describe('dogfooding assembly E2E — session surface ignores the git-additive list (CONFIG-08)', () => {
  // Injected fixture values: the additive entry names the exact target the session
  // payload edits, and the common list carries the M2 untracked-directory entry.
  const GIT_ADDITIVE_ENTRY = 'packages/core/src';
  const COMMON_UNTRACKED_ENTRY = '.git/hooks';

  const rowsFor = (label: string) =>
    readRecords(telemetryPath).records.filter((r) => r.label === label);

  /** Copy the real hook into a fixture tree carrying the CONFIG-08 target-state config. */
  function runHookWithFixtureConfig(payload: unknown) {
    const fixtureRoot = join(tmpRoot, 'fixture-tree');
    mkdirSync(join(fixtureRoot, '.claude', 'hooks'), { recursive: true });
    cpSync(hookPath, join(fixtureRoot, '.claude', 'hooks', 'covenant-pretooluse.mjs'));
    symlinkSync(join(repoRoot, 'packages'), join(fixtureRoot, 'packages'), 'dir');
    // DIST-01: the delegator hook resolves its packages through BARE specifiers, so
    // the fixture tree must also reach the real installation graph — without this
    // link the spawn dies ERR_MODULE_NOT_FOUND before any judgment.
    symlinkSync(join(repoRoot, 'node_modules'), join(fixtureRoot, 'node_modules'), 'dir');
    writeFileSync(
      join(fixtureRoot, 'polydeukes.config.json'),
      JSON.stringify(
        {
          languages: { typescript: { productionGlob: 'lib/**/*.ts', testCmd: 'echo {scope}' } },
          telemetry: { logPath: telemetryPath },
          protectedPaths: [COMMON_UNTRACKED_ENTRY],
          adapters: { git: { enforce: 'block', protectedPaths: [GIT_ADDITIVE_ENTRY] } },
        },
        null,
        2,
      ),
    );
    return spawnSync(
      process.execPath,
      [join(fixtureRoot, '.claude', 'hooks', 'covenant-pretooluse.mjs')],
      {
        input: JSON.stringify(payload),
        encoding: 'utf-8',
        env: { ...process.env, POLYDEUKES_TELEMETRY_PATH: telemetryPath },
      },
    );
  }

  it('an Edit under a git-additive path passes the session surface with no witness (exit 0)', () => {
    // §4.2 contract pin: "the hook does not read the git namespace" is a promise, not
    // an omission — source stays free during work and gates only at promotion. The
    // additive entry names this exact target, so ANY reading of it shows up here.
    // Mutation caught: the hook assembly unioning adapters.git.protectedPaths (self-mod
    // blocks, exit 2), or loadConfig fail-fasting on the new vocabulary (fail-closed
    // exit 2 with an adapter blocked row instead of the passed funnel row).
    const result = runHookWithFixtureConfig(editPayload(`${GIT_ADDITIVE_ENTRY}/index.ts`));

    expect(result.status).toBe(0);
    const { records } = readRecords(telemetryPath);
    expect(records.length).toBe(1);
    expect(records[0].event).toBe('passed');
    expect(records[0].label).toBe('adapter-claude-code');
  });

  it('a Write into .git/hooks is blocked by self-mod on the session surface (exit 2)', () => {
    // M2's session half: .git/hooks is git-untracked, so the commit surface can never
    // observe it — the common list is the ONE layer that can watch the generated hook,
    // and the session must own that block. The self-mod label separates a verdict from
    // a fail-closed collapse on the same exit code. Mutation caught: an untracked
    // directory entry dropped from tool-axis ancestor matching, or the fixture config
    // dying in loadConfig (adapter blocked row, no self-mod row).
    const result = runHookWithFixtureConfig(
      writePayload(`${COMMON_UNTRACKED_ENTRY}/pre-commit`, '#!/bin/sh\nexit 0\n'),
    );

    expect(result.status).toBe(2);
    expect(rowsFor('self-mod').map((r) => [r.event, r.subject])).toEqual([
      ['blocked', '.git/hooks'],
    ]);
  });
});
