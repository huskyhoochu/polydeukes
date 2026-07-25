import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// CORE-06 §4.2 / AC 4 — the session adapter tags its evidence with the union
// (pre === null → create, else modify) and attaches it to the one mutating tool-call
// element of the dispatched IR, not to a top-level array. Today collectFileChanges
// emits the flat {path, pre, post} shape and runAdapterPath ships it at the top level,
// so this file is RED by construction.
import { collectFileChanges, type DispatchOutcome, runAdapterPath } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures — realistic Claude Code PreToolUse payloads (snake_case), following
// file-changes.test.ts conventions. Claude vocabulary stays in this package.
// ---------------------------------------------------------------------------

const writePayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  tool_name: 'Write',
  tool_input: { file_path: 'src/new-file.ts', content: 'export const x = 1;' },
};

/** A reader returning a fixed pre-state for the expected file, null otherwise. */
function readerFor(filePath: string, content: string | null): (fp: string) => string | null {
  return (fp: string) => (fp === filePath ? content : null);
}

// ===========================================================================
// AC 4 — collectFileChanges tags the union (injected reader, no disk)
// ===========================================================================

describe('collectFileChanges — union tagging (AC 4)', () => {
  it('tags a Write with no pre-state (reader returns null) as kind create with no pre field', () => {
    // P0 tagging: absence of a file IS the create discriminant. Mutation caught: the flat
    // shape kept (no kind — downstream switches cannot judge), or a leftover pre:null
    // sentinel riding the create variant (toEqual rejects a defined null field).
    const changes = collectFileChanges(writePayload, () => null);

    expect(changes).toEqual([
      { kind: 'create', path: 'src/new-file.ts', post: 'export const x = 1;' },
    ]);
  });

  it('tags a Write over existing content as kind modify carrying both the pre and the post', () => {
    // P0 tagging boundary partner: a real pre-state makes the SAME payload a modify — the
    // discriminant is the evidence, not the tool. Mutation caught: existing content tagged
    // create (an immutable discipline would uphold an overwrite as first authoring), or
    // pre/post swapped.
    const changes = collectFileChanges(
      writePayload,
      readerFor('src/new-file.ts', 'export const seed = 1;'),
    );

    expect(changes).toEqual([
      {
        kind: 'modify',
        path: 'src/new-file.ts',
        pre: 'export const seed = 1;',
        post: 'export const x = 1;',
      },
    ]);
  });
});

// ===========================================================================
// AC 4 — runAdapterPath nests the evidence on the tool-call element of the
// dispatched IR (real disk pre-state via a temp dir, captured dispatch seam —
// following the file-changes.test.ts integration conventions).
// ===========================================================================

let tmpRoot: string;
let telemetryPath: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pdks-adapter-fcu-'));
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

describe('runAdapterPath — evidence nested on the tool-call element (AC 4)', () => {
  it('an Edit payload dispatches an IR whose toolCalls[0].fileChange is the modify evidence', async () => {
    // P0 attribution wiring: the IR handed to dispatch carries the evidence INSIDE the
    // mutating call element, and the removed top-level home is gone. Mutation caught:
    // evidence still shipped as a top-level fileChanges array (a covenant reading the
    // nested position would see an unproven call — the fail-open channel), or the modify
    // tagged create despite a real disk pre-state.
    const filePath = join(tmpRoot, 'app.ts');
    writeFileSync(filePath, 'const v = alpha;');
    const payload = {
      hook_event_name: 'PreToolUse',
      session_id: 's-1',
      transcript_path: '/tmp/t.jsonl',
      cwd: tmpRoot,
      tool_name: 'Edit',
      tool_input: { file_path: filePath, old_string: 'alpha', new_string: 'beta' },
    };
    const { dispatch, calls } = capturingDispatch();

    await runAdapterPath({ rawPayload: JSON.stringify(payload), telemetryPath, dispatch });

    expect(calls).toHaveLength(1);
    const parsed = parseInput(calls[0]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok !== true) return;
    expect(parsed.value.toolCalls).toHaveLength(1);
    expect(parsed.value.toolCalls[0].fileChange).toEqual({
      kind: 'modify',
      path: filePath,
      pre: 'const v = alpha;',
      post: 'const v = beta;',
    });
    expect('fileChanges' in parsed.value).toBe(false);
  });
});
