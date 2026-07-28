import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CovenantInput, FileChange } from '@polydeukes/core';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { CovenantRegistration } from '../src/dispatch.js';
import { dispatchCovenants } from '../src/dispatch.js';
import { envWitness } from '../src/env-witness.js';
import { judgeSelfModification } from '../src/self-mod.js';
import { readTelemetryLines } from './helpers.js';

// ---------------------------------------------------------------------------
// Fixture values. Tool-name strings and protected-path strings below are
// injected fixture values, never source literals (COVENANT-03 §4.1/§7,
// COVENANT-09 §7).
// ---------------------------------------------------------------------------

const MUTATING_TOOLS = ['Edit', 'Write', 'MultiEdit'];
const PROTECTED = 'sub/protected/file.txt';
const PROTECTED_DIR = 'sub/protected';
const NON_PROTECTED = 'notes/design/entry.md';

/** Build a minimal CovenantInput with a single toolCalls[0] and no evidence. */
function inputWithToolCall(name: string, args: Record<string, unknown>): CovenantInput {
  return {
    toolCalls: [{ name, args }],
    subagentSpawns: [],
    userMessages: [],
  };
}

/** Build a CovenantInput with a single call carrying its own nested evidence (CORE-06). */
function inputWithCall(call: CovenantInput['toolCalls'][number]): CovenantInput {
  return {
    toolCalls: [call],
    subagentSpawns: [],
    userMessages: [],
  };
}

// ---------------------------------------------------------------------------
// Evidence-free judgment — COVENANT-03 §5.1, now the permanent conservative
// fallback of COVENANT-09 §4.1 rule ②: a mutating call without its own
// `fileChange` is judged by the arbitrary-depth args mention traversal.
// ---------------------------------------------------------------------------

describe('judgeSelfModification — evidence-free fallback (COVENANT-03 §5.1 / COVENANT-09 §4.1 ②)', () => {
  it('a mutating tool call mentioning the protected path in a top-level arg breaks, with reason containing the tool name and path', () => {
    // Mutation caught: break condition inverted (uphold instead of break), or the
    // reason string not carrying the diagnostic tool name/path (silent, unhelpful break).
    const input = inputWithToolCall('Edit', { file_path: PROTECTED });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain('Edit');
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('a mutating tool call mentioning the protected path nested inside a MultiEdit-style edits array breaks', () => {
    // Mutation caught: a shallow scan that only inspects top-level arg values, missing
    // the MultiEdit shape args.edits[].file_path entirely (04d co-existence requires depth).
    const input = inputWithToolCall('MultiEdit', {
      edits: [{ file_path: PROTECTED, old_string: 'a', new_string: 'b' }],
    });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({
      upheld: false,
      reason: expect.stringContaining(PROTECTED),
    });
  });

  it('a non-mutating tool call mentioning the protected path is upheld (tool-path covenant judges only its own axis)', () => {
    // P0 co-existence invariant (COVENANT-03 §3/§7): a Bash-shaped call is not in
    // mutatingToolNames, so this covenant must not break on it — that axis belongs to
    // the Bash meta-covenant (04b-04d). Mutation caught: judging by mention alone,
    // ignoring the tool-name axis, which would pre-empt the Bash covenant's allowlist.
    const input = inputWithToolCall('Bash', { command: `cat ${PROTECTED}` });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({ upheld: true });
  });

  it('a mutating tool call mentioning only non-protected paths is upheld', () => {
    // Mutation caught: break condition dropping the path-mention half of the predicate,
    // breaking on tool name alone regardless of what the args mention.
    const input = inputWithToolCall('Edit', { file_path: 'sub/unrelated/other.txt' });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({ upheld: true });
  });

  it('tool-name matching is exact: an injected "Edit" entry does not match a call named "MultiEdit"', () => {
    // P0 boundary from COVENANT-03 §4.1: "not substring — 'Edit' must not falsely match
    // 'MultiEdit'". Mutation caught: exact-equality check replaced with a substring/
    // includes() check on the tool name.
    const input = inputWithToolCall('MultiEdit', { file_path: PROTECTED });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: ['Edit'],
    });

    expect(verdict).toEqual({ upheld: true });
  });

  it('an empty-string entry in protectedPaths is ignored (no match-everything)', () => {
    // Mutation caught: an unguarded '' entry vacuously substring-matches every arg
    // value, turning this covenant into a break-on-every-mutating-call rule.
    const input = inputWithToolCall('Edit', { file_path: 'sub/unrelated/other.txt' });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [''],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({ upheld: true });
  });

  it('an empty-string entry in mutatingToolNames is ignored (no match-every-tool)', () => {
    // Mutation caught: an unguarded '' entry in mutatingToolNames matching every tool
    // name via a non-exact comparison, turning every tool call into a mutating one.
    const input = inputWithToolCall('Bash', { command: `cat ${PROTECTED}` });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: [''],
    });

    expect(verdict).toEqual({ upheld: true });
  });
});

// ---------------------------------------------------------------------------
// COVENANT-09 §4.1 — target-vs-mention judgment over CORE-06 call-nested
// evidence. Per mutating call: ① `call.fileChange` present → compare ONLY that
// evidence's path against protectedPaths (COVENANT-07 segment semantics), args
// never consulted; ② `call.fileChange` absent → the conservative args mention
// fallback above. Non-mutating calls are never judged (axis boundary).
//
// AC fixture discipline (PRD §5 preamble): every fixture is built in the
// direction that breaks the invariant — content bodies carry the protected-path
// literal verbatim (that literal IS the mutant each AC1 test exists to catch),
// and AC2's evidence is the only protected signal in its input. Never
// `content: 'x'`.
// ---------------------------------------------------------------------------

describe('judgeSelfModification — AC1 mention-target distinction (COVENANT-09 §5.1)', () => {
  it('a Write creating a non-protected doc whose content quotes the protected path verbatim is upheld when the call carries create evidence', () => {
    // P0 direction reversal — the false-positive class this ticket exists to close.
    // Mutation caught: the args mention traversal still consulted for a mutating call
    // that carries its own fileChange (today's behavior — this test is the RED point),
    // or the evidence branch never entered at all.
    const body = `the covenant protects ${PROTECTED} and blocks writes to it`;
    const input = inputWithCall({
      name: 'Write',
      args: { file_path: NON_PROTECTED, content: body },
      fileChange: { kind: 'create', path: NON_PROTECTED, post: body },
    });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({ upheld: true });
  });

  it('an Edit whose new_string cites the protected path is upheld when modify evidence names the non-protected target', () => {
    // Same reversal for the modify kind. Mutation caught: the evidence branch implemented
    // for `create` only (e.g. a `post`-presence check standing in for the kind switch),
    // leaving modify-shaped calls to fall back to the args traversal and break.
    const citation = `see ${PROTECTED} for the judge implementation`;
    const input = inputWithCall({
      name: 'Edit',
      args: { file_path: NON_PROTECTED, old_string: 'draft', new_string: citation },
      fileChange: { kind: 'modify', path: NON_PROTECTED, pre: 'draft', post: citation },
    });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({ upheld: true });
  });

  it('evidence outranks args: a modify of a non-protected file is upheld even when args.file_path IS the protected path literal', () => {
    // §4.1 ① killer pin — "args are not consulted when evidence is present". The args
    // deliberately carry the protected path in the target slot AND quote it in the
    // content slot, so ANY residual args consultation on the evidence branch — a
    // defensive "also scan args" clause, judging args before evidence, or unioning the
    // two verdicts — breaks this call. Only a judge that reads the call's own nested
    // evidence alone can uphold it. This single test proves the evidence branch is the
    // whole judgment for a proven call.
    const body = `never edit ${PROTECTED} directly — it is covenant-protected`;
    const input = inputWithCall({
      name: 'Edit',
      args: { file_path: PROTECTED, old_string: 'draft', new_string: body },
      fileChange: { kind: 'modify', path: NON_PROTECTED, pre: 'draft', post: body },
    });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({ upheld: true });
  });
});

describe('judgeSelfModification — AC2 true self-mod unchanged (COVENANT-09 §5.2)', () => {
  it('evidence naming an ABSOLUTE protected descendant breaks even though the args mention no protected path, with the tool name and change path in the reason', () => {
    // P0 the safety half: the one fixture the fallback cannot rescue — the args name
    // only a non-protected path, so a judge that drops the evidence branch (or never
    // compares evidence paths) upholds and fails OPEN on true self-mod. The change path
    // folds the exact/absolute/descendant axes into the evidence side: an absolute
    // descendant of the relative protected entry defeats raw string equality,
    // startsWith on the relative entry, and whole-path comparison alike (COVENANT-07
    // segment semantics required). Mutation caught: any of those weakenings, or a
    // reason dropping the diagnostic tool name / change path.
    const absoluteDescendant = `/home/u/proj/${PROTECTED_DIR}/nested/deep.ts`;
    const input = inputWithCall({
      name: 'Edit',
      args: {
        file_path: NON_PROTECTED,
        old_string: 'export const judge = () => {};',
        new_string: 'export const judge = () => true;',
      },
      fileChange: {
        kind: 'modify',
        path: absoluteDescendant,
        pre: 'export const judge = () => {};',
        post: 'export const judge = () => true;',
      },
    });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED_DIR],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain('Edit');
      expect(verdict.reason).toContain(absoluteDescendant);
    }
  });

  it('delete evidence of a protected path breaks even when the call carries no args at all', () => {
    // NEW capability (CORE-06): a deletion was unrepresentable in the old flat evidence
    // and fell through to the args fallback — the shipped commit-surface fail-open.
    // The call deliberately has NO args, so the evidence is the only signal: a judge
    // that still reads args instead of the evidence sees nothing and upholds.
    // Mutation caught: the evidence comparison keyed on a kind carrying `post`
    // (create/modify only), silently skipping `delete` — protected-source deletion
    // rides through as unproven-but-mentionless.
    const input = inputWithCall({
      name: 'Write',
      fileChange: { kind: 'delete', path: PROTECTED, pre: 'export const judge = () => {};' },
    });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain('Write');
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('an evidence path that is a sibling sharing a raw prefix across the segment boundary is upheld', () => {
    // Boundary across the segment edge: `sub/protected-extra` must not match
    // `sub/protected`. Mutation caught: the evidence comparison implemented with raw
    // substring includes()/startsWith instead of the COVENANT-07 segment primitive,
    // which would resurrect the over-blocking this ticket exists to remove.
    const sibling = `${PROTECTED_DIR}-extra/generated.ts`;
    const input = inputWithCall({
      name: 'Write',
      args: { file_path: sibling, content: 'generated module body' },
      fileChange: { kind: 'create', path: sibling, post: 'generated module body' },
    });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED_DIR],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({ upheld: true });
  });
});

describe('judgeSelfModification — AC3 evidence-free fallback conservatism (COVENANT-09 §5.3)', () => {
  it('sibling-absolution regression pin: one call carrying non-protected evidence never absolves an evidence-free sibling mentioning a protected path', () => {
    // P0 regression pin for the first-generation fail-open (PR #32): a flat input-level
    // evidence array let any call's evidence stand in for an unproven sibling. CORE-06
    // nests evidence per call, so this must be structurally impossible. Mutation caught:
    // gating the fallback on input-level evidence presence (e.g. `if
    // (allFileChanges(input).length > 0)` around the whole judgment) instead of on each
    // call's own fileChange — call B rides call A's evidence past the gate.
    const docBody = `documents the covenant over ${PROTECTED}`;
    const input: CovenantInput = {
      toolCalls: [
        {
          name: 'Write',
          args: { file_path: NON_PROTECTED, content: docBody },
          fileChange: { kind: 'create', path: NON_PROTECTED, post: docBody },
        },
        // Evidence-free sibling: its args mention the protected path — rule ② must break.
        { name: 'Write', args: { file_path: PROTECTED, content: 'overwrite the judge' } },
      ],
      subagentSpawns: [],
      userMessages: [],
    };

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('a binary-staged-shaped call — no fileChange, args carrying only the bare protected file_path — breaks via the fallback', () => {
    // The git adapter's one evidence-free non-deletion shape (CORE-06 review 1R): a
    // binary staged change ships no fileChange, and its args carry the bare path with
    // no content body at all. Mutation caught: the fallback keyed on content-like slots
    // (`content`/`new_string`) instead of the full args traversal, which would let every
    // binary change to a protected path ride through unproven and unjudged.
    const input = inputWithToolCall('Write', { file_path: PROTECTED });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toContain(PROTECTED);
    }
  });

  it('a malformed fileChange element (path not a string) is skipped defensively and the call falls back to the args traversal', () => {
    // Element shapes are an intentionally unvalidated CORE-01 boundary — core parseInput
    // checks only the collection shapes — so a fileChange without a string `path` can
    // reach this judge. Mutation caught: an unguarded `fileChange.path` read throwing a
    // TypeError out of the pure judge (a direct consumer reads that as non-blocking), or
    // the malformed element counted as proof and upholding the call outright (fail-open
    // on a payload the judge cannot actually judge).
    const input = inputWithCall({
      name: 'Write',
      args: { file_path: PROTECTED, content: 'overwrite the judge' },
      fileChange: { kind: 'modify', pre: 'a', post: 'b' } as unknown as FileChange,
    });

    const spec = { protectedPaths: [PROTECTED], mutatingToolNames: MUTATING_TOOLS };
    expect(() => judgeSelfModification(input, spec)).not.toThrow();
    // The malformed element proves nothing, so the call is judged by its args mention.
    expect(judgeSelfModification(input, spec).upheld).toBe(false);
  });

  it('a degenerate evidence path (zero segments) proves nothing and the call falls back to the args traversal', () => {
    // Review finding (PR #32 round 2, execution-verified): '' and '.' pass a bare string
    // check, match no protected entry — pathSegments yields zero segments — and the
    // evidence branch then suppressed the fallback, upholding a Write whose args named
    // the protected path literally. Mutation caught: entering the evidence branch on any
    // string path instead of only on a path that carries segments to judge.
    for (const degenerate of ['', '.', './', '/']) {
      const input = inputWithCall({
        name: 'Write',
        args: { file_path: PROTECTED, content: 'overwrite the judge' },
        fileChange: { kind: 'create', path: degenerate, post: 'x' },
      });

      const verdict = judgeSelfModification(input, {
        protectedPaths: [PROTECTED],
        mutatingToolNames: MUTATING_TOOLS,
      });

      expect(verdict.upheld).toBe(false);
      if (!verdict.upheld) {
        expect(verdict.reason).toContain(PROTECTED);
      }
    }
  });

  it('an evidence stub with a string path but no recognized kind proves nothing and the call falls back to the args traversal', () => {
    // The same unvalidated CORE-01 boundary admits a one-field stub {path} or a bogus
    // discriminant — treating either as proof would let an untrusted producer suppress
    // the conservative fallback with a single junk field. Mutation caught: gating the
    // evidence branch on `fileChange.path` alone, ignoring the discriminant.
    for (const stub of [{ path: NON_PROTECTED }, { kind: 'bogus', path: NON_PROTECTED }]) {
      const input = inputWithCall({
        name: 'Write',
        args: { file_path: PROTECTED, content: 'overwrite the judge' },
        fileChange: stub as unknown as FileChange,
      });

      const verdict = judgeSelfModification(input, {
        protectedPaths: [PROTECTED],
        mutatingToolNames: MUTATING_TOOLS,
      });

      expect(verdict.upheld).toBe(false);
      if (!verdict.upheld) {
        expect(verdict.reason).toContain(PROTECTED);
      }
    }
  });
});

describe('judgeSelfModification — AC4 axis boundary unchanged (COVENANT-09 §5.4)', () => {
  it('a non-mutating Bash-shaped call is upheld even when it carries evidence naming the protected path', () => {
    // P0 axis co-existence (§4.1 "non-mutating calls unchanged"): the Bash axis belongs
    // to the shell-mod meta-covenant. Mutation caught: the evidence comparison hoisted
    // out of the per-call mutating-tool check into an input-level allFileChanges scan,
    // which would break on every input carrying protected evidence regardless of tool
    // name and pre-empt the Bash covenant's read-only allowlist.
    const input = inputWithCall({
      name: 'Bash',
      args: { command: `cat ${PROTECTED}` },
      fileChange: { kind: 'modify', path: PROTECTED, pre: 'a', post: 'b' },
    });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({ upheld: true });
  });
});

// ---------------------------------------------------------------------------
// envWitness (COVENANT-03 §4.3)
// ---------------------------------------------------------------------------

describe('envWitness — env-var predicate (COVENANT-03 §4.3)', () => {
  const TEST_VAR = 'PDKS_TEST_SELF_MOD_WITNESS_VAR';
  const dummyInput: CovenantInput = { toolCalls: [], subagentSpawns: [], userMessages: [] };

  afterEach(() => {
    delete process.env[TEST_VAR];
  });

  it('returns false when the named env var is set to the empty string', () => {
    // Boundary case: an empty string is "set" in the shell sense but must not count as
    // a truthy witness. Mutation caught: a `!== undefined` check instead of a non-empty
    // string check.
    process.env[TEST_VAR] = '';

    expect(envWitness(TEST_VAR)(dummyInput)).toBe(false);
  });

  it('returns false when the named env var is unset', () => {
    // Unset and empty-string take different paths through the non-empty check, and the
    // E2E case that used to cover the unset direction was pruned with it — re-pinned here
    // (review round 2) so the pair-wise deletion leaves no gap. Mutation caught: a witness
    // that treats absence as consent (`undefined` falling into the truthy arm), silently
    // bypassing every covenant registered with a witness.
    delete process.env[TEST_VAR];

    expect(envWitness(TEST_VAR)(dummyInput)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// COVENANT-03 §5.2 (body CLI) + §5.3 (dispatcher E2E) — real compiled artifact.
// ---------------------------------------------------------------------------

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const bodyPath = fileURLToPath(new URL('../dist/self-mod-body.js', import.meta.url));

beforeAll(() => {
  execFileSync('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@polydeukes/covenant'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
}, 120_000);

describe('self-mod-body CLI (COVENANT-03 §5.2)', () => {
  it('a break input yields exit 1 with the mentioned path on stderr', () => {
    // Mutation caught: verdictToExitCode wired backwards (break -> 0), or the break
    // reason not surfaced on stderr at all.
    const input = inputWithToolCall('Edit', { file_path: PROTECTED });

    const result = spawnSync(
      process.execPath,
      [bodyPath, '--protected-path', PROTECTED, '--mutating-tool', 'Edit'],
      { input: JSON.stringify(input), encoding: 'utf-8' },
    );

    expect(result.status).toBe(1);
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.stderr).toContain(PROTECTED);
  });

  it('invalid JSON on stdin yields exit 2 (CORE-01 fail-closed)', () => {
    // Mutation caught: the CLI not calling core parseInput's fail-closed path, e.g.
    // crashing with an uncaught exception (undefined/null exit code) instead of exit 2.
    const result = spawnSync(
      process.execPath,
      [bodyPath, '--protected-path', PROTECTED, '--mutating-tool', 'Edit'],
      { input: 'not valid json at all {{{', encoding: 'utf-8' },
    );

    expect(result.status).toBe(2);
  });

  it('zero --protected-path flags yields exit 2 (config fail-closed)', () => {
    // P0: COVENANT-03 §4.2 "quietly leaking into universal uphold is itself a bypass
    // vector". Mutation caught: an empty protectedPaths list silently treated as
    // vacuous-uphold (exit 0) instead of a fail-closed config error.
    const input = inputWithToolCall('Edit', { file_path: PROTECTED });

    const result = spawnSync(process.execPath, [bodyPath, '--mutating-tool', 'Edit'], {
      input: JSON.stringify(input),
      encoding: 'utf-8',
    });

    expect(result.status).toBe(2);
  });

  it('zero --mutating-tool flags yields exit 2 (config fail-closed)', () => {
    // Same fail-closed boundary as above, other axis of the spec.
    const input = inputWithToolCall('Edit', { file_path: PROTECTED });

    const result = spawnSync(process.execPath, [bodyPath, '--protected-path', PROTECTED], {
      input: JSON.stringify(input),
      encoding: 'utf-8',
    });

    expect(result.status).toBe(2);
  });

  it('only empty-string values for both flags yields exit 2 (config fail-closed)', () => {
    // Mutation caught: raw flag *count* treated as "valid config" without filtering
    // empty-string entries, letting a misconfigured assembly slip through as exit 0/1
    // instead of failing closed.
    const input = inputWithToolCall('Edit', { file_path: PROTECTED });

    const result = spawnSync(
      process.execPath,
      [bodyPath, '--protected-path', '', '--mutating-tool', ''],
      { input: JSON.stringify(input), encoding: 'utf-8' },
    );

    expect(result.status).toBe(2);
  });

  it('a flag token in a value position yields exit 2 (config fail-closed)', () => {
    // Review finding (COVENANT-03): a dropped value shifts the pair grid so the next
    // flag token is silently consumed as a value ('--mutating-tool' stored as a
    // protected path), passing the non-empty config gate while judging garbage —
    // a silent universal-uphold. Mutation caught: parseArgv accepting a '--'-prefixed
    // token as a flag value instead of failing closed.
    const input = inputWithToolCall('Edit', { file_path: PROTECTED });

    const result = spawnSync(
      process.execPath,
      [bodyPath, '--protected-path', '--mutating-tool', '--mutating-tool', 'Edit'],
      { input: JSON.stringify(input), encoding: 'utf-8' },
    );

    expect(result.status).toBe(2);
  });

  it('a structurally malformed toolCalls element yields exit 2, never a crash exit code (fail-closed)', () => {
    // Review finding (COVENANT-03): `toolCalls: [null]` passes core parseInput (element
    // shapes are an intended CORE-01 boundary) and would crash the judge with a
    // TypeError — Node exits 1, which the protocol reads as a *non-blocking* break.
    // Mutation caught: the CLI shell not translating a judge throw into the blocking 2.
    const result = spawnSync(
      process.execPath,
      [bodyPath, '--protected-path', PROTECTED, '--mutating-tool', 'Edit'],
      {
        input: '{"toolCalls":[null],"subagentSpawns":[],"userMessages":[]}',
        encoding: 'utf-8',
      },
    );

    expect(result.status).toBe(2);
  });

  it('an unknown flag yields exit 2 (config fail-closed)', () => {
    // Mutation caught: unrecognized argv silently ignored instead of failing closed —
    // a typo'd flag in assembly must not silently degrade into a differently-configured
    // (or unconfigured) meta-covenant.
    const input = inputWithToolCall('Edit', { file_path: PROTECTED });

    const result = spawnSync(
      process.execPath,
      [bodyPath, '--protected-path', PROTECTED, '--mutating-tool', 'Edit', '--unknown-flag', 'x'],
      { input: JSON.stringify(input), encoding: 'utf-8' },
    );

    expect(result.status).toBe(2);
  });
});

describe('self-mod E2E through dispatchCovenants (COVENANT-03 §5.3)', () => {
  let dir: string;
  let telemetryPath: string;
  const TEST_VAR = 'PDKS_TEST_SELF_MOD_E2E_HATCH_VAR';

  function selfModRegistration(
    label: string,
    witness?: (input: CovenantInput) => boolean,
  ): CovenantRegistration {
    return {
      label,
      protectedPaths: [PROTECTED],
      body: {
        command: process.execPath,
        args: [
          bodyPath,
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
      ...(witness ? { witness } : {}),
    };
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pdks-selfmod-'));
    telemetryPath = join(dir, 'roi.log');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env[TEST_VAR];
  });

  it('an Edit-shaped input mentioning the protected path blocks with one blocked telemetry record', async () => {
    // Mutation caught: the real compiled body not being spawned by the dispatcher, or
    // the break verdict not translated to the dispatcher's blocking exit code 2.
    const input = inputWithToolCall('Edit', {
      file_path: PROTECTED,
      old_string: 'a',
      new_string: 'b',
    });
    const reg = selfModRegistration('self-mod');

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(2);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record?.event).toBe('blocked');
    expect(record?.subject).toBe(PROTECTED);
  });

  it('an input mentioning only a non-protected path yields exitCode 0 and zero telemetry lines', async () => {
    // Mutation caught: dispatcher matching (protectedPaths) and judge break condition
    // disagreeing, or the covenant firing on unrelated content.
    const input = inputWithToolCall('Edit', { file_path: 'sub/unrelated/other.txt' });
    const reg = selfModRegistration('self-mod');

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(telemetryPath)).toBe(false);
  });

  it("witness with the env var set relaxes the body's break: exitCode 0, one witnessed record, subject=protected path", async () => {
    // P0 (COVENANT-03 §4.3 dispatch table row): the witness relaxes the judge's block and
    // must be measured, not silently passed. Mutation caught: witness not wired into the
    // dispatcher at all, or bypass logged as 'passed' instead of the distinct 'witnessed'
    // event, losing the "controlled, not measured" distinction the PRD requires.
    process.env[TEST_VAR] = 'set';
    const input = inputWithToolCall('Edit', {
      file_path: PROTECTED,
      old_string: 'a',
      new_string: 'b',
    });
    const reg = selfModRegistration('self-mod', envWitness(TEST_VAR));

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    const record = parseRecordLine(lines[0]);
    expect(record?.event).toBe('witnessed');
    expect(record?.label).toBe('self-mod');
    expect(record?.subject).toBe(PROTECTED);
  });
});
