import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput, FileChange } from '@polydeukes/core';
import { parseRecordLine } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CovenantRegistration } from '../src/dispatch.js';
import { dispatchCovenants } from '../src/dispatch.js';
import { judgeSelfModification, selfModRegistration } from '../src/self-mod.js';
import { readTelemetryLines } from './helpers.js';

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

/** Build a CovenantInput with a single call carrying its own nested evidence. */
function inputWithCall(call: CovenantInput['toolCalls'][number]): CovenantInput {
  return {
    toolCalls: [call],
    subagentSpawns: [],
    userMessages: [],
  };
}

// A mutating call without its own `fileChange` is judged by the arbitrary-depth args mention
// traversal — the permanent conservative fallback.

describe('judgeSelfModification — evidence-free fallback (COVENANT-03 §5.1 / COVENANT-09 §4.1 ②)', () => {
  it('a mutating tool call mentioning the protected path in a top-level arg breaks, with reason containing the tool name and path', () => {
    // The reason must carry the tool name and path, or the break is undiagnosable.
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
    // A shallow scan of top-level arg values misses the MultiEdit shape
    // args.edits[].file_path entirely, so the traversal has to be arbitrary-depth.
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
    // A Bash-shaped call is not in mutatingToolNames, so this judge must not break on it —
    // that axis belongs to the shell-mod covenant. Judging by mention alone would pre-empt
    // the shell covenant's read-only allowlist.
    const input = inputWithToolCall('Bash', { command: `cat ${PROTECTED}` });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({ upheld: true });
  });

  it('a mutating tool call mentioning only non-protected paths is upheld', () => {
    // Dropping the path-mention half of the predicate breaks on the tool name alone,
    // regardless of what the args mention.
    const input = inputWithToolCall('Edit', { file_path: 'sub/unrelated/other.txt' });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({ upheld: true });
  });

  it('tool-name matching is exact: an injected "Edit" entry does not match a call named "MultiEdit"', () => {
    // The comparison is exact, not substring: an `includes()` check on the tool name makes an
    // injected 'Edit' entry match 'MultiEdit'.
    const input = inputWithToolCall('MultiEdit', { file_path: PROTECTED });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: ['Edit'],
    });

    expect(verdict).toEqual({ upheld: true });
  });

  it('an empty-string entry in protectedPaths is ignored (no match-everything)', () => {
    // An unguarded '' entry vacuously matches every arg value, turning this judge into a
    // break-on-every-mutating-call.
    const input = inputWithToolCall('Edit', { file_path: 'sub/unrelated/other.txt' });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [''],
      mutatingToolNames: MUTATING_TOOLS,
    });

    expect(verdict).toEqual({ upheld: true });
  });

  it('an empty-string entry in mutatingToolNames is ignored (no match-every-tool)', () => {
    // An unguarded '' entry matching every tool name via a non-exact comparison turns every
    // tool call into a mutating one.
    const input = inputWithToolCall('Bash', { command: `cat ${PROTECTED}` });

    const verdict = judgeSelfModification(input, {
      protectedPaths: [PROTECTED],
      mutatingToolNames: [''],
    });

    expect(verdict).toEqual({ upheld: true });
  });
});

// Target-versus-mention judgment over call-nested evidence. Per mutating call: with
// `call.fileChange` present, compare ONLY that evidence's path against protectedPaths and never
// consult args; with it absent, fall back to the args mention traversal above. Non-mutating
// calls are never judged.
//
// Every fixture below is built in the direction that breaks the invariant: content bodies carry
// the protected-path literal verbatim, because that literal is what a judge consulting args
// would trip over, and the true-self-mod cases make their evidence the only protected signal in
// the input. A body of `content: 'x'` would leave both branches indistinguishable.

describe('judgeSelfModification — AC1 mention-target distinction (COVENANT-09 §5.1)', () => {
  it('a Write creating a non-protected doc whose content quotes the protected path verbatim is upheld when the call carries create evidence', () => {
    // The false-positive class: consulting the args mention traversal for a mutating call
    // that carries its own fileChange blocks a document merely quoting the protected path.
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
    // The same case for the modify kind: an evidence branch implemented for `create` only —
    // a `post`-presence check standing in for the kind switch — drops modify-shaped calls back
    // to the args traversal.
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
    // Args are not consulted when evidence is present. The args deliberately carry the
    // protected path in the target slot AND quote it in the content slot, so any residual args
    // consultation on the evidence branch — a defensive "also scan args" clause, judging args
    // first, or unioning the two verdicts — breaks this call. Only a judge reading the call's
    // own nested evidence alone upholds it.
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
    // The fixture the fallback cannot rescue: the args name only a non-protected path, so a
    // judge that drops the evidence branch upholds and fails open on true self-mod. The change
    // path folds the exact, absolute and descendant axes into the evidence side — an absolute
    // descendant of a relative protected entry defeats raw string equality, startsWith on the
    // relative entry, and whole-path comparison alike.
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
    // The call deliberately has NO args, so the evidence is the only signal and a judge that
    // still reads args sees nothing and upholds. An evidence comparison keyed on kinds
    // carrying `post` skips `delete` silently, and a protected-source deletion rides through
    // as unproven but mentionless.
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
    // `sub/protected-extra` must not match `sub/protected`: an evidence comparison built on
    // raw `includes()`/`startsWith` instead of the segment primitive over-blocks it.
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
    // A flat input-level evidence array lets any call's evidence stand in for an unproven
    // sibling. Evidence nests per call so that this is structurally impossible; gating the
    // fallback on input-level presence — `if (allFileChanges(input).length > 0)` around the
    // whole judgment — lets call B ride call A's evidence past the gate.
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
    // The git adapter's one evidence-free non-deletion shape: a binary staged change ships no
    // fileChange, and its args carry the bare path with no content body. A fallback keyed on
    // content-like slots (`content`/`new_string`) rather than the full args traversal lets
    // every binary change to a protected path ride through unjudged.
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
    // Element shapes are an intentionally unvalidated boundary — core's parse checks only the
    // collection shapes — so a fileChange without a string `path` reaches this judge. An
    // unguarded `fileChange.path` read throws a TypeError out of a pure judge, which a direct
    // consumer reads as non-blocking; counting the malformed element as proof upholds a call
    // the judge cannot actually judge.
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
    // '' and '.' pass a bare string check and match no protected entry, since pathSegments
    // yields zero segments for them. Entering the evidence branch on any string path then
    // suppresses the fallback and upholds a Write whose args named the protected path.
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
    // The same unvalidated boundary admits a one-field stub {path} or a bogus discriminant.
    // Gating the evidence branch on `fileChange.path` alone lets an untrusted producer
    // suppress the conservative fallback with a single junk field.
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
    // The Bash axis belongs to shell-mod. Hoisting the evidence comparison out of the
    // per-call mutating-tool check into an input-level scan breaks on every input carrying
    // protected evidence regardless of tool name, pre-empting the shell allowlist.
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

describe('self-mod E2E through dispatchCovenants (COVENANT-03 §5.3)', () => {
  let dir: string;
  let telemetryPath: string;
  const TEST_VAR = 'PDKS_TEST_SELF_MOD_E2E_HATCH_VAR';

  /** The shipped builder, relabelled so each case can name its registration. */
  function selfModReg(
    label: string,
    witness?: (input: CovenantInput) => boolean,
  ): CovenantRegistration {
    return {
      ...selfModRegistration({
        protectedPaths: [PROTECTED],
        mutatingToolNames: ['Edit', 'Write', 'MultiEdit'],
        ...(witness ? { witness } : {}),
      }),
      label,
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
    // Covers the dispatcher spawning the compiled body at all, and the break verdict
    // reaching the blocking exit code 2.
    const input = inputWithToolCall('Edit', {
      file_path: PROTECTED,
      old_string: 'a',
      new_string: 'b',
    });
    const reg = selfModReg('self-mod');

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
    // Covers the dispatcher's routing and the judge's break condition disagreeing.
    const input = inputWithToolCall('Edit', { file_path: 'sub/unrelated/other.txt' });
    const reg = selfModReg('self-mod');

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(telemetryPath)).toBe(false);
  });

  it("witness with the env var set relaxes the body's break: exitCode 0, one witnessed record, subject=protected path", async () => {
    // The witness relaxes the judge's block and must be measured, not silently passed:
    // recording it as `passed` loses the distinction between a clean call and one a human
    // opened in person.
    process.env[TEST_VAR] = 'set';
    const input = inputWithToolCall('Edit', {
      file_path: PROTECTED,
      old_string: 'a',
      new_string: 'b',
    });
    // The valve is an inline predicate, not a shipped one: what this pins is the dispatcher
    // wiring a registration's witness and recording `witnessed`, so any predicate answering
    // true exercises it.
    const reg = selfModReg('self-mod', () => process.env[TEST_VAR] === 'set');

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
