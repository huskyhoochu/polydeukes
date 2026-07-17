import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CovenantInput } from '@polydeukes/core';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants } from '../src/dispatch.ts';
import {
  DEFAULT_READ_ONLY_COMMANDS,
  judgeShellModification,
  type ShellModificationSpec,
} from '../src/shell-mod.ts';

// ---------------------------------------------------------------------------
// PRD §5.1/§5.2 — pure judge. The shell-tool name, command-arg name, and
// protected-path strings below are injected fixture values, never source
// literals (PRD §4.1/§4.2/§7 — a source literal reproduces the §9-난관1 leak).
// ---------------------------------------------------------------------------

const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const PROTECTED = 'sub/protected/file.txt';
const UNPROTECTED = 'sub/other/plain.txt';

/** Build a minimal CovenantInput with a single toolCalls[0]. */
function inputWithToolCall(name: string, args: Record<string, unknown>): CovenantInput {
  return {
    toolCalls: [{ name, args }],
    subagentSpawns: [],
    userMessages: [],
  };
}

/** A shell-tool call carrying `line` under the injected command-arg key. */
function shellCall(line: string): CovenantInput {
  return inputWithToolCall(SHELL_TOOL, { [COMMAND_ARG]: line });
}

/** The default spec, allowlist inherited from the source constant. */
function baseSpec(overrides: Partial<ShellModificationSpec> = {}): ShellModificationSpec {
  return {
    protectedPaths: [PROTECTED],
    shellToolNames: [SHELL_TOOL],
    commandArgNames: [COMMAND_ARG],
    readOnlyCommands: DEFAULT_READ_ONLY_COMMANDS,
    ...overrides,
  };
}

describe('judgeShellModification — break direction (PRD §5.1)', () => {
  it('sed -i on the protected path breaks, with reason carrying the rule name and path', () => {
    // Mutation caught: the sedInPlaceRule dropped from the fixed rule set (§4.2), or the
    // rule-detected target not matched against protectedPaths — the original assessment
    // vector (`sed -i 's/exit 2/exit 0/' <meta-covenant>`) would silently pass.
    const verdict = judgeShellModification(
      shellCall(`sed -i 's/exit 2/exit 0/' ${PROTECTED}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain('sed-in-place');
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('a heredoc redirect writing the protected path breaks (redirect-write on the heredoc vector)', () => {
    // Mutation caught: the redirect target of a `>`-with-heredoc command not analyzed, so
    // `cat > <protected> <<EOF` writes the file while the heredoc body distracts the scan.
    const verdict = judgeShellModification(
      shellCall(`cat > ${PROTECTED} <<EOF\nhello\nEOF`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain('redirect-write');
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('tee on the protected path breaks (tee rule)', () => {
    // Mutation caught: the teeRule dropped from the fixed set — `tee <protected>` writes
    // without any redirect operator, so only the rule catches it.
    const verdict = judgeShellModification(shellCall(`tee ${PROTECTED}`), baseSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain('tee');
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  // AUDIT: the printf-redirect break case was pruned as a duplicate happy-path — rule
  // detection for `printf 'x' > f` is pinned by mutation-rules.test.ts and the
  // redirect-write → break wiring by the heredoc case above (same rule, same judge path).

  it('a compound line breaks on the write half even when the leading command is harmless', () => {
    // Mutation caught: whole-line judgement instead of per-simple-command (§4.1/§7) — the
    // harmless `echo ok` would absolve the trailing `sed -i` if the line were judged as one.
    const verdict = judgeShellModification(
      shellCall(`echo ok && sed -i s/a/b/ ${PROTECTED}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('a protected-path mention inside a command substitution breaks (§4.1(c) opaque mention)', () => {
    // Mutation caught: mention inside an opaque token (`echo $(cat <protected>)`) treated as
    // a transparent read and upheld, defeating the "protected path inside command
    // substitution is undecidable → block" policy clause.
    const verdict = judgeShellModification(shellCall(`echo $(cat ${PROTECTED})`), baseSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('an allowlisted reader with an opaque write target breaks (§4.1(d) opaque redirect target)', () => {
    // Mutation caught: allowlist (e) evaluated before the opaque-write check (d), so
    // `cat <protected> > $(x)` is absolved by `cat` even though the write target could
    // resolve to the protected path. The order invariant (§7) is the fail point.
    const verdict = judgeShellModification(shellCall(`cat ${PROTECTED} > $(x)`), baseSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('a plain mention by a non-allowlisted command breaks (§4.1(f) backstop)', () => {
    // Mutation caught: the backstop removed — `node x.js <protected>` mentions the path,
    // is not allowlisted, has no write/opaque structure, and must still block. Reason
    // carries the first word so the backstop is diagnosable.
    const verdict = judgeShellModification(shellCall(`node x.js ${PROTECTED}`), baseSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain('node');
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('an eval wrapping a sed -i on the protected path breaks (backstop covers nested shells)', () => {
    // Mutation caught: eval is a nested-shell reinterpretation boundary — 04a reports it
    // indeterminate rather than parsing inside, so the inner `sed -i` is invisible to the
    // rules. The backstop (f) is what blocks: eval is non-allowlisted and mentions the
    // path, so the mention alone must block. Removing the backstop leaks nested shells.
    const verdict = judgeShellModification(
      shellCall(`eval 'sed -i s/a/b/ ${PROTECTED}'`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('a tokenize failure whose raw line mentions the protected path breaks (§4.1 step 2)', () => {
    // Mutation caught: a tokenize failure defaulting to uphold regardless of content —
    // an unclosed quote must fail closed *when the raw line names the protected path*,
    // or an unparseable command becomes a bypass vector.
    const verdict = judgeShellModification(shellCall(`cat ${PROTECTED} "unclosed`), baseSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('a shell-tool call with no string value under any command-arg key breaks (§4.1 step 1 misassembly)', () => {
    // Mutation caught: a shell-tool call whose command cannot be read (arg-name typo, or a
    // non-string value) silently upheld instead of failing closed — the judge-level twin of
    // the config fail-closed gate, stopping a misassembled meta-covenant from waving
    // everything through.
    const input = inputWithToolCall(SHELL_TOOL, { notTheCommandKey: 123, another: false });

    const verdict = judgeShellModification(input, baseSpec());

    expect(verdict.upheld).toBe(false);
  });

  // --- Review-found fail-open fixes (PR #12) ------------------------------------------

  it('an allowlisted reader fronting a process substitution that writes the protected path breaks', () => {
    // Fail-open caught (review): `cat <(sed -i … <protected>)` — bash executes the inner
    // sed, writing the protected file. The tokenizer must consume `<(…)` as one opaque word
    // so the path lands inside an opaque token and step (c) breaks; otherwise the inner
    // args leak as plain words and the leading `cat` is absolved by the allowlist.
    const verdict = judgeShellModification(
      shellCall(`cat <(sed -i s/a/b/ ${PROTECTED})`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('git diff --output writing the protected path breaks (write-capable allowlist entry removed)', () => {
    // Fail-open caught (review): `git diff --output=<file>` writes <file> with no redirect,
    // so no rule fires; the fix removes `git diff`/`git log`/`git show` from the default
    // allowlist (they are write-capable via --output), so the mention hits the backstop.
    const verdict = judgeShellModification(
      shellCall(`git diff --output=${PROTECTED} HEAD`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('a nested-shell command is never absolved even when injected into the allowlist', () => {
    // Defense-in-depth (review): the default allowlist excludes nested shells, but a
    // misassembled `--allow-read sh` must not absolve `sh -c '…write…'` — a nested shell
    // re-parses its string argument, so it can never be proven read-only.
    const verdict = judgeShellModification(shellCall(`sh -c 'sed -i s/a/b/ ${PROTECTED}'`), {
      ...baseSpec(),
      readOnlyCommands: ['sh'],
    });

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('a whitespace-only allowlist entry does not vacuously absolve every command', () => {
    // Fail-open caught (review): `matchesReadOnlyEntry(command, [])` returns true vacuously.
    // A whitespace-only entry must reject, not match every command — otherwise one blank
    // allowlist entry turns every protected-path mention into a proven read.
    const verdict = judgeShellModification(shellCall(`node x.js ${PROTECTED}`), {
      ...baseSpec(),
      readOnlyCommands: ['   '],
    });

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });
});

describe('judgeShellModification — uphold direction (PRD §5.2)', () => {
  it('sed -i, tee, and printf redirect on an UNPROTECTED path all uphold (roadmap AC "non-protected same command")', () => {
    // Mutation caught: the rule-detected target matched against something other than the
    // protected-path list (e.g. matching on "is a write" alone), which would over-block
    // every write regardless of destination.
    expect(judgeShellModification(shellCall(`sed -i s/a/b/ ${UNPROTECTED}`), baseSpec())).toEqual({
      upheld: true,
    });
    expect(judgeShellModification(shellCall(`tee ${UNPROTECTED}`), baseSpec())).toEqual({
      upheld: true,
    });
    expect(judgeShellModification(shellCall(`printf 'x' > ${UNPROTECTED}`), baseSpec())).toEqual({
      upheld: true,
    });
  });

  it('cat, grep, and git status on the protected path uphold via the allowlist (incl. the two-word entry)', () => {
    // Mutation caught: the allowlist (e) not consulted, so every protected-path mention
    // backstops to break — legitimate reads become friction. The `git status` case also
    // proves the multi-word sequence match (`git` alone is not enough; `status` must
    // follow). `git status` (unlike `git diff`) has no --output write flag, so it stays a
    // proven read-only allowlist entry.
    expect(judgeShellModification(shellCall(`cat ${PROTECTED}`), baseSpec())).toEqual({
      upheld: true,
    });
    expect(judgeShellModification(shellCall(`grep x ${PROTECTED}`), baseSpec())).toEqual({
      upheld: true,
    });
    expect(judgeShellModification(shellCall(`git status ${PROTECTED}`), baseSpec())).toEqual({
      upheld: true,
    });
  });

  it('a protected read plus a transparent unprotected write upholds ((a) passes the write, (e) absolves the mention)', () => {
    // Mutation caught: an unprotected write target treated as a reason to block regardless
    // of destination, or the allowlist not clearing the protected-path mention — either
    // over-blocks `grep x <protected> > /tmp/out`, a legitimate "read protected, write
    // elsewhere" command.
    expect(judgeShellModification(shellCall(`grep x ${PROTECTED} > /tmp/out`), baseSpec())).toEqual(
      { upheld: true },
    );
  });

  it('a protected path appearing only in a heredoc BODY upholds (body is data — 04c boundary)', () => {
    // Mutation caught: heredoc body lines scanned as command words/mentions, so a protected
    // path quoted inside a document written elsewhere would falsely block. The body must be
    // excluded from mention analysis.
    expect(
      judgeShellModification(shellCall(`cat > /tmp/x <<EOF\n${PROTECTED}\nEOF`), baseSpec()),
    ).toEqual({ upheld: true });
  });

  it('a non-shell (mutating-tool-shaped) call mentioning the protected path upholds (co-existence boundary)', () => {
    // P0 co-existence invariant (§7, mirror of self-mod): the tool axis belongs to
    // self-mod; a non-shell tool name is not in shellToolNames, so this judge must not
    // break on it. Mutation caught: judging by mention alone, ignoring the tool-name axis,
    // which would pre-empt self-mod and break run-all co-existence.
    const input = inputWithToolCall('Edit', { file_path: PROTECTED });

    expect(judgeShellModification(input, baseSpec())).toEqual({ upheld: true });
  });

  it('a tokenize failure without a raw mention upholds, and empty toolCalls upholds', () => {
    // Mutation caught: a tokenize failure defaulting to break regardless of content
    // (over-blocking every malformed line even when it never names a protected path);
    // and a fallback branch breaking on zero tool calls instead of vacuously upholding.
    expect(judgeShellModification(shellCall(`echo "unclosed`), baseSpec())).toEqual({
      upheld: true,
    });
    const empty: CovenantInput = { toolCalls: [], subagentSpawns: [], userMessages: [] };
    expect(judgeShellModification(empty, baseSpec())).toEqual({ upheld: true });
  });

  it('tool-name matching is exact (no substring) and empty-string entries in all four lists are ignored', () => {
    // Mutation caught: an `includes()` tool-name check (a call named "BashRunner" would
    // falsely match an injected "Bash"); and an unguarded '' entry vacuously matching
    // every path/tool/arg/command, collapsing the judge into a match-everything rule.
    const notShell = inputWithToolCall('BashRunner', {
      [COMMAND_ARG]: `sed -i s/a/b/ ${PROTECTED}`,
    });
    expect(judgeShellModification(notShell, baseSpec())).toEqual({ upheld: true });

    // Empty-string entries everywhere must not manufacture a universal match: this shell
    // call names an unprotected path only, so with all four lists degenerating to '' it
    // must still uphold.
    const emptyEntrySpec: ShellModificationSpec = {
      protectedPaths: ['', PROTECTED],
      shellToolNames: ['', SHELL_TOOL],
      commandArgNames: ['', COMMAND_ARG],
      readOnlyCommands: ['', ...DEFAULT_READ_ONLY_COMMANDS],
    };
    expect(judgeShellModification(shellCall(`cat ${UNPROTECTED}`), emptyEntrySpec)).toEqual({
      upheld: true,
    });
  });

  it('allowlist first word is basename-compared (/bin/cat upholds), an opaque first word is not allowlisted', () => {
    // Mutation caught: the allowlist first-word comparison done verbatim instead of by
    // basename, so `/bin/cat <protected>` would miss the `cat` entry and over-block; and
    // an opaque first word (`$X <protected>`) treated as allowlisted, which would let an
    // unknowable command absolve a protected-path mention (fail-open).
    expect(judgeShellModification(shellCall(`/bin/cat ${PROTECTED}`), baseSpec())).toEqual({
      upheld: true,
    });

    const opaque = judgeShellModification(shellCall(`$X ${PROTECTED}`), baseSpec());
    expect(opaque.upheld).toBe(false);
    if (!opaque.upheld) {
      expect(opaque.reason).toContain(PROTECTED);
    }
  });
});

// ---------------------------------------------------------------------------
// COVENANT-07 §5.1/§5.2/§5.3 — path-segment matching upgrade of the shared
// primitive, applied by the Bash-axis judge. Uses the real protected path
// `packages/core/src` so the parent-operation and quote-split vectors match
// exactly the audit-found bypasses.
// ---------------------------------------------------------------------------

const REAL_PROTECTED = 'packages/core/src';

/** A shell-mod spec keyed on the real protected path (audit vectors). */
function realSpec(overrides: Partial<ShellModificationSpec> = {}): ShellModificationSpec {
  return {
    protectedPaths: [REAL_PROTECTED],
    shellToolNames: [SHELL_TOOL],
    commandArgNames: [COMMAND_ARG],
    readOnlyCommands: DEFAULT_READ_ONLY_COMMANDS,
    ...overrides,
  };
}

describe('judgeShellModification — parent-of-protected operations (PRD §5.1)', () => {
  it('rm -rf on the protected parent directory breaks (ancestor match)', () => {
    // Mutation caught: reverting mentionsPath to substring semantics — `packages/core` does
    // NOT contain `packages/core/src` as a substring, so the substring primitive let
    // `rm -rf packages/core` (a parent-of-protected deletion) pass. Ancestor matching blocks.
    const verdict = judgeShellModification(shellCall('rm -rf packages/core'), realSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(REAL_PROTECTED);
    }
  });

  it('mv of the protected parent directory breaks (ancestor match)', () => {
    // Mutation caught: same substring bypass on the move vector — `mv packages/core /tmp/x`
    // relocates the parent of the protected dir. The ancestor relation must catch it.
    const verdict = judgeShellModification(shellCall('mv packages/core /tmp/x'), realSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(REAL_PROTECTED);
    }
  });
});

describe('judgeShellModification — quote/escape/line-continuation split path (PRD §5.2)', () => {
  it('a quote-split protected path in a redirect target breaks (tokenizer strips quotes)', () => {
    // Mutation caught: matching the raw string instead of the tokenized (quote-stripped)
    // word — the raw `packages/core/sr"c"/index.ts` has no contiguous `packages/core/src`,
    // so a raw-substring judge misses it while the shell writes the protected file.
    const verdict = judgeShellModification(
      shellCall('printf x > packages/core/sr"c"/index.ts'),
      realSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(REAL_PROTECTED);
    }
  });

  it('a backslash+newline line continuation inside a path is elided, so the path matches and breaks', () => {
    // Mutation caught: scanWord inserting a literal newline for `\`+newline instead of
    // eliding it as a shell line continuation. The byte sequence is backslash then an actual
    // newline char mid-path; after continuation removal the word is `packages/core/src/...`.
    const line = 'printf x > packages/core/sr\\\nc/index.ts';
    const verdict = judgeShellModification(shellCall(line), realSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(REAL_PROTECTED);
    }
  });
});

// ---------------------------------------------------------------------------
// PRD §5.3 (body CLI) + §5.4 (dispatcher E2E) — real compiled artifact.
// ---------------------------------------------------------------------------

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const bodyPath = fileURLToPath(new URL('../dist/shell-mod-body.js', import.meta.url));
const selfModBodyPath = fileURLToPath(new URL('../dist/self-mod-body.js', import.meta.url));

/** The CLI flag list corresponding to baseSpec()'s injected tool/arg/path values. */
const CONFIG_FLAGS = [
  '--protected-path',
  PROTECTED,
  '--shell-tool',
  SHELL_TOOL,
  '--command-arg',
  COMMAND_ARG,
];

beforeAll(() => {
  execFileSync('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@polydeukes/covenant'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
}, 120_000);

describe('shell-mod-body CLI (PRD §5.3)', () => {
  it('a break input yields exit 1 with the reason on stderr; an uphold input yields exit 0', () => {
    // Mutation caught: verdictToExitCode wired backwards (break -> 0), the break reason not
    // surfaced on stderr, or the uphold path also exiting non-zero.
    const breakResult = spawnSync(process.execPath, [bodyPath, ...CONFIG_FLAGS], {
      input: JSON.stringify(shellCall(`sed -i s/a/b/ ${PROTECTED}`)),
      encoding: 'utf-8',
    });
    expect(breakResult.status).toBe(1);
    expect(breakResult.stderr.length).toBeGreaterThan(0);
    expect(breakResult.stderr).toContain(PROTECTED);

    const upholdResult = spawnSync(process.execPath, [bodyPath, ...CONFIG_FLAGS], {
      input: JSON.stringify(shellCall(`cat ${PROTECTED}`)),
      encoding: 'utf-8',
    });
    expect(upholdResult.status).toBe(0);
  });

  it('invalid JSON stdin yields exit 2, and toolCalls:[null] yields exit 2 (judge-throw boundary)', () => {
    // Mutation caught: the CLI not routing core parseInput's fail-closed path (crashing with
    // an uncaught exception instead of exit 2); and a judge throw on `toolCalls:[null]`
    // leaking as Node's crash exit 1 (read as non-blocking) instead of the blocking 2.
    const badJson = spawnSync(process.execPath, [bodyPath, ...CONFIG_FLAGS], {
      input: 'not valid json {{{',
      encoding: 'utf-8',
    });
    expect(badJson.status).toBe(2);

    const nullElement = spawnSync(process.execPath, [bodyPath, ...CONFIG_FLAGS], {
      input: '{"toolCalls":[null],"subagentSpawns":[],"userMessages":[]}',
      encoding: 'utf-8',
    });
    expect(nullElement.status).toBe(2);
  });

  it('each of the three required lists empty, an unknown flag, and a -- token in a value position yield exit 2', () => {
    // Mutation caught: the config fail-closed gate missing on any of the three required
    // axes (a misassembled meta-covenant silently degrading to universal uphold); an
    // unknown flag ignored instead of failing closed; or a dropped value shifting the pair
    // grid so a '--' flag token is consumed as a value while the config gate still passes.
    const noPath = spawnSync(
      process.execPath,
      [bodyPath, '--shell-tool', SHELL_TOOL, '--command-arg', COMMAND_ARG],
      { input: JSON.stringify(shellCall(`sed -i s/a/b/ ${PROTECTED}`)), encoding: 'utf-8' },
    );
    expect(noPath.status).toBe(2);

    const noTool = spawnSync(
      process.execPath,
      [bodyPath, '--protected-path', PROTECTED, '--command-arg', COMMAND_ARG],
      { input: JSON.stringify(shellCall(`sed -i s/a/b/ ${PROTECTED}`)), encoding: 'utf-8' },
    );
    expect(noTool.status).toBe(2);

    const noArg = spawnSync(
      process.execPath,
      [bodyPath, '--protected-path', PROTECTED, '--shell-tool', SHELL_TOOL],
      { input: JSON.stringify(shellCall(`sed -i s/a/b/ ${PROTECTED}`)), encoding: 'utf-8' },
    );
    expect(noArg.status).toBe(2);

    const unknownFlag = spawnSync(
      process.execPath,
      [bodyPath, ...CONFIG_FLAGS, '--unknown-flag', 'x'],
      { input: JSON.stringify(shellCall(`cat ${PROTECTED}`)), encoding: 'utf-8' },
    );
    expect(unknownFlag.status).toBe(2);

    // A dropped value: '--command-arg' lands in the value slot of '--protected-path'.
    const shiftedGrid = spawnSync(
      process.execPath,
      [bodyPath, '--protected-path', '--command-arg', COMMAND_ARG, '--shell-tool', SHELL_TOOL],
      { input: JSON.stringify(shellCall(`cat ${PROTECTED}`)), encoding: 'utf-8' },
    );
    expect(shiftedGrid.status).toBe(2);
  });

  it('zero --allow-read uses the default allowlist; one or more --allow-read REPLACES it', () => {
    // Mutation caught: --allow-read merging into the default instead of replacing it (§4.4).
    // With the default, `cat <protected>` upholds (exit 0). With only an unrelated
    // --allow-read entry, `cat` is no longer allowlisted, so the same command breaks
    // (exit 1) via the backstop — proving replacement, not merge.
    const withDefault = spawnSync(process.execPath, [bodyPath, ...CONFIG_FLAGS], {
      input: JSON.stringify(shellCall(`cat ${PROTECTED}`)),
      encoding: 'utf-8',
    });
    expect(withDefault.status).toBe(0);

    const replaced = spawnSync(
      process.execPath,
      [bodyPath, ...CONFIG_FLAGS, '--allow-read', 'somethingelse'],
      { input: JSON.stringify(shellCall(`cat ${PROTECTED}`)), encoding: 'utf-8' },
    );
    expect(replaced.status).toBe(1);
  });
});

describe('shell-mod E2E through dispatchCovenants (PRD §5.4)', () => {
  let dir: string;
  let telemetryPath: string;

  function shellModRegistration(label: string): CovenantRegistration {
    return {
      label,
      protectedPaths: [PROTECTED],
      body: {
        command: process.execPath,
        args: [bodyPath, ...CONFIG_FLAGS],
      },
    };
  }

  function selfModRegistration(label: string): CovenantRegistration {
    return {
      label,
      protectedPaths: [PROTECTED],
      body: {
        command: process.execPath,
        args: [
          selfModBodyPath,
          '--protected-path',
          PROTECTED,
          '--mutating-tool',
          'Edit',
          '--mutating-tool',
          'Write',
          '--mutating-tool',
          'MultiEdit',
        ],
      },
    };
  }

  function readTelemetryLines(path: string): string[] {
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pdks-shellmod-'));
    telemetryPath = join(dir, 'roi.log');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('the sed -i vector blocks with exitCode 2 and one blocked telemetry record (label + subject)', async () => {
    // Mutation caught: the real compiled body not spawned by the dispatcher, or the break
    // verdict not translated to the dispatcher's blocking exit code 2 — the symbol case
    // (`sed -i 's/exit 2/exit 0/' <protected>`) must die through the full round trip.
    const input = shellCall(`sed -i 's/exit 2/exit 0/' ${PROTECTED}`);
    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [shellModRegistration('shell-mod')],
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record?.event).toBe('blocked');
    expect(record?.label).toBe('shell-mod');
    expect(record?.subject).toBe(PROTECTED);
  });

  it('a read-only vector spawns the body then upholds: exitCode 0 with a telemetry record proving the spawn', async () => {
    // Mutation caught: the dispatcher short-circuiting on the protected-path mention (never
    // spawning), or the body over-blocking a legitimate read. runCovenant records every
    // spawn, so a `passed` record proves the friction valve's full path: routed, spawned,
    // then absolved.
    const input = shellCall(`cat ${PROTECTED}`);
    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [shellModRegistration('shell-mod')],
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record?.event).toBe('passed');
    expect(record?.label).toBe('shell-mod');
  });

  it('co-existence: a mutating-tool-shaped input breaks only self-mod, shell-mod upholds', async () => {
    // P0 run-all co-existence (§5.4/§7): both bodies register with the same protectedPaths.
    // An Edit-shaped input is the tool axis — self-mod must block it (exit 2) and shell-mod
    // must uphold it (exit 0, non-shell tool name). Mutation caught: shell-mod breaking on
    // the tool axis (double-block / axis confusion), defeating the mirror boundary.
    const input = inputWithToolCall('Edit', {
      file_path: PROTECTED,
      old_string: 'a',
      new_string: 'b',
    });
    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [selfModRegistration('self-mod'), shellModRegistration('shell-mod')],
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    const selfMod = result.results.find((r) => r.label === 'self-mod');
    const shellMod = result.results.find((r) => r.label === 'shell-mod');
    expect(selfMod?.exitCode).toBe(2);
    expect(shellMod?.exitCode).toBe(0);

    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(2);
  });

  it('co-existence: a shell-tool write input breaks only shell-mod, self-mod upholds', async () => {
    // The reverse mirror: a Bash-shaped write is the shell axis — shell-mod must block it
    // (exit 2) and self-mod must uphold it (exit 0, tool name not in its mutating list).
    // Mutation caught: self-mod reaching into the command string and breaking on the Bash
    // axis, which would double-count and break the axis separation.
    const input = shellCall(`sed -i 's/exit 2/exit 0/' ${PROTECTED}`);
    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [selfModRegistration('self-mod'), shellModRegistration('shell-mod')],
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    const selfMod = result.results.find((r) => r.label === 'self-mod');
    const shellMod = result.results.find((r) => r.label === 'shell-mod');
    expect(shellMod?.exitCode).toBe(2);
    expect(selfMod?.exitCode).toBe(0);

    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(2);
  });
});
