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

// Spawns the REAL PreToolUse hook as a black box — real adapter dist, real dispatcher,
// real judge bodies. Spawning the repo-level hook (rather than importing the judge) keeps
// the package dependency graph one-way: this package must not depend on covenant.

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
 * Spawn the real hook with one payload. The valve is the TTL witness: a test that wants
 * the valve open passes `transcriptPath` pointing at a JSONL transcript carrying a fresh
 * human-typed token, and the hook parses it out of the raw payload. Block cases simply
 * omit it — no transcript, no valve. `env` entries are spread over the spawn env last, so
 * a test can hand the hook a real HOME without touching the telemetry seam callers rely on.
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
 * The witness token the hook will judge against comes from the real root config.
 * Extracted textually so the adapter package gains no dependency on the umbrella loader.
 */
function configuredToken(): string {
  const cfg = readFileSync(join(repoRoot, 'polydeukes.config.yaml'), 'utf-8');
  const match = /^\s*token:\s*'([^']+)'/m.exec(cfg);
  if (!match) throw new Error('witness token not found in polydeukes.config.yaml');
  return match[1];
}

/**
 * Read one discipline's `why` out of the live root config — textual for the same reason
 * {@link configuredToken} is.
 *
 * A single-quoted YAML scalar escapes an apostrophe by doubling it, and these values are
 * prose sentences where an apostrophe is ordinary. Matching `[^']*` would stop at the first
 * half of such a pair and hand back a prefix, so the assertion using it would silently check
 * less than it claims. The pair is consumed here and unescaped on the way out.
 */
function configuredWhy(id: string): string {
  const cfg = readFileSync(join(repoRoot, 'polydeukes.config.yaml'), 'utf-8');
  const match = new RegExp(`- id: '${id}'\\n\\s*why: '((?:[^']|'')*)'`).exec(cfg);
  if (!match) throw new Error(`why not found for discipline '${id}'`);
  return match[1].replaceAll("''", "'");
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

describe('context family across the session boundary', () => {
  // Package manifests are not protected at the session surface this suite drives (they sit
  // on the commit surface's additive list), so these payloads reach the history declarations
  // alone, with no meta-covenant verdict mixed in. The manifest declaration has no scope
  // beyond the path: the content below is irrelevant — touching a manifest is what it reads.
  const manifest = 'packages/scratch/package.json';
  const dependencyLine = '{\n  "left-pad": "^1.3.0"\n}\n';
  const CONTEXT_ENTRIES = ['manifest-needs-evidence'];
  const HISTORY_ENTRY = 'tests-before-implementation';

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
      // The unscoped history declaration observes every file-changing call and, with no
      // session injected here, lands beside the context entries under its own `supply: pass`.
    ).toEqual([...CONTEXT_ENTRIES, HISTORY_ENTRY].sort());
  });

  it('judges the same write when a session exists but carries no npm view (advised, not skipped)', () => {
    // The contrast that keeps the skip honest: a readable, empty transcript IS a session,
    // and a session with no evidence is a real break — `advised`, never `skipped`. A skip
    // widened to swallow this case would make the discipline inert on its own purpose.
    const transcriptPath = join(tmpRoot, 'no-evidence.jsonl');
    writeFileSync(transcriptPath, '');

    const result = runHook(writePayload(manifest, dependencyLine), {
      transcriptPath,
    });

    expect(result.status).toBe(0);
    const events = readRecords(telemetryPath)
      .records.filter((r) => CONTEXT_ENTRIES.includes(r.label))
      .map((r) => r.event);
    expect(events.length).toBeGreaterThan(0);
    expect(new Set(events)).toEqual(new Set(['advised']));
  });

  it('protects the transcript itself — a command that would delete it is blocked', () => {
    // The skip disposition above is only safe if the evidence channel cannot be removed
    // on purpose. The transcript is what the context family reads AND what the witness
    // reads, it lives outside the repository so no config `protectedPaths` entry can
    // reach it, and deleting it would disable every context discipline while shutting
    // the human valve on the same absence. Assembly knows the path, so assembly protects it.
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
    // A rotated or deleted session file must not arrive as an empty transcript,
    // indistinguishable from a fresh session: that would block with no message naming the
    // cause and no evidence able to help — it lives in the same unreadable file.
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
    // the gain double-count is caught here rather than in a gain report months later.
    const result = runHook(editPayload('docs/example.md'));

    expect(result.status).toBe(0);
    // The state comparison's own rows are on a different axis from the judgment (they
    // block nothing), so the judged-row count is taken over the verdict lane.
    const records = readRecords(telemetryPath).records.filter(
      (record) => record.event !== 'unattributed',
    );
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
    // The unscoped history declaration observes this call twice, on the lane that blocks
    // nothing: once as the call world its own `supply: pass` disposes of, and once as the
    // shell target whose result this layer cannot compute.
    expect(
      byLabel('tests-before-implementation')
        .map((r) => r.reason)
        .sort(),
    ).toEqual(['no-observation', 'supply-pass']);
  });

  it('a read-only allowlisted command mentioning a protected path passes (exit 0)', () => {
    const result = runHook(bashPayload('cat .claude/hooks/covenant-pretooluse.mjs'));

    expect(result.status).toBe(0);
    // Both meta-covenants upheld. The call world the shell call carries is judged by every
    // command-reading declaration too, and each of those upholds — the assertion stays on
    // the two labels this case is about, so a new entry in the live config cannot break it.
    const { records } = readRecords(telemetryPath);
    const metaEvents = records
      .filter((r) => r.label === 'self-mod' || r.label === 'shell-mod')
      .map((r) => r.event);
    expect(metaEvents.sort()).toEqual(['passed', 'passed']);
    expect(records.some((r) => r.event === 'blocked' || r.event === 'advised')).toBe(false);
  });

  it('a fresh human-typed witness token witnesses the blocked edit open (exit 0), would-block only', () => {
    // The valve sits behind the verdict: a transcript carrying the config token as a fresh
    // human utterance (first line, alone) lets a judgment that actually BLOCKED through as
    // `witnessed`, while the sibling registration that upheld records its true `passed`.
    // This is the only hook-level test of the transcript_path → dispatcher → witness
    // wiring; the predicate itself is pinned in the covenant package and the provider in
    // transcript-witness.e2e.
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

function writePayload(filePath: string, content: string) {
  return {
    hook_event_name: 'PreToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content },
  };
}

// These assertions read the live root config, so a disposition here follows that file: an
// entry with no `enforce` lands `advised` (exit 0), one carrying an explicit block rung
// stops the call. Meta-covenants (self-mod, shell-mod, transcript-mod) carry no entry rung
// and keep exit 2 in the suites above and below.
describe('dogfooding assembly E2E — wired disciplines', () => {
  it('a gate-disarming command mentioning no protected path is judged by hooks-stay-armed', () => {
    // A command mentioning no protected path still reaches a registration: the content
    // predicate, not path mention, is what routes it. The entry carries an explicit block
    // rung in the live root config, so the break stops the call instead of advising.
    const result = runHook(bashPayload('LEFTHOOK=0 git push origin main'));

    expect(result.status).toBe(2);
    // Every command-reading declaration judges the same call world; this one is the only
    // break, and it is the only row that is not a pass.
    const { records } = readRecords(telemetryPath);
    expect(
      records
        .filter((r) => r.event !== 'passed' && r.event !== 'skipped')
        .map((r) => [r.label, r.event]),
    ).toEqual([['hooks-stay-armed', 'blocked']]);
  });

  it("the break message carries the entry's why to stderr", () => {
    // What only this surface exercises is the round trip: the assembly serializes the whole
    // entry into argv, the body re-parses it, and the reason is built on the far side. The
    // em dash of the separator crosses that encoding here, and the sentence asserted comes
    // from the live root config rather than a fixture.
    const result = runHook(bashPayload('LEFTHOOK=0 git push origin main'));

    expect(result.status).toBe(2);
    // The whole stream, not fragments of it. Substring checks plus a "no newline" check are
    // jointly satisfied by any single line containing both pieces, so a body appending the
    // separator twice — or padding the message — passes all three. Asserting the full line
    // is what makes this test discriminate at all.
    expect(result.stderr).toBe(
      `discipline 'hooks-stay-armed' broken on -: ` +
        `command line disarms a commit gate: LEFTHOOK=0 git push origin main` +
        ` — why: ${configuredWhy('hooks-stay-armed')}\n`,
    );
  });

  it('a plain push command passes (exit 0) — the command discipline does not overblock', () => {
    const result = runHook(bashPayload('git push origin main'));

    expect(result.status).toBe(0);
    // The state comparison's own rows are on a different axis from the judgment (they
    // block nothing), so the verdict lane is what is read. Every command-reading
    // declaration judges this call world; the entry under test upholds, and nothing breaks.
    const records = readRecords(telemetryPath).records.filter(
      (record) => record.event !== 'unattributed',
    );
    expect(records.filter((r) => r.label === 'hooks-stay-armed').map((r) => r.event)).toEqual([
      'passed',
    ]);
    expect(records.some((r) => r.event === 'blocked' || r.event === 'advised')).toBe(false);
  });

  it('a Write adding banned vocabulary to an in-scope source path is judged by covenant-vocabulary (advised)', () => {
    // Absolute in-scope path that does not exist on disk: pre=null, so the Write's whole
    // content is the added direction. The protected surface is gate files only, so no
    // meta-covenant routes here — this is the discipline judging alone, which is what a
    // user's own repository looks like.
    const result = runHook(
      writePayload(
        join(repoRoot, 'packages/core/src/e2e-probe.ts'),
        'export const note = 1; // the guard word\n',
      ),
    );

    expect(result.status).toBe(0);
    const { records } = readRecords(telemetryPath);
    const byLabel = (label: string) => records.filter((r) => r.label === label);
    expect(byLabel('covenant-vocabulary').map((r) => r.event)).toEqual(['advised']);
    // No meta-covenant row: a package source is not a gate file, so nothing but the
    // discipline had anything to say about this call.
    expect(byLabel('self-mod')).toEqual([]);
  });

  it('the same banned-vocabulary Write outside the discipline scope passes (exit 0)', () => {
    // A `.txt` probe: a `.md` write is in the bilingual-pair declaration's scope and lands
    // its `skipped` row on this surface, which would stand in for the adapter's own row.
    const result = runHook(
      writePayload(join(repoRoot, 'docs/e2e-probe.txt'), 'prose mentioning the guard word\n'),
    );

    expect(result.status).toBe(0);
    // The state comparison's own rows are on a different axis from the judgment (they
    // block nothing), and so is the `skipped` lane, so the judged-row count is taken over
    // the verdict lane: nothing judged this write. The adapter's own `passed` row stands
    // only for a call no registration observed, and the unscoped history declaration
    // observes every file-changing call — it skips here (no session), so that row is
    // the call's record.
    const { records } = readRecords(telemetryPath);
    expect(
      records.filter((record) => record.event !== 'unattributed' && record.event !== 'skipped'),
    ).toEqual([]);
    expect(records.filter((r) => r.event === 'skipped').map((r) => r.label)).toEqual([
      'tests-before-implementation',
    ]);
  });
});

describe('assembly E2E — config discovery is fail-closed and self-protecting', () => {
  it('an Edit targeting polydeukes.config.yaml itself is blocked (exit 2, config self-protection)', () => {
    // The discovered config file is auto-attached to the protection surface by the loader,
    // so editing it must block. A loader that fails to self-attach configPath would leave
    // the config file — and so every protection it declares — editable.
    const result = runHook(editPayload('polydeukes.config.yaml'));

    expect(result.status).toBe(2);
    const { records } = readRecords(telemetryPath);
    // The config file lives on the self-mod (tool-axis) protection surface.
    const byLabel = (label: string) => records.filter((r) => r.label === label);
    expect(byLabel('self-mod').map((r) => r.event)).toEqual(['blocked']);
  });

  it('the hook fails closed (exit 2) when spawned against a rootDir that has no config file', () => {
    // Silent defaults are forbidden: a repoRoot with no polydeukes.config.{yaml,yml,json}
    // must block EVERY call — a loader returning an empty config on absence would make the
    // whole covenant surface silently vanish.
    //
    // The real hook resolves repoRoot purely from its own file location
    // (`.claude/hooks/../..`) with no env override, so exercising a configless rootDir
    // means copying the hook into a temp tree that has no config file. The delegator
    // resolves the judge by package NAME, so what makes that copy runnable is the
    // `node_modules` link below; the `packages` one is there because loadConfig and the
    // discipline globs still anchor on this tree.
    const configlessRoot = mkdtempSync(join(tmpdir(), 'pdks-configless-'));
    try {
      mkdirSync(join(configlessRoot, '.claude', 'hooks'), { recursive: true });
      cpSync(hookPath, join(configlessRoot, '.claude', 'hooks', 'covenant-pretooluse.mjs'));
      symlinkSync(join(repoRoot, 'packages'), join(configlessRoot, 'packages'), 'dir');
      // The delegator hook resolves its packages through BARE specifiers
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
      // The exit code alone cannot say WHY. Since the delegator resolves the judge by
      // package name, a fixture tree that cannot reach the install graph dies
      // ERR_MODULE_NOT_FOUND at the same exit 2 this case asserts — green for the wrong
      // reason, pinning module resolution instead of the loader's refusal to default a
      // missing config. The fail-closed row is what separates them: it exists only when
      // the assembly loaded and then refused.
      expect(
        readRecords(telemetryPath).records.map((record) => [record.event, record.label]),
      ).toEqual([['blocked', 'hook']]);
    } finally {
      rmSync(configlessRoot, { recursive: true, force: true });
    }
  });
});

// Path NOTATION at the assembly boundary. Every spawn above names its target literally,
// which is how measured bypass forms stayed green underneath a passing suite: the mention
// never formed, so no judgment step ever ran on them. One spawn per notation family, each
// pinning WHICH judge answered — a fail-closed collapse is also exit 2, but it records
// against the adapter, so only the label separates a verdict from a crash.

// The transcript fixture the transcript-protection block below spawns against. The
// definite tail is what a path-notation form is matched on, which is why the fixture can
// live under the temp root and still be the comparison the real session makes.
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

describe('dogfooding assembly E2E — path notation variants', () => {
  // The transcript the assembly attaches from the payload is the surface `~` and `$HOME`
  // are written against. The home value is injected as plain data into the transcript-mod
  // predicate alone (its block sits below this one); the path-mention judges exercised
  // here expand nothing, so a notation form is matched on the definite tail only.
  const rowsFor = (label: string) =>
    readRecords(telemetryPath).records.filter((r) => r.label === label);

  it('a redirect written through an interior "." is blocked on the Bash axis (exit 2)', () => {
    // Interior-dot bypass family. Spawned rather than unit-tested because the failure mode
    // is a fix that lands in the predicate but never reaches the assembled hook.
    const result = runHook(bashPayload('echo x >> packages/core/./dist/index.js'));

    expect(result.status).toBe(2);
    expect(rowsFor('shell-mod').map((r) => r.event)).toEqual(['blocked']);
  });

  it('a sed -i whose target cancels through ".." is blocked on the Bash axis (exit 2)', () => {
    // Same family, different write-detection rule: the target here is extracted by the
    // sed-in-place rule rather than read off a redirect. Normalization added at one
    // extraction site instead of in the shared primitive leaves the other rules judging
    // raw strings.
    const result = runHook(bashPayload('sed -i s/a/b/ packages/core/src/../dist/index.js'));

    expect(result.status).toBe(2);
    expect(rowsFor('shell-mod').map((r) => r.event)).toEqual(['blocked']);
  });

  it('a cancelling prefix that descends again is blocked on the Bash axis (exit 2)', () => {
    // Cancellation in the MIDDLE of a path rather than at its end. `tmp/../.claude` is the
    // same directory as `.claude`, and a resolution pass that only handles a trailing `..`
    // loses the match.
    const result = runHook(bashPayload('rm -rf tmp/../.claude/hooks'));

    expect(result.status).toBe(2);
    expect(rowsFor('shell-mod').map((r) => r.event)).toEqual(['blocked']);
    expect(rowsFor('shell-mod').map((r) => r.subject)).toEqual(['.claude/hooks']);
  });

  it('a glob spelling of the same target is recorded skipped — the silence removed', () => {
    // Expanding a glob needs the filesystem, so no judge guesses a target and the call
    // passes — but a mutation-capable command whose target cannot be judged must leave one
    // common skipped row rather than nothing.
    const result = runHook(bashPayload('rm packages/*/dist/index.js'));

    expect(result.status).toBe(0);
    // A `supply-pass` skip belongs to the call world every shell call carries, not to the
    // shell axis this case measures, so the lane is narrowed to the write-target reason.
    const skipped = readRecords(telemetryPath).records.filter(
      (r) => r.event === 'skipped' && r.reason !== 'supply-pass',
    );
    expect(skipped.map((r) => r.label)).toEqual(['shell-unjudgeable']);
  });

  it('a tool call whose absolute file_path carries an interior "." is blocked by self-mod (exit 2)', () => {
    // One primitive, three consumers: the tool axis reads the same predicate through a
    // different judge, so a fix verified only on Bash payloads leaves the primary axis
    // open. Write rather than Edit: Edit's virtual apply depends on what the built dist
    // happens to contain, and a failed apply falls back to the mention branch, so the test
    // would keep passing while no longer pinning the proven-target branch.
    const result = runHook(writePayload(`${repoRoot}/packages/core/./dist/index.js`, 'x'));

    expect(result.status).toBe(2);
    expect(rowsFor('self-mod').map((r) => r.event)).toEqual(['blocked']);
  });
});

// The transcript is protected by its own equality predicate rather than by protectedPaths,
// so protecting it does not make the home directory a protected ancestor.

describe('dogfooding assembly E2E — transcript protection without a home ancestor', () => {
  // Every spawn hands the hook a real HOME (raw env, injected into the transcript-mod
  // predicate as data) and attaches a real session under that home, so the home-relative
  // spellings below name the same file the payload declares.
  const rowsFor = (label: string) =>
    readRecords(telemetryPath).records.filter((r) => r.label === label);

  it('a "~" append to the transcript is blocked by transcript-mod, not shell-mod (exit 2)', () => {
    // Asserting WHO answered: the subject must be the ABSOLUTE transcript path (the
    // canonical spelling, not the typed one — telemetry rows must name the real file), and
    // shell-mod must stay silent — the transcript is not in its protectedPaths, so a
    // shell-mod row here means the home-ancestor root is back.
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

  it('cd into the literal absolute home passes with no judge row (exit 0)', () => {
    // Putting the transcript in protectedPaths would make home a protected ANCESTOR, so
    // `cd` into the literal absolute home would block — a fix that closes the `~` spellings
    // while keeping the transcript in protectedPaths leaves this case blocked.
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
    // The predicate protects the transcript FILE only, never an ancestor directory — that
    // surface is out of observation scope and belongs to the agent's own deny policy. The
    // disciplines layer may leave a shell-unjudgeable skipped row for the rm, so the
    // assertion covers only the transcript predicate's silence and the exit code.
    const transcriptPath = sessionTranscript();

    const result = runHook(bashPayload('rm -rf ~/.claude/projects'), {
      transcriptPath,
      env: { HOME: tmpRoot },
    });

    expect(result.status).toBe(0);
    expect(rowsFor('transcript-mod')).toEqual([]);
  });

  it('an edit whose CONTENT carries a bare "~" and the transcript spelling passes (exit 0)', () => {
    // Content is mention, not target: the Edit's own fileChange proves the unrelated file,
    // so the tool axis never reads args. An args scan on the evidence branch would break
    // on the transcript spelling that sits inside new_string.
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

// The shell axis must not pass mutations silently: content a Write delivers blocked can
// also arrive by heredoc or redirect. The axis derives evidence where the command text
// makes it computable, records an entry-scoped or common `skipped` where it does not, and
// keeps signal-free calls silent. NotebookEdit is the same gap's tool-axis form.

describe('dogfooding assembly E2E — shell-delivered mutations and NotebookEdit', () => {
  // A probe path inside covenant-vocabulary's scope that never exists on disk, so the
  // judgment-time pre read answers ENOENT and the whole delivered text is the added
  // direction.
  const SCOPED_SOURCE = 'packages/core/src/e2e-probe.ts';
  const BANNED_LINE = 'export const note = 1; // the guard word';

  const rowsFor = (label: string) =>
    readRecords(telemetryPath).records.filter((r) => r.label === label);
  const skippedRows = () => readRecords(telemetryPath).records.filter((r) => r.event === 'skipped');
  /**
   * The shell-axis half of that lane. A `supply-pass` skip is a declaration disposing of an
   * absent source on the CALL WORLD every shell call carries — a different lane from a write
   * this layer could not compute, so a cardinality claim about the shell axis excludes it.
   */
  const shellSkippedRows = () => skippedRows().filter((r) => r.reason !== 'supply-pass');

  it('a heredoc delivering a banned word into a discipline-scoped file is judged (exit 0, advised)', () => {
    // A quoted delimiter makes the heredoc body literal, so the delivered text is computable.
    const result = runHook(
      bashPayload([`cat > ${SCOPED_SOURCE} <<'EOF'`, BANNED_LINE, 'EOF'].join('\n')),
    );

    expect(result.status).toBe(0);
    expect(rowsFor('covenant-vocabulary').map((r) => r.event)).toEqual(['advised']);
  });

  it('an append redirect delivering a banned word into the same scope is judged (exit 0, advised)', () => {
    // Append composes pre at judgment time (absence = create), so the echoed line IS the added text.
    const result = runHook(bashPayload(`echo '${BANNED_LINE}' >> ${SCOPED_SOURCE}`));

    expect(result.status).toBe(0);
    expect(rowsFor('covenant-vocabulary').map((r) => r.event)).toEqual(['advised']);
  });

  it('a sed -i over a scoped file is recorded skipped under EACH discipline scoping it (exit 0)', () => {
    // Content incomputable, target known: one row per entry whose scope covers this path,
    // attributed to the entry id and never the common label. Every row here carries the
    // same subject and the same reason, so what this enumerates is the ATTRIBUTION — the
    // list grows with every entry whose scope covers this path. A command-scoped entry is
    // NOT on it: it owns no path, and the shell call it judges is the call world its body
    // already saw — a skip arm there would mint a second row under its label.
    const result = runHook(
      bashPayload("sed -i 's/alpha/beta/' packages/adapter-git/src/collect.ts"),
    );

    expect(result.status).toBe(0);
    const target = 'packages/adapter-git/src/collect.ts';
    expect(shellSkippedRows().map((r) => r.label)).toEqual([
      'covenant-vocabulary',
      'english-only-sources',
      'comments-state-facts',
      'adapter-needs-knowledge-read',
      'tests-before-implementation',
    ]);
    expect(shellSkippedRows().every((r) => r.subject === target)).toBe(true);
    // The call world the same shell call carries is a separate lane: the unscoped history
    // declaration disposes of the absent session there under its own `supply: pass`.
    expect(
      skippedRows()
        .filter((r) => r.reason === 'supply-pass')
        .map((r) => [r.label, r.subject]),
    ).toEqual([['tests-before-implementation', '-']]);
  });

  it('a redirect to an opaque target leaves one common skipped row, never one per entry (exit 0)', () => {
    // No target path means no entry attribution — fan-out would multiply noise by the entry count.
    const result = runHook(bashPayload('echo x > $F'));

    expect(result.status).toBe(0);
    expect(shellSkippedRows().map((r) => r.label)).toEqual(['shell-unjudgeable']);
  });

  it('a nested shell invocation leaves one common skipped row (exit 0)', () => {
    // A nested shell is indeterminate, and that answer is recorded rather than dropped.
    const result = runHook(bashPayload('bash x.sh'));

    expect(result.status).toBe(0);
    expect(shellSkippedRows().map((r) => r.label)).toEqual(['shell-unjudgeable']);
  });

  it('a signal-free command stays silent — the volume defence (exit 0, adapter row only)', () => {
    // No detected mutation, no write redirect, no opaque token: a recovery build must never cost a row.
    const result = runHook(bashPayload('pnpm build'));

    expect(result.status).toBe(0);
    // The state comparison's own rows are on a different axis from the judgment (they
    // block nothing), so the verdict lane is what is read. Every command-reading
    // declaration judges the call world this shell call carries, so silence here means no
    // break and no shell-axis skip — not an empty log.
    const records = readRecords(telemetryPath).records.filter(
      (record) => record.event !== 'unattributed',
    );
    expect(records.some((r) => r.event === 'blocked' || r.event === 'advised')).toBe(false);
    expect(records.filter((r) => r.event === 'skipped' && r.reason !== 'supply-pass')).toEqual([]);
  });

  it('a read-only command carrying a glob stays silent — an opaque token alone is no signal (exit 0)', () => {
    // `ls` sits on the read-only allowlist, so its glob cannot mean a write the derivation missed.
    const result = runHook(bashPayload('ls *.md'));

    expect(result.status).toBe(0);
    // The state comparison's own rows are on a different axis from the judgment (they
    // block nothing), so the verdict lane is what is read. Every command-reading
    // declaration judges the call world this shell call carries, so silence here means no
    // break and no shell-axis skip — not an empty log.
    const records = readRecords(telemetryPath).records.filter(
      (record) => record.event !== 'unattributed',
    );
    expect(records.some((r) => r.event === 'blocked' || r.event === 'advised')).toBe(false);
    expect(records.filter((r) => r.event === 'skipped' && r.reason !== 'supply-pass')).toEqual([]);
  });

  it('a NotebookEdit delivering a banned word into a scoped cell is judged (exit 0, advised)', () => {
    // The notebook must exist on disk: cell evidence reads the target cell's pre from it.
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

      expect(result.status).toBe(0);
      expect(rowsFor('covenant-vocabulary').map((r) => r.event)).toEqual(['advised']);
    } finally {
      rmSync(notebookPath, { force: true });
    }
  });
});

// The block above pins each disposition once; these pin the set ends it does not reach: a
// protected-path notebook surviving the evidence takeover, both attribution boundaries of
// the computable axis (out of every scope / clean in scope), a real on-disk pre for append
// composition, and a violation arriving second in a chain.

describe('dogfooding assembly E2E — evidence set gaps', () => {
  const SCOPED_SOURCE = 'packages/core/src/e2e-probe.ts';
  const BANNED_LINE = 'export const note = 1; // the guard word';

  const rowsFor = (label: string) =>
    readRecords(telemetryPath).records.filter((r) => r.label === label);
  const skippedRows = () => readRecords(telemetryPath).records.filter((r) => r.event === 'skipped');

  it('a NotebookEdit on a protected-path notebook stays blocked by self-mod (exit 2)', () => {
    // Evidence must not narrow existing blocking: when NotebookEdit carries cell evidence
    // the proven-target branch answers instead of the mention fallback, and an evidence
    // path that passes validity while dodging protected matching would fail open. The
    // notebook is real and parseable on purpose so evidence actually lands.
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
    // Computable-but-unmatched is a pass, not an unjudgeable: a target no entry scopes must
    // produce zero discipline rows AND zero common-skip rows.
    const result = runHook(bashPayload('echo x > /tmp/y.ts'));

    expect(result.status).toBe(0);
    // The state comparison's own rows are on a different axis from the judgment (they
    // block nothing), so the verdict lane is what is read. Every command-reading
    // declaration judges the call world this shell call carries, so silence here means no
    // break and no shell-axis skip — not an empty log.
    const records = readRecords(telemetryPath).records.filter(
      (record) => record.event !== 'unattributed',
    );
    expect(records.some((r) => r.event === 'blocked' || r.event === 'advised')).toBe(false);
    expect(records.filter((r) => r.event === 'skipped' && r.reason !== 'supply-pass')).toEqual([]);
  });

  it('a clean computable write into scope is passed and never also skipped (exit 0)', () => {
    // One derivation, one answer: a judged write that ALSO drops a skipped row would
    // double-record every computable call and drown the skip lane it feeds.
    const result = runHook(bashPayload(`echo 'const ok = 1;' >> ${SCOPED_SOURCE}`));

    expect(result.status).toBe(0);
    expect(rowsFor('covenant-vocabulary').map((r) => r.event)).toEqual(['passed']);
    // Every entry that JUDGED this write is absent from the skip lane, and a computable
    // derivation forbids the common shell-unjudgeable row. The one row left belongs to a
    // context-family entry, which judged nothing: this run injects no transcript, so its
    // question was unaskable rather than answered a second time.
    expect(skippedRows().map((r) => r.label)).toEqual([
      'core-needs-knowledge-read',
      'tests-before-implementation',
    ]);
  });

  it('an append composing a real on-disk pre still judges the banned addition (exit 0, advised)', () => {
    // Every sibling's pre is ENOENT (= create); a real pre exercises the judgment-time disk
    // read and pre/post composition. The relative target sits where only a repo-root
    // resolution finds it — the hook process cwd holds no such file.
    const realTarget = 'packages/core/src/e2e-probe-real.ts';
    const realTargetAbs = join(repoRoot, realTarget);
    writeFileSync(realTargetAbs, 'export const cleanBase = 1;\n');
    try {
      const result = runHook(bashPayload(`echo '${BANNED_LINE}' >> ${realTarget}`));

      expect(result.status).toBe(0);
      expect(rowsFor('covenant-vocabulary').map((r) => r.event)).toEqual(['advised']);
    } finally {
      rmSync(realTargetAbs, { force: true });
    }
  });

  it('a violation delivered by the second command of a chain is still judged (exit 0, advised)', () => {
    // Two writes, two targets, the banned one second: an implementation keeping a single
    // evidence per call would let chain position launder the violation.
    const chained = `echo probe > /tmp/pdks-chain.ts && echo '${BANNED_LINE}' > ${SCOPED_SOURCE}`;
    const result = runHook(bashPayload(chained));

    expect(result.status).toBe(0);
    expect(rowsFor('covenant-vocabulary').map((r) => r.event)).toEqual(['advised']);
  });
});

// The session surface never reads the git namespace. The commit-only additive list
// (adapters.git.protectedPaths) exists so judgment-chain sources can block at promotion
// time while staying free during work, and that split only holds if the hook's observation
// scope stays the COMMON list. These spawn against a fixture tree carrying a config the
// test authors, because the entries pinned here cannot live in the real repo config.

describe('dogfooding assembly E2E — session surface ignores the git-additive list', () => {
  // The additive entry names the exact target the session payload edits, so any reading of
  // the git namespace shows up; the common list carries an untracked directory.
  const GIT_ADDITIVE_ENTRY = 'packages/core/src';
  const COMMON_UNTRACKED_ENTRY = '.git/hooks';

  const rowsFor = (label: string) =>
    readRecords(telemetryPath).records.filter((r) => r.label === label);

  /** Copy the real hook into a fixture tree carrying a test-authored config. */
  function runHookWithFixtureConfig(payload: unknown) {
    const fixtureRoot = join(tmpRoot, 'fixture-tree');
    mkdirSync(join(fixtureRoot, '.claude', 'hooks'), { recursive: true });
    cpSync(hookPath, join(fixtureRoot, '.claude', 'hooks', 'covenant-pretooluse.mjs'));
    symlinkSync(join(repoRoot, 'packages'), join(fixtureRoot, 'packages'), 'dir');
    // The delegator hook resolves its packages through BARE specifiers, so the fixture
    // tree must also reach the real installation graph — without this link the spawn dies
    // ERR_MODULE_NOT_FOUND before any judgment.
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
    // "The hook does not read the git namespace" is a promise, not an omission: source
    // stays free during work and gates only at promotion. A hook assembly that unioned
    // adapters.git.protectedPaths would block here on self-mod.
    const result = runHookWithFixtureConfig(editPayload(`${GIT_ADDITIVE_ENTRY}/index.ts`));

    expect(result.status).toBe(0);
    // The state comparison's own rows are on a different axis from the judgment (they
    // block nothing), so the judged-row count is taken over the verdict lane.
    const records = readRecords(telemetryPath).records.filter(
      (record) => record.event !== 'unattributed',
    );
    expect(records.length).toBe(1);
    expect(records[0].event).toBe('passed');
    expect(records[0].label).toBe('adapter-claude-code');
  });

  it('a Write into .git/hooks is blocked by self-mod on the session surface (exit 2)', () => {
    // .git/hooks is git-untracked, so the commit surface can never observe it — the common
    // list is the one layer that can watch the generated hook, and the session must own
    // that block. The self-mod label is asserted because a fail-closed collapse carries the
    // same exit code and only the label separates the two.
    const result = runHookWithFixtureConfig(
      writePayload(`${COMMON_UNTRACKED_ENTRY}/pre-commit`, '#!/bin/sh\nexit 0\n'),
    );

    expect(result.status).toBe(2);
    expect(rowsFor('self-mod').map((r) => [r.event, r.subject])).toEqual([
      ['blocked', '.git/hooks'],
    ]);
  });
});
