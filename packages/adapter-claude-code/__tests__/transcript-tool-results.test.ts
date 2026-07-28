import { describe, expect, it } from 'vitest';
// COVENANT-13b §4.2 / AC 3–6 — `transcriptFromJsonl` joins tool_result blocks back onto
// the tool_use blocks they answer, and reports the outcome as `TranscriptToolCall.succeeded`.
// Downstream only `succeeded === true` is precedent evidence, so this join is the whole
// difference between "the agent asked for this tool" and "this tool ran and worked".
// A result with is_error → false; a result without it → true; NO result → false (this
// provider CAN read the result channel, so silence is unproven success, not ignorance —
// `undefined` stays reserved for providers that cannot see results at all).
// The join does not exist yet, so every expectation naming `succeeded` is RED by construction.
import { transcriptFromJsonl } from '../src/transcript.ts';

// ---------------------------------------------------------------------------
// Fixtures — real transcript shapes. Tool names, call ids, and result prose are
// ecosystem values injected here, never source literals. Protected paths quoted inside
// the hook-error text use the repo's abbreviated notation (as the PRD itself does) so
// the fixture is not a mention the covenant then has to judge.
// ---------------------------------------------------------------------------

const SHELL_TOOL = 'Bash';
const READ_TOOL = 'Read';

/**
 * What a hook-blocked call really leaves behind: is_error true plus the hook's stderr.
 * The covenant blocked this call — it never ran.
 */
const HOOK_BLOCKED_CONTENT =
  'PreToolUse:Bash hook error: [node "$CLAUDE_PROJECT_DIR"/hooks/covenant-pretooluse.mjs]: sed mentions protected path covenant/src without read-only proof\n';

/** What a human rejection really leaves behind — the same is_error, entirely different prose. */
const USER_REJECTED_CONTENT =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.";

/** An assistant entry carrying tool_use blocks. */
function assistantEntry(uuid: string, blocks: unknown[]) {
  return {
    type: 'assistant',
    message: { role: 'assistant', content: blocks },
    timestamp: '2026-07-28T02:00:00.000Z',
    uuid,
  };
}

/** A user entry carrying tool_result blocks — where real transcripts put results. */
function resultEntry(uuid: string, blocks: unknown[]) {
  return {
    type: 'user',
    message: { role: 'user', content: blocks },
    timestamp: '2026-07-28T02:00:01.000Z',
    uuid,
  };
}

function useBlock(id: string, name: string, input: Record<string, unknown>) {
  return { type: 'tool_use', id, name, input };
}

/** A result that reports success: present, with no error marker at all. */
function okResult(id: string, content: string) {
  return { type: 'tool_result', tool_use_id: id, content };
}

/** A result that reports success explicitly — the flag is present and false. */
function explicitOkResult(id: string, content: string) {
  return { type: 'tool_result', tool_use_id: id, is_error: false, content };
}

/**
 * A failed result. Real transcripts emit the keys in BOTH orders, so the two error
 * builders deliberately disagree on where `is_error` sits relative to `content`.
 */
function errorResultFirst(id: string, content: string) {
  return { type: 'tool_result', tool_use_id: id, is_error: true, content };
}

function errorResultLast(id: string, content: string) {
  return { type: 'tool_result', tool_use_id: id, content, is_error: true };
}

/** Join entry objects as JSONL text (one JSON object per line). */
function toJsonl(entries: unknown[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join('\n');
}

// ===========================================================================
// AC 3 — a result with no error marker is a successful execution
// ===========================================================================

describe('COVENANT-13b §5.2(3) transcriptFromJsonl — a clean result marks the call succeeded', () => {
  it('reports succeeded true whether is_error is absent or explicitly false', () => {
    // P0 the gate must still be openable. If the join never finds a result, every call
    // collapses to succeeded false and NO amount of actually running the required tool
    // opens a context-family gate — the over-blocking failure that pushes people onto the
    // waiver. The second call pins the other end of the error-flag axis: `is_error: false`
    // is a REPORTED success, not an error. Mutation caught: the join never wired up; or the
    // outcome derived from key PRESENCE (`'is_error' in block`) instead of its value, which
    // turns every explicitly-successful call into a failure.
    const jsonl = toJsonl([
      assistantEntry('a-1', [
        useBlock('toolu_01', SHELL_TOOL, { command: 'npm view yaml version' }),
        useBlock('toolu_02', READ_TOOL, { file_path: '/repo/package.json' }),
      ]),
      resultEntry('u-1', [
        okResult('toolu_01', '4.0.6\n'),
        explicitOkResult('toolu_02', '{ "name": "polydeukes" }'),
      ]),
    ]);

    expect(transcriptFromJsonl(jsonl).findToolCalls()).toEqual([
      { name: SHELL_TOOL, args: { command: 'npm view yaml version' }, succeeded: true },
      { name: READ_TOOL, args: { file_path: '/repo/package.json' }, succeeded: true },
    ]);
  });
});

// ===========================================================================
// AC 4 — is_error true, in both real spellings, is not evidence
// ===========================================================================

describe('COVENANT-13b §5.2(4) transcriptFromJsonl — an errored result marks the call failed', () => {
  it('marks a call the covenant itself blocked as not succeeded, while its neighbour still succeeds', () => {
    // P0 THE fail-open this ticket exists to close: this repo's own transcript is full of
    // calls its hook refused, and the shipped judge counts every one of them as precedent —
    // a record of breaking one discipline becomes the key that opens another. The second
    // call is not decoration: without a successful neighbour this expectation would also
    // pass if the join were broken outright (absent result also yields false), and the test
    // would go green while verifying nothing. Mutation caught: is_error ignored, or read
    // from the wrong nesting level.
    const jsonl = toJsonl([
      assistantEntry('a-1', [
        useBlock('toolu_01', SHELL_TOOL, { command: 'sed -i s/a/b/ covenant/src/x.ts' }),
        useBlock('toolu_02', SHELL_TOOL, { command: 'npm view yaml version' }),
      ]),
      resultEntry('u-1', [
        errorResultFirst('toolu_01', HOOK_BLOCKED_CONTENT),
        okResult('toolu_02', '4.0.6\n'),
      ]),
    ]);

    expect(transcriptFromJsonl(jsonl).findToolCalls()).toEqual([
      { name: SHELL_TOOL, args: { command: 'sed -i s/a/b/ covenant/src/x.ts' }, succeeded: false },
      { name: SHELL_TOOL, args: { command: 'npm view yaml version' }, succeeded: true },
    ]);
  });

  it('marks a call the human rejected as not succeeded, reading the flag rather than the prose', () => {
    // P0 second real denial shape, and the reason it gets its own test: a hook block and a
    // human rejection carry the SAME is_error flag but completely different text. An
    // implementation that sniffs the message ("does the content mention a hook error?")
    // passes the sibling test above and fails here — and a rejected call is the one a human
    // most explicitly refused to let happen. This fixture also spells the result with
    // is_error AFTER content: key order is not stable in real transcripts, and any parse
    // that is not a JSON parse would flip on it. Successful neighbour again pins the branch.
    const jsonl = toJsonl([
      assistantEntry('a-1', [
        useBlock('toolu_01', SHELL_TOOL, { command: 'npm view yaml version' }),
        useBlock('toolu_02', SHELL_TOOL, { command: 'rm -rf pkg' }),
      ]),
      resultEntry('u-1', [
        okResult('toolu_01', '4.0.6\n'),
        errorResultLast('toolu_02', USER_REJECTED_CONTENT),
      ]),
    ]);

    expect(transcriptFromJsonl(jsonl).findToolCalls()).toEqual([
      { name: SHELL_TOOL, args: { command: 'npm view yaml version' }, succeeded: true },
      { name: SHELL_TOOL, args: { command: 'rm -rf pkg' }, succeeded: false },
    ]);
  });

  it('treats an error marker of an unexpected type as a failure, never as a clean result', () => {
    // P0 the only direction of shape mismatch that can ADD evidence, which §7 forbids. The
    // rule is written by enumerating success — absent, or exactly false — so everything else
    // fails; the tempting `is_error === true` spelling instead reads a string flag as "no
    // error present" and hands a denied call to the gate as precedent. The JSONL comes from
    // outside our contract, so its types are an assumption, not a guarantee: today every
    // marker in a real transcript is a boolean, and this test is what keeps that from
    // becoming load-bearing. The clean call pins the branch so a join that failed outright
    // cannot answer for this. Mutation caught: a truthiness test, or strict equality to true.
    const jsonl = toJsonl([
      assistantEntry('a-1', [
        useBlock('toolu_01', SHELL_TOOL, { command: 'npm view yaml version' }),
        useBlock('toolu_02', SHELL_TOOL, { command: 'npm view react version' }),
        useBlock('toolu_03', SHELL_TOOL, { command: 'npm view vue version' }),
      ]),
      resultEntry('u-1', [
        okResult('toolu_01', '4.0.6\n'),
        { type: 'tool_result', tool_use_id: 'toolu_02', is_error: 'true', content: 'denied' },
        { type: 'tool_result', tool_use_id: 'toolu_03', is_error: 1, content: 'denied' },
      ]),
    ]);

    expect(transcriptFromJsonl(jsonl).findToolCalls()).toEqual([
      { name: SHELL_TOOL, args: { command: 'npm view yaml version' }, succeeded: true },
      { name: SHELL_TOOL, args: { command: 'npm view react version' }, succeeded: false },
      { name: SHELL_TOOL, args: { command: 'npm view vue version' }, succeeded: false },
    ]);
  });
});

// ===========================================================================
// AC 5 — no result at all is unproven success, not unknown
// ===========================================================================

describe('COVENANT-13b §5.2(5) transcriptFromJsonl — a call with no result never counts', () => {
  it('marks a resultless call succeeded false — not undefined — beside a call that did report', () => {
    // P0 the in-flight call: the last tool_use in a live session has no result yet, and it
    // is the very call whose edit is being judged. `false` and `undefined` are both refused
    // downstream today, so the difference looks cosmetic — it is not. `undefined` means "this
    // provider cannot see results", and a later consumer that (rightly) declines to penalize
    // a provider that cannot tell would then wave every resultless call through. This
    // provider CAN see results; it looked and found none. `toEqual` distinguishes the two
    // (an undefined-valued key would fail against `succeeded: false`). The reported
    // neighbour pins the branch: without it a wholly broken join would also read false.
    const jsonl = toJsonl([
      assistantEntry('a-1', [
        useBlock('toolu_01', SHELL_TOOL, { command: 'npm view yaml version' }),
        useBlock('toolu_02', SHELL_TOOL, { command: 'npm view zod version' }),
      ]),
      resultEntry('u-1', [okResult('toolu_01', '4.0.6\n')]),
    ]);

    expect(transcriptFromJsonl(jsonl).findToolCalls()).toEqual([
      { name: SHELL_TOOL, args: { command: 'npm view yaml version' }, succeeded: true },
      { name: SHELL_TOOL, args: { command: 'npm view zod version' }, succeeded: false },
    ]);
  });
});

// ===========================================================================
// AC 3–5 — the join is by reference id, never by arrival order
// ===========================================================================

describe('COVENANT-13b §4.2 transcriptFromJsonl — results join on tool_use_id', () => {
  it('gives each call its own outcome when the results arrive in the opposite order', () => {
    // P0 the join key. Results interleave with prose, batches, and sidechains, so the nth
    // result is not the nth call. An implementation that zips the two lists positionally
    // passes every fixture where results happen to arrive in call order — including the
    // ones above — and here hands the blocked call's failure to the successful one and vice
    // versa. That is a fail-open in one direction (a blocked call reported as succeeded) and
    // an over-block in the other, from the same mutation. Mutation caught: positional zip,
    // or a join that matches on the first result regardless of tool_use_id.
    const jsonl = toJsonl([
      assistantEntry('a-1', [useBlock('toolu_01', SHELL_TOOL, { command: 'npm view yaml' })]),
      assistantEntry('a-2', [useBlock('toolu_02', SHELL_TOOL, { command: 'sed -i s/a/b/ x.ts' })]),
      resultEntry('u-1', [errorResultFirst('toolu_02', HOOK_BLOCKED_CONTENT)]),
      resultEntry('u-2', [okResult('toolu_01', '4.0.6\n')]),
    ]);

    expect(transcriptFromJsonl(jsonl).findToolCalls()).toEqual([
      { name: SHELL_TOOL, args: { command: 'npm view yaml' }, succeeded: true },
      { name: SHELL_TOOL, args: { command: 'sed -i s/a/b/ x.ts' }, succeeded: false },
    ]);
  });
});

// ===========================================================================
// AC 6 — a malformed result block disturbs nothing but itself
// ===========================================================================

describe('COVENANT-13b §5.2(6) transcriptFromJsonl — malformed result blocks are skipped alone', () => {
  it('keeps every other join intact when a result has a non-string id or a broken entry shape', () => {
    // P0 ADAPTER-04 robustness, inherited: shape mismatch excludes that item only, and
    // every failure reduces evidence rather than throwing. Three malformations ride along —
    // a numeric tool_use_id, a result block missing its reference entirely, and a user entry
    // whose content is a plain string (an ordinary human message, the most common entry in
    // the file). Mutation caught: any of them throwing (which blanks the transcript and
    // blocks the session), aborting the scan so later results are never seen, or a numeric
    // id coerced into matching the string id of an unrelated call.
    const jsonl = toJsonl([
      assistantEntry('a-1', [
        useBlock('toolu_01', SHELL_TOOL, { command: 'npm view yaml version' }),
        useBlock('toolu_02', SHELL_TOOL, { command: 'npm view zod version' }),
      ]),
      { type: 'user', message: { role: 'user', content: 'carry on' }, uuid: 'u-human' },
      resultEntry('u-1', [
        { type: 'tool_result', tool_use_id: 1, is_error: true, content: 'malformed id' },
        { type: 'tool_result', is_error: true, content: 'no reference at all' },
        okResult('toolu_01', '4.0.6\n'),
      ]),
      resultEntry('u-2', [errorResultLast('toolu_02', USER_REJECTED_CONTENT)]),
    ]);

    let calls: ReturnType<ReturnType<typeof transcriptFromJsonl>['findToolCalls']> = [];
    expect(() => {
      calls = transcriptFromJsonl(jsonl).findToolCalls();
    }).not.toThrow();

    expect(calls).toEqual([
      { name: SHELL_TOOL, args: { command: 'npm view yaml version' }, succeeded: true },
      { name: SHELL_TOOL, args: { command: 'npm view zod version' }, succeeded: false },
    ]);
  });
});
