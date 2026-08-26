import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants } from '../src/dispatch.ts';
import { selfModRegistration } from '../src/self-mod.ts';
import {
  DEFAULT_READ_ONLY_COMMANDS,
  judgeShellModification,
  type ShellModificationSpec,
  shellModRegistration,
} from '../src/shell-mod.ts';
import { readTelemetryLines } from './helpers.js';

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

describe('judgeShellModification — break direction', () => {
  it('sed -i on the protected path breaks, with reason carrying the rule name and path', () => {
    // The rule set must carry sedInPlaceRule and its detected target must be matched against
    // protectedPaths, or `sed -i 's/exit 2/exit 0/' <judge>` rewrites the judge and passes.
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
    // Without analyzing the redirect target of a `>`-with-heredoc command,
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
    // `tee <protected>` writes with no redirect operator at all, so only the rule catches it.
    const verdict = judgeShellModification(shellCall(`tee ${PROTECTED}`), baseSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain('tee');
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('a compound line breaks on the write half even when the leading command is harmless', () => {
    // Judged as one line rather than per simple command, the harmless `echo ok` absolves the
    // trailing `sed -i`.
    const verdict = judgeShellModification(
      shellCall(`echo ok && sed -i s/a/b/ ${PROTECTED}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('a protected-path mention inside a command substitution breaks (opaque mention)', () => {
    // A protected path inside a command substitution is undecidable, so it blocks. Treating
    // the mention as a transparent read upholds it instead.
    const verdict = judgeShellModification(shellCall(`echo $(cat ${PROTECTED})`), baseSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('an allowlisted reader with an opaque write target breaks (opaque redirect target)', () => {
    // The clause order is the invariant: with the allowlist evaluated before the opaque-write
    // check, `cat <protected> > $(x)` is absolved by `cat` even though the write target could
    // resolve to the protected path.
    const verdict = judgeShellModification(shellCall(`cat ${PROTECTED} > $(x)`), baseSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('a plain mention by a non-allowlisted command breaks (backstop)', () => {
    // The mention backstop: `node x.js <protected>` names the path, is not allowlisted, and
    // has no write or opaque structure, so nothing else on the ladder can answer it. The
    // reason carries the first word so the backstop is diagnosable.
    const verdict = judgeShellModification(shellCall(`node x.js ${PROTECTED}`), baseSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain('node');
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('an eval wrapping a sed -i on the protected path breaks (backstop covers nested shells)', () => {
    // eval is a reinterpretation boundary reported indeterminate rather than parsed into, so
    // the inner `sed -i` is invisible to the rules. The mention backstop is what blocks here,
    // and removing it leaks every nested shell.
    const verdict = judgeShellModification(
      shellCall(`eval 'sed -i s/a/b/ ${PROTECTED}'`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('a line left half-read still breaks on the path its read half names', () => {
    // The read half reaches precise judgment, so what fails closed here is the allowlist:
    // `cat` would normally be absolved, and the unread span withholds that, because what the
    // scanner never read could be anything and no head vouches for the whole line.
    const verdict = judgeShellModification(shellCall(`cat ${PROTECTED} "unclosed`), baseSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('a tokenize failure whose quote-split target names the protected path breaks (high-review regression)', () => {
    // The fallback strips quotes before matching, so a quote-split protected target is not
    // hidden by the very quoting that broke tokenization. Matching the raw quoted line misses
    // `sub/prot"e"cted`.
    const verdict = judgeShellModification(
      shellCall(`printf x > sub/prot"e"cted/file.txt 'unclosed`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('a shell-tool call with no string value under any command-arg key breaks (misassembly)', () => {
    // A shell-tool call whose command cannot be read — an arg-name typo, or a non-string
    // value — fails closed, so a misassembled meta-covenant cannot wave everything through.
    const input = inputWithToolCall(SHELL_TOOL, { notTheCommandKey: 123, another: false });

    const verdict = judgeShellModification(input, baseSpec());

    expect(verdict.upheld).toBe(false);
  });

  it('an allowlisted reader fronting a process substitution that writes the protected path breaks', () => {
    // Bash executes the inner sed of `cat <(sed -i … <protected>)`, writing the protected
    // file. The tokenizer must consume `<(…)` as one opaque word so the path lands inside an
    // opaque token; otherwise the inner args leak as plain words and the leading `cat` is
    // absolved by the allowlist.
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
    // `git diff --output=<file>` writes with no redirect, so no rule fires. `git diff`,
    // `git log` and `git show` are therefore kept OUT of the default allowlist — all three are
    // write-capable through `--output` — and the mention reaches the backstop.
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
    // The default allowlist excludes nested shells, but a misassembled allowlist entry must
    // not absolve `sh -c '…write…'` either: a nested shell re-parses its string argument, so
    // it can never be proven read-only.
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
    // A whitespace-only entry tokenizes to an empty word list, which a naive sequence match
    // accepts vacuously — one blank allowlist entry then turns every protected-path mention
    // into a proven read.
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

describe('judgeShellModification — uphold direction', () => {
  it('sed -i, tee, and printf redirect on an UNPROTECTED path all uphold (roadmap AC "non-protected same command")', () => {
    // Matching on "is a write" alone, rather than against the protected-path list,
    // over-blocks every write regardless of destination.
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
    // Without the allowlist, every protected-path mention backstops to a break and legitimate
    // reads become friction. The `git status` case also proves the multi-word sequence match:
    // `git` alone is not enough, `status` must follow. Unlike `git diff` it has no `--output`
    // write flag, so it stays a proven read-only entry.
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
    // `grep x <protected> > /tmp/out` reads the protected file and writes elsewhere, which is
    // legitimate. Both an unprotected write target read as a reason to block, and an
    // allowlist that does not clear the mention, over-block it.
    expect(judgeShellModification(shellCall(`grep x ${PROTECTED} > /tmp/out`), baseSpec())).toEqual(
      { upheld: true },
    );
  });

  it('a protected path appearing only in a heredoc BODY upholds (body is data — 04c boundary)', () => {
    // The body is data and must be excluded from mention analysis: scanned as command words,
    // a protected path quoted inside a document written elsewhere blocks.
    expect(
      judgeShellModification(shellCall(`cat > /tmp/x <<EOF\n${PROTECTED}\nEOF`), baseSpec()),
    ).toEqual({ upheld: true });
  });

  it('a non-shell (mutating-tool-shaped) call mentioning the protected path upholds (co-existence boundary)', () => {
    // The mirror of self-mod's boundary: the tool axis belongs to self-mod, and a non-shell
    // tool name is not in shellToolNames. Judging by mention alone pre-empts self-mod.
    const input = inputWithToolCall('Edit', { file_path: PROTECTED });

    expect(judgeShellModification(input, baseSpec())).toEqual({ upheld: true });
  });

  it('a tokenize failure without a raw mention upholds, and empty toolCalls upholds', () => {
    // An unread span defaulting to break over-blocks every malformed line even when it names
    // no protected path; a fallback that breaks on zero tool calls blocks a vacuous input.
    expect(judgeShellModification(shellCall(`echo "unclosed`), baseSpec())).toEqual({
      upheld: true,
    });
    const empty: CovenantInput = { toolCalls: [], subagentSpawns: [], userMessages: [] };
    expect(judgeShellModification(empty, baseSpec())).toEqual({ upheld: true });
  });

  it('tool-name matching is exact (no substring) and empty-string entries in all four lists are ignored', () => {
    // An `includes()` tool-name check matches "BashRunner" against an injected "Bash"; an
    // unguarded '' entry vacuously matches every path, tool, arg and command, collapsing the
    // judge into a match-everything.
    const notShell = inputWithToolCall('BashRunner', {
      [COMMAND_ARG]: `sed -i s/a/b/ ${PROTECTED}`,
    });
    expect(judgeShellModification(notShell, baseSpec())).toEqual({ upheld: true });

    // Empty-string entries must not manufacture a universal match: this call names an
    // unprotected path only, so with all four lists carrying '' it must still uphold.
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
    // A verbatim first-word comparison misses `/bin/cat` and over-blocks it; an opaque first
    // word treated as allowlisted lets an unknowable command absolve a protected mention.
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

// A repository-shaped protected path, so the parent-operation and quote-split cases below are
// spelled the way the measured bypasses were.

const REAL_PROTECTED = 'packages/core/src';

/** A shell-mod spec keyed on the repository-shaped protected path. */
function realSpec(overrides: Partial<ShellModificationSpec> = {}): ShellModificationSpec {
  return {
    protectedPaths: [REAL_PROTECTED],
    shellToolNames: [SHELL_TOOL],
    commandArgNames: [COMMAND_ARG],
    readOnlyCommands: DEFAULT_READ_ONLY_COMMANDS,
    ...overrides,
  };
}

describe('judgeShellModification — parent-of-protected operations', () => {
  it('rm -rf on the protected parent directory breaks (ancestor match)', () => {
    // `packages/core` does not contain `packages/core/src` as a substring, so a substring
    // primitive passes this parent-of-protected deletion. Only ancestor matching blocks it.
    const verdict = judgeShellModification(shellCall('rm -rf packages/core'), realSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(REAL_PROTECTED);
    }
  });

  it('mv of the protected parent directory breaks (ancestor match)', () => {
    // The same bypass on the move shape: `mv packages/core /tmp/x` relocates the parent of
    // the protected directory.
    const verdict = judgeShellModification(shellCall('mv packages/core /tmp/x'), realSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(REAL_PROTECTED);
    }
  });
});

describe('judgeShellModification — quote/escape/line-continuation split path', () => {
  it('a quote-split protected path in a redirect target breaks (tokenizer strips quotes)', () => {
    // The raw `packages/core/sr"c"/index.ts` carries no contiguous `packages/core/src`, so a
    // judge matching the raw string rather than the quote-stripped word misses it while the
    // shell writes the protected file.
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
    // The fixture's byte sequence is a backslash then an actual newline mid-path. Bash elides
    // it as a line continuation, so the word is `packages/core/src/...`; a scanner inserting a
    // literal newline instead reads a path the shell never sees.
    const line = 'printf x > packages/core/sr\\\nc/index.ts';
    const verdict = judgeShellModification(shellCall(line), realSpec());

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(REAL_PROTECTED);
    }
  });
});

describe('shell-mod E2E through dispatchCovenants', () => {
  let dir: string;
  let telemetryPath: string;

  /** The shipped builder, relabelled so co-existence cases can name each registration. */
  function shellModReg(label: string): CovenantRegistration {
    return {
      ...shellModRegistration({
        protectedPaths: [PROTECTED],
        shellTools: [SHELL_TOOL],
        commandArgs: [COMMAND_ARG],
      }),
      label,
    };
  }

  function selfModReg(label: string): CovenantRegistration {
    return {
      ...selfModRegistration({
        protectedPaths: [PROTECTED],
        mutatingToolNames: ['Edit', 'Write', 'MultiEdit'],
      }),
      label,
    };
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pdks-shellmod-'));
    telemetryPath = join(dir, 'roi.log');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('the sed -i vector blocks with exitCode 2 and one blocked telemetry record (label + subject)', async () => {
    // The rewrite-the-judge shape has to die through the full round trip, not only in the
    // pure judge: the dispatcher must spawn the compiled body and translate its break into
    // the blocking exit code 2.
    const input = shellCall(`sed -i 's/exit 2/exit 0/' ${PROTECTED}`);
    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [shellModReg('shell-mod')],
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
    // Every spawn is recorded, so a `passed` row proves the whole path — routed, spawned,
    // then absolved. The failure directions are the dispatcher short-circuiting on the mention
    // and never spawning, and the body over-blocking a legitimate read.
    const input = shellCall(`cat ${PROTECTED}`);
    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [shellModReg('shell-mod')],
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
    // Both bodies register with the same protectedPaths. An Edit-shaped input is the tool
    // axis, so self-mod blocks it and shell-mod upholds it; shell-mod breaking here would
    // double-count the same call across two axes.
    const input = inputWithToolCall('Edit', {
      file_path: PROTECTED,
      old_string: 'a',
      new_string: 'b',
    });
    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [selfModReg('self-mod'), shellModReg('shell-mod')],
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
    // The reverse mirror: a Bash-shaped write is the shell axis, so shell-mod blocks it and
    // self-mod upholds it. Self-mod reaching into the command string would double-count.
    const input = shellCall(`sed -i 's/exit 2/exit 0/' ${PROTECTED}`);
    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [selfModReg('self-mod'), shellModReg('shell-mod')],
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
