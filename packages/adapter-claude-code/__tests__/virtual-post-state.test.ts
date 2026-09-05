import { normalizeProtectedPaths } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import { type VirtualPostState, virtualPostState } from '../src/virtual-post-state.ts';

// Realistic Claude Code PreToolUse hook payloads (snake_case). Claude vocabulary
// (old_string / new_string / replace_all) lives here and in the adapter, never in core.

const writePayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  tool_name: 'Write',
  tool_input: { file_path: 'src/new-file.ts', content: 'export const x = 1;' },
};

const editPayload = {
  hook_event_name: 'PreToolUse',
  session_id: 's-1',
  transcript_path: '/tmp/t.jsonl',
  cwd: '/repo',
  tool_name: 'Edit',
  tool_input: { file_path: 'src/app.ts', old_string: 'alpha', new_string: 'beta' },
};

function editPayloadWith(toolInput: Record<string, unknown>) {
  return { ...editPayload, tool_input: toolInput };
}

function multiEditPayload(filePath: string, edits: unknown[]) {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 's-1',
    transcript_path: '/tmp/t.jsonl',
    cwd: '/repo',
    tool_name: 'MultiEdit',
    tool_input: { file_path: filePath, edits },
  };
}

describe('per-tool post-state compute', () => {
  it('Write returns content verbatim and preserves file_path, even with preState null', () => {
    // Write must be independent of preState — it overwrites whatever was there.
    const result = virtualPostState(writePayload, null);

    expect(result).toEqual({
      ok: true,
      value: { filePath: 'src/new-file.ts', content: 'export const x = 1;' },
    });
  });

  it('Edit substitutes old_string with new_string and preserves file_path', () => {
    const result = virtualPostState(editPayload, 'const v = alpha;');

    expect(result).toEqual({
      ok: true,
      value: { filePath: 'src/app.ts', content: 'const v = beta;' },
    });
  });

  it('Edit with replace_all true replaces every occurrence', () => {
    // preState carries old_string twice, so a single replace leaves the second occurrence.
    const payload = editPayloadWith({
      file_path: 'src/app.ts',
      old_string: 'x',
      new_string: 'y',
      replace_all: true,
    });

    const result = virtualPostState(payload, 'x = x + 1');

    expect(result).toEqual({
      ok: true,
      value: { filePath: 'src/app.ts', content: 'y = y + 1' },
    });
  });

  it('Edit inserts new_string literally — $-replacement patterns are never expanded', () => {
    // String.prototype.replace/replaceAll interpret $-patterns ($&, $$, $') in the
    // replacement argument; the real Edit tool substitutes literally. Passing new_string
    // straight through as the replacement argument diverges from the tool and hands the
    // judge a wrong post-state, in both the false-pass and false-block directions.
    const single = virtualPostState(
      editPayloadWith({ file_path: 'src/app.ts', old_string: 'foo', new_string: '$&bar' }),
      'foo',
    );
    expect(single).toEqual({ ok: true, value: { filePath: 'src/app.ts', content: '$&bar' } });

    const all = virtualPostState(
      editPayloadWith({
        file_path: 'src/app.ts',
        old_string: 'x',
        new_string: '$$',
        replace_all: true,
      }),
      'x and x',
    );
    expect(all).toEqual({ ok: true, value: { filePath: 'src/app.ts', content: '$$ and $$' } });
  });

  it('MultiEdit applies edits sequentially — the 2nd edit targets the 1st edit result', () => {
    // The 2nd edit's old_string ('two') only exists AFTER the 1st edit turns 'one' into
    // 'two'. An order-ignoring or parallel implementation cannot produce 'three'.
    const payload = multiEditPayload('src/seq.ts', [
      { old_string: 'one', new_string: 'two' },
      { old_string: 'two', new_string: 'three' },
    ]);

    const result = virtualPostState(payload, 'value = one');

    expect(result).toEqual({
      ok: true,
      value: { filePath: 'src/seq.ts', content: 'value = three' },
    });
  });
});

describe('MultiEdit file-creation convention (real-tool parity)', () => {
  it('MultiEdit with preState null and an empty first old_string creates the file', () => {
    // The real MultiEdit tool accepts this shape as file creation: the first edit's
    // empty old_string seeds the content, subsequent edits apply sequentially. A blanket
    // preState-null rejection would falsely block a payload the tool accepts.
    const payload = multiEditPayload('src/created.ts', [
      { old_string: '', new_string: 'const a = 1;' },
      { old_string: 'a', new_string: 'b' },
    ]);

    const result = virtualPostState(payload, null);

    expect(result).toEqual({
      ok: true,
      value: { filePath: 'src/created.ts', content: 'const b = 1;' },
    });
  });

  it('MultiEdit with preState null and a non-empty first old_string still fails closed', () => {
    // The creation convention must not widen into accepting any null-preState MultiEdit,
    // which would fabricate a post-state with no file to edit.
    const payload = multiEditPayload('src/created.ts', [{ old_string: 'a', new_string: 'b' }]);

    expect(virtualPostState(payload, null).ok).toBe(false);
  });

  it('an empty old_string in a non-first edit or with a non-null preState still fails closed', () => {
    // An empty old_string is legal only in the first edit of a creating MultiEdit.
    const nonFirst = multiEditPayload('src/seq.ts', [
      { old_string: 'one', new_string: 'two' },
      { old_string: '', new_string: 'three' },
    ]);
    const withPreState = multiEditPayload('src/seq.ts', [{ old_string: '', new_string: 'seed' }]);

    expect(virtualPostState(nonFirst, 'value = one').ok).toBe(false);
    expect(virtualPostState(withPreState, 'existing').ok).toBe(false);
  });
});

describe('fail-closed axis (security boundary — cannot classify = fail, never throws)', () => {
  it('non-object payloads fail closed without throwing', () => {
    // A hostile payload must never reach ok:true, and a throw escaping the function
    // would break the fail-closed guarantee just as surely.
    for (const hostile of ['a string', null, [], 42]) {
      let result: VirtualPostState | undefined;
      expect(() => {
        result = virtualPostState(hostile, 'pre');
      }).not.toThrow();
      expect(result?.ok).toBe(false);
    }
  });

  it('payload missing tool_name fails closed', () => {
    const result = virtualPostState({ tool_input: { file_path: 'src/app.ts' } }, 'pre');

    expect(result.ok).toBe(false);
  });

  it('payload missing tool_input fails closed', () => {
    // Missing tool_input must fail rather than default to {}.
    const result = virtualPostState({ tool_name: 'Edit' }, 'pre');

    expect(result.ok).toBe(false);
  });

  it('Edit with preState null fails closed', () => {
    // An Edit with no prior content has nothing to substitute into; succeeding would
    // fabricate a post-state.
    const result = virtualPostState(editPayload, null);

    expect(result.ok).toBe(false);
  });

  it('Edit failure modes each fail closed with distinguishable reasons', () => {
    // Zero occurrences, multiple occurrences, old === new, and an empty old_string are
    // four separate causes; collapsing them into one message destroys the diagnostic.
    const zeroOccurrence = virtualPostState(
      editPayloadWith({ file_path: 'src/app.ts', old_string: 'absent', new_string: 'z' }),
      'nothing matches here',
    );
    const multiOccurrence = virtualPostState(
      editPayloadWith({ file_path: 'src/app.ts', old_string: 'dup', new_string: 'z' }),
      'dup and dup again',
    );
    const oldEqualsNew = virtualPostState(
      editPayloadWith({ file_path: 'src/app.ts', old_string: 'same', new_string: 'same' }),
      'same here',
    );
    const emptyOld = virtualPostState(
      editPayloadWith({ file_path: 'src/app.ts', old_string: '', new_string: 'z' }),
      'anything',
    );

    for (const r of [zeroOccurrence, multiOccurrence, oldEqualsNew, emptyOld]) {
      expect(r.ok).toBe(false);
    }

    const reasons = [zeroOccurrence, multiOccurrence, oldEqualsNew, emptyOld].map((r) =>
      r.ok === false ? r.reason : '',
    );
    expect(new Set(reasons).size).toBe(4);
  });

  it('Edit with a non-boolean replace_all fails closed (no loose truthy interpretation)', () => {
    // replace_all is checked for the boolean type, not for truthiness — the string
    // 'true' is a malformed payload, not a request to replace everywhere.
    const payload = editPayloadWith({
      file_path: 'src/app.ts',
      old_string: 'x',
      new_string: 'y',
      replace_all: 'true',
    });

    const result = virtualPostState(payload, 'x = x');

    expect(result.ok).toBe(false);
  });

  it('MultiEdit with an empty edits array fails closed', () => {
    // An empty edits array would otherwise produce an ok post-state equal to preState.
    const result = virtualPostState(multiEditPayload('src/seq.ts', []), 'value = one');

    expect(result.ok).toBe(false);
  });

  it('MultiEdit whose middle edit fails fails the whole call with no partial content', () => {
    // The real tool applies MultiEdit atomically, so a partial result would describe a
    // file state that never exists. The 2nd edit's old_string is absent from the 1st
    // edit's result, and no intermediate content may appear anywhere in the result.
    const payload = multiEditPayload('src/seq.ts', [
      { old_string: 'one', new_string: 'two' },
      { old_string: 'missing', new_string: 'three' },
    ]);

    const result = virtualPostState(payload, 'value = one');

    expect(result.ok).toBe(false);
    // 'value = two' is the intermediate; it must not leak into any field of the result.
    expect(JSON.stringify(result)).not.toContain('two');
  });

  it('a non-edit tool (Bash) fails closed', () => {
    // Unknown tools have no computable post-state, so the default branch must not be ok.
    const bashPayload = {
      hook_event_name: 'PreToolUse',
      session_id: 's-1',
      transcript_path: '/tmp/t.jsonl',
      cwd: '/repo',
      tool_name: 'Bash',
      tool_input: { command: 'rm -rf /' },
    };

    const result = virtualPostState(bashPayload, 'pre');

    expect(result.ok).toBe(false);
  });
});

describe('core sufficiency — post-state alone judges a protectedPaths covenant', () => {
  // This test covenant imports ONLY @polydeukes/core — never the adapter's internals or
  // Claude vocabulary — so it proves all judgment-relevant evidence already lives inside
  // the { filePath, content } output. normalizeProtectedPaths only normalizes path strings
  // (trim, strip './', strip a trailing '/') and expands no globs, which is why the
  // covenant below prefix-matches on the segment before a trailing '/**'.

  const PROTECTED_SPEC = { protectedPaths: ['./src/**'] };

  function upholdProtectedPath(
    output: { filePath: string; content: string },
    spec: { protectedPaths?: string[] },
  ): { upheld: boolean } {
    const normalized = normalizeProtectedPaths(spec);
    const editsProtected = normalized.some((entry) => {
      const prefix = entry.replace(/\/\*\*$/, '');
      return output.filePath.startsWith(prefix);
    });
    return { upheld: !editsProtected };
  }

  it('a protected-path post-state is NOT upheld', () => {
    const result = virtualPostState(writePayload, null); // file_path 'src/new-file.ts'
    expect(result.ok).toBe(true);
    if (result.ok !== true) return;

    const verdict = upholdProtectedPath(result.value, PROTECTED_SPEC);

    expect(verdict).toEqual({ upheld: false });
  });

  it('an unprotected-path post-state IS upheld', () => {
    const unprotectedWrite = {
      ...writePayload,
      tool_input: { file_path: 'docs/readme.md', content: '# hi' },
    };
    const result = virtualPostState(unprotectedWrite, null);
    expect(result.ok).toBe(true);
    if (result.ok !== true) return;

    const verdict = upholdProtectedPath(result.value, PROTECTED_SPEC);

    expect(verdict).toEqual({ upheld: true });
  });
});
