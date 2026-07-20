import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// COVENANT-10 §4.3 / AC §5.6 — the adapter computes fileChanges from a raw PreToolUse
// payload. `collectFileChanges(rawPayload, readPreState)` reads pre-state via an injected
// reader (no disk in unit tests) and computes post via virtualPostState; unresolvable
// post-states are OMITTED (the specified disposition), and non-mutating payloads yield [].
// The file-changes module does not exist yet, so this file is RED by construction.
import { collectFileChanges } from '../src/file-changes.ts';
import type { DispatchOutcome } from '../src/index.ts';
import { runAdapterPath } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures — realistic Claude Code PreToolUse payloads (snake_case, PRD §4.1).
// Claude vocabulary (old_string / new_string) lives here and in the adapter, never core.
// ---------------------------------------------------------------------------

const editPayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  tool_name: 'Edit',
  tool_input: { file_path: 'src/app.ts', old_string: 'alpha', new_string: 'beta' },
};

const writePayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  tool_name: 'Write',
  tool_input: { file_path: 'src/new-file.ts', content: 'export const x = 1;' },
};

const multiEditPayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  tool_name: 'MultiEdit',
  tool_input: {
    file_path: 'src/seq.ts',
    edits: [
      { old_string: 'one', new_string: 'two' },
      { old_string: 'two', new_string: 'three' },
    ],
  },
};

const bashPayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  tool_name: 'Bash',
  tool_input: { command: 'rm -rf /tmp/x' },
};

/** A reader returning a fixed pre-state for the expected file, null otherwise. */
function readerFor(filePath: string, content: string | null): (fp: string) => string | null {
  return (fp: string) => (fp === filePath ? content : null);
}

// ===========================================================================
// AC §5.6 — collectFileChanges per-tool computation (injected reader, no disk)
// ===========================================================================

describe('collectFileChanges — Write (AC §5.6)', () => {
  it('produces a FileChange with pre=null for a new file (reader returns null)', () => {
    // P0 creation: Write to a non-existent file has pre=null and post=content. Mutation
    // caught: pre=null coerced to '' (a debt-forgiveness hole downstream), or content dropped.
    const changes = collectFileChanges(writePayload, () => null);

    expect(changes).toEqual([{ path: 'src/new-file.ts', pre: null, post: 'export const x = 1;' }]);
  });
});

describe('collectFileChanges — MultiEdit (AC §5.6)', () => {
  it('applies edits sequentially so the post reflects all edits', () => {
    // P0 sequential application: the 2nd edit targets the 1st edit's result. Mutation caught:
    // edits applied against pre independently (post would be 'value = two', not 'three').
    const changes = collectFileChanges(multiEditPayload, readerFor('src/seq.ts', 'value = one'));

    expect(changes).toEqual([{ path: 'src/seq.ts', pre: 'value = one', post: 'value = three' }]);
  });
});

describe('collectFileChanges — omission of unresolvable post-state (AC §5.6, PRD §4.3)', () => {
  it('omits the element when the Edit old_string is absent from pre (empty array, not an error)', () => {
    // P0 specified disposition (PRD §4.3): an Edit whose virtual application fails is OMITTED,
    // not surfaced as an error and not fabricated with a bogus post. Mutation caught: the
    // element pushed with a wrong/undefined post, or the whole call throwing on a failed apply.
    const changes = collectFileChanges(editPayload, readerFor('src/app.ts', 'no match here'));

    expect(changes).toEqual([]);
  });
});

describe('collectFileChanges — non-mutating payloads (AC §5.6)', () => {
  it('returns an empty array for a Bash payload', () => {
    // P0: a non-file-mutating tool contributes no fileChanges. Mutation caught: a default
    // branch fabricating a FileChange for a Bash command (there is no file to judge).
    expect(collectFileChanges(bashPayload, () => null)).toEqual([]);
  });
});

// ===========================================================================
// AC §5.6 — runAdapterPath integration: the IR handed to dispatch carries fileChanges
// (real disk pre-state via a temp dir, following run-adapter-path.test.ts conventions)
// ===========================================================================

let tmpRoot: string;
let telemetryPath: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pdks-adapter-fc-'));
  telemetryPath = join(tmpRoot, 'telemetry.tsv');
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

/** Capture the raw stdin string handed to the injected dispatch seam. */
function capturingDispatch(): {
  dispatch: (stdinPayload: string) => Promise<DispatchOutcome>;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    dispatch: async (stdinPayload: string) => {
      calls.push(stdinPayload);
      return { exitCode: 0, results: [] };
    },
  };
}

describe('runAdapterPath — fileChanges in the dispatched IR (AC §5.6)', () => {
  it('an Edit payload hands dispatch an IR whose fileChanges carries the disk pre and applied post', async () => {
    // P0 end-to-end: runAdapterPath reads real pre-state from disk and the IR it forwards to
    // dispatch carries the computed fileChanges. Mutation caught: fileChanges never wired into
    // the IR (a discipline would see no evidence), or pre read as the post-applied content.
    const filePath = join(tmpRoot, 'app.ts');
    writeFileSync(filePath, 'const v = alpha;');
    const payload = {
      ...editPayload,
      cwd: tmpRoot,
      tool_input: { file_path: filePath, old_string: 'alpha', new_string: 'beta' },
    };
    const { dispatch, calls } = capturingDispatch();

    await runAdapterPath({ rawPayload: JSON.stringify(payload), telemetryPath, dispatch });

    expect(calls).toHaveLength(1);
    const parsed = parseInput(calls[0]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok !== true) return;
    expect(parsed.value.fileChanges).toEqual([
      { path: filePath, pre: 'const v = alpha;', post: 'const v = beta;' },
    ]);
  });

  it('a Bash payload hands dispatch an IR with no fileChanges key (no fabrication when empty)', async () => {
    // P0 no-fabrication (mirrors core CORE-04 precedent): a non-mutating payload must not
    // carry a fabricated fileChanges key — the IR is indistinguishable from a legacy one.
    // Mutation caught: the adapter always assigning fileChanges (even []), which core would
    // then preserve as an explicit empty array rather than absence.
    const { dispatch, calls } = capturingDispatch();

    await runAdapterPath({
      rawPayload: JSON.stringify(bashPayload),
      telemetryPath,
      dispatch,
    });

    expect(calls).toHaveLength(1);
    const parsed = parseInput(calls[0]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok !== true) return;
    expect('fileChanges' in parsed.value).toBe(false);
  });

  it('a Write to a nonexistent path dispatches creation evidence (pre=null survives the ENOENT branch)', async () => {
    // P0 absence semantics: ENOENT is the ONE read failure that legitimately means
    // "no file yet" — the fileChange must still be emitted with pre=null. Mutation
    // caught: the fail-closed read guard over-reaching and blocking real creations.
    const filePath = join(tmpRoot, 'brand-new.ts');
    const payload = {
      ...writePayload,
      cwd: tmpRoot,
      tool_input: { file_path: filePath, content: 'export const x = 1;' },
    };
    const { dispatch, calls } = capturingDispatch();

    const { exitCode } = await runAdapterPath({
      rawPayload: JSON.stringify(payload),
      telemetryPath,
      dispatch,
    });

    expect(exitCode).toBe(0);
    expect(calls).toHaveLength(1);
    const parsed = parseInput(calls[0]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok !== true) return;
    expect(parsed.value.fileChanges).toEqual([
      { path: filePath, pre: null, post: 'export const x = 1;' },
    ]);
  });

  it('a pre-state read failure that is not absence blocks (exit 2, one adapter blocked row, no dispatch)', async () => {
    // P0 fail-closed (PR #23 review, CONFIRMED): a read error other than ENOENT must
    // not masquerade as pre=null — a Write over an existing-but-unreadable file would
    // otherwise carry creation evidence and let an immutable discipline uphold the
    // overwrite. A directory target raises EISDIR deterministically without chmod tricks.
    const payload = {
      ...writePayload,
      cwd: tmpRoot,
      tool_input: { file_path: tmpRoot, content: 'overwrite attempt' },
    };
    const { dispatch, calls } = capturingDispatch();

    const { exitCode } = await runAdapterPath({
      rawPayload: JSON.stringify(payload),
      telemetryPath,
      dispatch,
    });

    expect(exitCode).toBe(2);
    expect(calls).toHaveLength(0);
    const lines = readFileSync(telemetryPath, 'utf-8')
      .split('\n')
      .filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('blocked');
  });
});
