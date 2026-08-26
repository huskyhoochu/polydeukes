import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectFileChanges } from '../src/file-changes.ts';
import type { DispatchOutcome } from '../src/index.ts';
import { runAdapterPath } from '../src/index.ts';

// Realistic Claude Code PreToolUse payloads (snake_case). Claude vocabulary
// (old_string / new_string) lives here and in the adapter, never in core.

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

describe('collectFileChanges — Write', () => {
  it('produces create evidence for a new file (reader returns null)', () => {
    // Absence of a file is the create discriminant. Tagging it modify opens a
    // debt-forgiveness hole downstream.
    const change = collectFileChanges(writePayload, () => null);

    expect(change).toEqual({
      kind: 'create',
      path: 'src/new-file.ts',
      post: 'export const x = 1;',
    });
  });
});

describe('collectFileChanges — MultiEdit', () => {
  it('applies edits sequentially so the post reflects all edits', () => {
    // The 2nd edit targets the 1st edit's result, so edits applied against pre
    // independently would yield 'value = two'.
    const change = collectFileChanges(multiEditPayload, readerFor('src/seq.ts', 'value = one'));

    expect(change).toEqual({
      kind: 'modify',
      path: 'src/seq.ts',
      pre: 'value = one',
      post: 'value = three',
    });
  });
});

describe('collectFileChanges — omission of unresolvable post-state', () => {
  it('yields nothing when the Edit old_string is absent from pre (null, not an error)', () => {
    // An Edit whose virtual application fails omits evidence — it is neither an error
    // nor a fabricated post.
    const change = collectFileChanges(editPayload, readerFor('src/app.ts', 'no match here'));

    expect(change).toBeNull();
  });
});

describe('collectFileChanges — non-mutating payloads', () => {
  it('returns null for a Bash payload', () => {
    // A non-file-mutating tool contributes no evidence — there is no file to judge.
    expect(collectFileChanges(bashPayload, () => null)).toBeNull();
  });
});

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

describe('runAdapterPath — fileChanges in the dispatched IR', () => {
  it('an Edit payload hands dispatch an IR whose evidence carries the disk pre and applied post', async () => {
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
    expect(parsed.value.toolCalls[0].fileChange).toEqual({
      kind: 'modify',
      path: filePath,
      pre: 'const v = alpha;',
      post: 'const v = beta;',
    });
  });

  it('a Bash payload hands dispatch an IR whose call carries no fileChange key (no fabrication)', async () => {
    // Absence of the key is what marks the call unproven; always assigning evidence
    // would let a judge read an unproven call as a proven one.
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
    expect('fileChange' in parsed.value.toolCalls[0]).toBe(false);
  });

  it('a Write to a nonexistent path dispatches create evidence (ENOENT survives as absence)', async () => {
    // ENOENT is the one read failure that legitimately means "no file yet", so the
    // evidence must still be emitted; a broader fail-closed read check would block
    // real creations.
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
    expect(parsed.value.toolCalls[0].fileChange).toEqual({
      kind: 'create',
      path: filePath,
      post: 'export const x = 1;',
    });
  });

  it('a pre-state read failure that is not absence blocks (exit 2, one adapter blocked row, no dispatch)', async () => {
    // A read error other than ENOENT must not masquerade as pre=null: a Write over an
    // existing-but-unreadable file would otherwise carry creation evidence and let an
    // immutable discipline uphold the overwrite. A directory target raises EISDIR
    // deterministically without chmod tricks.
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
