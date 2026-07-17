import { normalizeProtectedPaths } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// ADAPTER-02. Import from the not-yet-existing implementation module — module-not-found
// is the expected RED failure on first run.
import { type VirtualPostState, virtualPostState } from '../src/virtual-post-state.js';

// ---------------------------------------------------------------------------
// Fixtures — realistic Claude Code PreToolUse hook payloads (snake_case, PRD §4.1).
// Claude vocabulary (old_string / new_string / replace_all) lives in this test file
// and in the adapter — never in core.
// ---------------------------------------------------------------------------

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

// -- Helpers to keep only the varying axis explicit in each test --------------

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

describe('§4.1 per-tool post-state compute', () => {
  it('Write returns content verbatim and preserves file_path, even with preState null', () => {
    // Mutation caught: content replaced by preState, file_path dropped, or the preState-null
    // path made to fail (Write must be independent of preState per PRD §3.2).
    const result = virtualPostState(writePayload, null);

    expect(result).toEqual({
      ok: true,
      value: { filePath: 'src/new-file.ts', content: 'export const x = 1;' },
    });
  });

  it('Edit substitutes old_string with new_string and preserves file_path', () => {
    // Mutation caught: substitution direction reversed (new->old), file_path dropped, or
    // the replacement not applied at all (post-state === preState).
    const result = virtualPostState(editPayload, 'const v = alpha;');

    expect(result).toEqual({
      ok: true,
      value: { filePath: 'src/app.ts', content: 'const v = beta;' },
    });
  });

  it('Edit with replace_all true replaces every occurrence', () => {
    // Mutation caught: replace_all ignored (only first replaced), or replaceAll downgraded
    // to a single replace. preState has old_string twice.
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

  it('MultiEdit applies edits sequentially — the 2nd edit targets the 1st edit result', () => {
    // The 2nd edit's old_string ('two') only exists AFTER the 1st edit turns 'one' into
    // 'two'. An order-ignoring / parallel implementation cannot produce 'three' and fails.
    // Mutation caught: edits applied against preState independently, or applied in reverse
    // order.
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

describe('§4.2 fail-closed axis (security boundary — cannot classify = fail, never throws)', () => {
  it('non-object payloads fail closed without throwing', () => {
    // Mutation caught: a typeof / Array.isArray guard removed, letting a hostile payload
    // through as ok:true, or an unhandled throw escaping the function.
    for (const hostile of ['a string', null, [], 42]) {
      let result: VirtualPostState | undefined;
      expect(() => {
        result = virtualPostState(hostile, 'pre');
      }).not.toThrow();
      expect(result?.ok).toBe(false);
    }
  });

  it('payload missing tool_name fails closed', () => {
    // Mutation caught: tool_name presence check dropped.
    const result = virtualPostState({ tool_input: { file_path: 'src/app.ts' } }, 'pre');

    expect(result.ok).toBe(false);
  });

  it('payload missing tool_input fails closed', () => {
    // Mutation caught: tool_input presence check dropped, defaulting to {}.
    const result = virtualPostState({ tool_name: 'Edit' }, 'pre');

    expect(result.ok).toBe(false);
  });

  it('Edit with preState null fails closed', () => {
    // Mutation caught: the preState !== null precondition removed for Edit — an Edit with no
    // prior content cannot be substituted, and silently succeeding would fabricate a
    // post-state (PRD §3.2).
    const result = virtualPostState(editPayload, null);

    expect(result.ok).toBe(false);
  });

  it('Edit failure modes each fail closed with distinguishable reasons', () => {
    // Four distinct rejection causes (PRD §4.2) must produce four distinct reason strings so
    // the diagnostic is not collapsed into one generic message.
    // Mutation caught: any one of the four preconditions removed (making that input succeed),
    // or all reasons collapsed to a single constant.
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
    // All four reasons must be pairwise distinct.
    expect(new Set(reasons).size).toBe(4);
  });

  it('Edit with a non-boolean replace_all fails closed (no loose truthy interpretation)', () => {
    // Mutation caught: replace_all coerced with a truthy check instead of a strict boolean
    // type check (PRD §3.2 forbids loose truthy interpretation).
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
    // Mutation caught: the non-empty edits precondition removed, letting a no-op MultiEdit
    // masquerade as an ok post-state equal to preState.
    const result = virtualPostState(multiEditPayload('src/seq.ts', []), 'value = one');

    expect(result.ok).toBe(false);
  });

  it('MultiEdit whose middle edit fails fails the whole call with no partial content', () => {
    // A partial-application result would be a "no change" disguise (PRD §6). The 2nd edit's
    // old_string is absent from the 1st edit result, so the whole call must fail — and no
    // intermediate content may appear anywhere in the result.
    // Mutation caught: partial result emitted, or per-edit failure swallowed.
    const payload = multiEditPayload('src/seq.ts', [
      { old_string: 'one', new_string: 'two' },
      { old_string: 'missing', new_string: 'three' },
    ]);

    const result = virtualPostState(payload, 'value = one');

    expect(result.ok).toBe(false);
    // The partially-applied intermediate ('value = two') must not leak into any field.
    expect(JSON.stringify(result)).not.toContain('two');
  });

  it('a non-edit tool (Bash) fails closed', () => {
    // Mutation caught: a default branch that treats unknown tools as ok.
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

describe('§4.3 core sufficiency — post-state alone judges a protectedPaths covenant', () => {
  // This test covenant imports ONLY @polydeukes/core (normalizeProtectedPaths + its input
  // shape) — never the adapter's virtualPostState internals or Claude vocabulary — proving
  // all judgment-relevant evidence lives inside the { filePath, content } output.
  // normalizeProtectedPaths only normalizes path strings (trim / strip ./ / strip trailing
  // /); it performs no glob expansion, so the covenant does prefix matching on the segment
  // before a trailing '/**' glob (PRD §3.3, protected-paths semantics).

  const PROTECTED_SPEC = { protectedPaths: ['./src/**'], adapters: [] };

  function upholdProtectedPath(
    output: { filePath: string; content: string },
    spec: { protectedPaths?: string[]; adapters?: string[] },
  ): { upheld: boolean } {
    const normalized = normalizeProtectedPaths(spec);
    const editsProtected = normalized.some((entry) => {
      const prefix = entry.replace(/\/\*\*$/, '');
      return output.filePath.startsWith(prefix);
    });
    return { upheld: !editsProtected };
  }

  it('a protected-path post-state is NOT upheld', () => {
    // Mutation caught: the covenant's match inverted or dropped, always upholding.
    const result = virtualPostState(writePayload, null); // file_path 'src/new-file.ts'
    expect(result.ok).toBe(true);
    if (result.ok !== true) return;

    const verdict = upholdProtectedPath(result.value, PROTECTED_SPEC);

    expect(verdict).toEqual({ upheld: false });
  });

  it('an unprotected-path post-state IS upheld', () => {
    // Mutation caught: the prefix match widened to match everything.
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
