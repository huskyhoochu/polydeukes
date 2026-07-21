import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CanonicalTranscript, CovenantInput } from '@polydeukes/core';
import { noopTranscript, parseRecordLine, transcriptFromInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants } from '../src/dispatch.ts';
// COVENANT-06 RED phase. The waiver predicate factory `ttlWaiverHatch` does not exist yet,
// so this import is unresolvable and the whole file is RED by construction. The behaviours
// asserted here become the GREEN contract (PRD §4.1–4.2, §5.1–5.4).
import { ttlWaiverHatch } from '../src/ttl-waiver.ts';
import { echoToFileScript, inputWithArgs, readTelemetryLines } from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

const TOKEN = 'PDKS-WAIVER-42';
const NOW = 1_000_000;
/** A deterministic injected clock. */
const fakeNow = (): number => NOW;

/**
 * A fake transcript whose findUserMessages returns exactly the given messages
 * (each carrying its own optional timestampMs). findSubagentInvocations returns
 * the given invocations so §5.2 can plant the token outside user messages.
 */
function fakeTranscript(
  userMessages: { text: string; timestampMs?: number }[],
  invocations: { kind: string }[] = [],
): CanonicalTranscript {
  return {
    findSubagentInvocations: (kind) =>
      invocations.filter((inv) => kind === undefined || inv.kind === kind),
    findUserMessages: () => userMessages,
  };
}

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-ttl-waiver-'));
  telemetryPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ===========================================================================
// §5.1 — waiver verdict (PRD §4.2 semantics)
// ===========================================================================

describe('ttlWaiverHatch — verdict (PRD §5.1)', () => {
  it('bypasses a token-bearing user message that is within the TTL window', () => {
    // P0 business rule: a fresh, agreed token must waive. Mutation caught: the predicate
    // never returning true (dead waiver), or the substring match being inverted.
    const predicate = ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([
      { text: `${TOKEN}\n\nfix the hook file`, timestampMs: NOW - 1000 },
    ]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(true);
  });

  it('waives AT the TTL boundary (now - ts === ttlMs) and blocks one ms past it', () => {
    // P1 boundary: the interval is closed on the far edge. Mutation caught: `<= ttlMs`
    // flipped to `< ttlMs` (would drop the exact-boundary case), or `ttlMs` shifted by 1.
    const predicate = ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const atBoundary = fakeTranscript([{ text: TOKEN, timestampMs: NOW - 5000 }]);
    const pastBoundary = fakeTranscript([{ text: TOKEN, timestampMs: NOW - 5001 }]);
    expect(predicate(inputWithArgs({}), atBoundary)).toBe(true);
    expect(predicate(inputWithArgs({}), pastBoundary)).toBe(false);
  });

  it('does not waive when the only token-bearing message lacks a timestamp', () => {
    // P0 fail-closed: absent timestampMs is unprovable freshness — the disposition is
    // resolveFailMode('evidence-absence') === 'closed', so it can never waive. Mutation
    // caught: treating a missing timestampMs as fresh (fail-open hole), or defaulting it
    // to 0/now.
    const predicate = ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([{ text: TOKEN }]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(false);
  });

  it('rejects a future timestamp (ts > now, negative elapsed)', () => {
    // P0 fail-closed: a clock that cannot prove a *past* agreement is unjudgeable. The
    // interval is 0 <= elapsed <= ttlMs, so negative elapsed is out. Mutation caught: the
    // lower bound `0 <= elapsed` being dropped (a future/replayed timestamp would waive).
    const predicate = ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([{ text: TOKEN, timestampMs: NOW + 1 }]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(false);
  });

  it('waives when exactly one of several messages qualifies (order-independent)', () => {
    // P1 existential quantifier: the predicate is `SOME message satisfies ALL`. Mutation
    // caught: `.some` narrowed to `.every` (all-must-qualify), or first/last-only scanning.
    const predicate = ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([
      { text: 'no token here', timestampMs: NOW - 100 },
      { text: TOKEN, timestampMs: NOW - 100 },
      { text: 'also no token', timestampMs: NOW - 100 },
    ]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(true);
  });

  it('never waives against noopTranscript or a bare transcriptFromInput (no timestamps)', () => {
    // P0 convergence: zero-evidence (noop) and bare-IR (timestamp-free) sources both
    // fail-closed. Even when the IR user message carries the token, the wrapped transcript
    // omits timestampMs, so it cannot waive. Mutation caught: the predicate treating an
    // absent timestamp as fresh, or reading userMessages off the IR directly.
    const predicate = ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const input: CovenantInput = {
      toolCalls: [],
      subagentSpawns: [],
      userMessages: [{ text: TOKEN }],
    };
    expect(predicate(input, noopTranscript)).toBe(false);
    expect(predicate(input, transcriptFromInput(input))).toBe(false);
  });
});

// ===========================================================================
// COVENANT-15 §5.1 — mention exclusion (PRD §4.1 first-line exact match, §4.3 backticks)
//
// The token may only invoke when the FIRST LINE of the message, trimmed, equals the
// token exactly. Every case below merely *mentions* the token and must stay false.
// ===========================================================================

describe('ttlWaiverHatch — mention exclusion (COVENANT-15 §5.1)', () => {
  it('does not waive when the token sits mid-sentence in a question about the waiver', () => {
    // P0 security fail-closed (the measured 2026-07-21 incident): asking *about* the valve
    // must not open it. Mutation caught: `firstLine(text).trim() === token` regressing to
    // `text.includes(token)` — the exact substring semantics this ticket renegotiates.
    const predicate = ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([
      { text: `so when does ${TOKEN} expire?`, timestampMs: NOW - 100 },
    ]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(false);
  });

  it('does not waive when the first line starts with the token but carries trailing text', () => {
    // P0 boundary of the exact-match rule (PRD §4.2 table row `<token> 지금`): prefix is not
    // enough. Mutation caught: `=== token` weakened to `.startsWith(token)`, which would let
    // any sentence opening with the token through.
    const predicate = ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([
      { text: `${TOKEN} — what is that?`, timestampMs: NOW - 100 },
    ]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(false);
  });

  it('does not waive when the token is wrapped in backticks (PRD §4.3)', () => {
    // P0 adopted safety property: code formatting signals *mention*, not intent. No stripping
    // code exists by design — exact match excludes it naturally. Mutation caught: any added
    // normalisation that peels backticks/punctuation before comparing, or `.includes`.
    const predicate = ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([{ text: `\`${TOKEN}\``, timestampMs: NOW - 100 }]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(false);
  });

  it('does not waive when the token appears only on a line below the first', () => {
    // P0 first-line-only scope: quoting the token under an introduction is a mention.
    // Mutation caught: the predicate scanning every line (`text.split('\n').some(...)`)
    // instead of the first line alone.
    const predicate = ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([
      { text: `here is the token:\n${TOKEN}`, timestampMs: NOW - 100 },
    ]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(false);
  });

  it('does not waive when a leading blank line precedes the token (PRD §4.1)', () => {
    // P0 explicit rule "the token IS the start of the utterance": a leading empty line is
    // not forgiven, because forgiving it reintroduces a "how many lines do we search"
    // boundary. Mutation caught: skipping/trimming leading blank lines before taking the
    // first line (e.g. `text.trim()` applied before splitting, or `.split` + `.find(Boolean)`).
    const predicate = ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([{ text: `\n${TOKEN}`, timestampMs: NOW - 100 }]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(false);
  });
});

// ===========================================================================
// COVENANT-15 §5.2 — invocation preserved (PRD §4.2 table, invoking rows)
//
// Narrowing must not break real invocations: the predicate only ever shrinks.
// ===========================================================================

describe('ttlWaiverHatch — invocation preserved (COVENANT-15 §5.2)', () => {
  it('waives when the whole utterance is the bare token', () => {
    // P0 business rule: the canonical invocation form must keep working, otherwise the
    // narrowing has produced a dead valve. Mutation caught: the match predicate inverted or
    // hard-wired to false.
    const predicate = ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([{ text: TOKEN, timestampMs: NOW - 100 }]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(true);
  });

  it('waives when the first line is the token and later lines carry the work instruction', () => {
    // P1 first-line scoping in the invoking direction: text below the first line is free.
    // Mutation caught: comparing the WHOLE text to the token (`text.trim() === token`),
    // which would reject every multi-line invocation — the realistic usage shape.
    const predicate = ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([
      { text: `${TOKEN}\n\nfix the hook file`, timestampMs: NOW - 100 },
    ]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(true);
  });

  it('waives when the first line has surrounding whitespace around the token', () => {
    // P1 boundary of the trim rule (PRD §4.1): leading/trailing spaces on the first line are
    // removed before comparing. Mutation caught: `.trim()` dropped from the first-line
    // comparison, which would reject accidentally-indented invocations.
    const predicate = ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([{ text: `  ${TOKEN}  \nfix it`, timestampMs: NOW - 100 }]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(true);
  });

  it('waives when the message was transported with CRLF line endings', () => {
    // P1 external transport contract: a `\r` left at the end of the first line by CRLF
    // transport must be absorbed by `trim()`. Mutation caught: splitting on `\n` without
    // trimming (the residual `\r` would break equality and silently kill the valve for
    // CRLF-carried transcripts).
    const predicate = ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([{ text: `${TOKEN}\r\nfix it`, timestampMs: NOW - 100 }]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(true);
  });
});

// ===========================================================================
// §5.2 — layer boundary: only findUserMessages() is consulted
// ===========================================================================

describe('ttlWaiverHatch — layer boundary (PRD §5.2)', () => {
  it('ignores a token planted outside user messages (invocations and toolCalls args)', () => {
    // P0 layer responsibility: the token may ride on user messages only. Here it lives in
    // an invocation kind and in the tool-call args, but no user message carries it — no
    // waiver. Mutation caught: the predicate scanning findSubagentInvocations() or the
    // input IR (an AI-synthesised token would then waive — a security bypass).
    // The planted tokens are BARE (nothing appended): under first-line-exact matching a
    // decorated token never matches anywhere, which would let a leaked scan pass this
    // test unnoticed — the review's executed mutation proved exactly that (COVENANT-15).
    const predicate = ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript(
      [{ text: 'ordinary message', timestampMs: NOW - 100 }],
      [{ kind: TOKEN }],
    );
    const input = inputWithArgs({ note: TOKEN });
    expect(predicate(input, transcript)).toBe(false);
  });
});

// ===========================================================================
// §5.3 — factory validation (throws at factory time, not predicate time)
// ===========================================================================

describe('ttlWaiverHatch — factory validation (PRD §5.3)', () => {
  it('throws when the token is empty or whitespace-only', () => {
    // P0 assembly guard: a blank token would match every message (waive everything).
    // Mutation caught: the trimmed-empty check being dropped, or `.trim()` omitted.
    expect(() => ttlWaiverHatch({ token: '', ttlMs: 5000, now: fakeNow })).toThrow();
    expect(() => ttlWaiverHatch({ token: '   ', ttlMs: 5000, now: fakeNow })).toThrow();
  });

  it('throws when the token contains a line break (structurally inert under first-line matching)', () => {
    // P0 silent-death guard (review finding ④): the judgment compares an utterance's
    // FIRST LINE, which never contains a line break, so a token with an embedded \n or
    // lone \r could never match anything — factory acceptance would ship a valve that
    // refuses every utterance with no error pointing at the token. Mutation caught:
    // dropping the /[\r\n]/ viability check.
    expect(() => ttlWaiverHatch({ token: 'pdks\nwaive', ttlMs: 5000, now: fakeNow })).toThrow();
    expect(() => ttlWaiverHatch({ token: 'pdks\rwaive', ttlMs: 5000, now: fakeNow })).toThrow();
  });

  it('normalises a token configured with surrounding whitespace instead of dying silently', () => {
    // P0 silent-death guard (REVIEW finding): the first line is compared trimmed, so a
    // token carrying stray whitespace would never equal it — the factory would accept the
    // config and the valve would then refuse every utterance, with no error to explain it.
    // Mutation caught: dropping the assembly-time `rawToken.trim()` (normalising only one
    // side of the comparison).
    const predicate = ttlWaiverHatch({ token: `  ${TOKEN}  `, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([{ text: TOKEN, timestampMs: NOW - 100 }]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(true);
  });

  it('throws when ttlMs is not a finite positive number', () => {
    // P0 assembly guard: zero/negative/NaN/Infinity TTL each break the closed-interval
    // meaning (0 disables, negative is impossible, NaN never compares true, Infinity never
    // expires). Mutation caught: the `Number.isFinite(ttlMs) && ttlMs > 0` check being
    // weakened to `> 0` (lets NaN/Infinity through) or `>= 0` (lets 0 through).
    expect(() => ttlWaiverHatch({ token: TOKEN, ttlMs: 0, now: fakeNow })).toThrow();
    expect(() => ttlWaiverHatch({ token: TOKEN, ttlMs: -1, now: fakeNow })).toThrow();
    expect(() => ttlWaiverHatch({ token: TOKEN, ttlMs: Number.NaN, now: fakeNow })).toThrow();
    expect(() =>
      ttlWaiverHatch({ token: TOKEN, ttlMs: Number.POSITIVE_INFINITY, now: fakeNow }),
    ).toThrow();
  });

  it('a successfully built predicate never throws (returns a plain false instead)', () => {
    // P1 purity: validation is a factory-time concern; the predicate itself is total. A
    // weird-but-valid transcript (timestamp-free message) yields false, not an exception.
    // Mutation caught: validation logic leaking into the predicate body (would throw at
    // dispatch time, which the dispatcher would silently absorb as no-bypass).
    const predicate = ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const weird = fakeTranscript([{ text: TOKEN }]);
    expect(() => predicate(inputWithArgs({}), noopTranscript)).not.toThrow();
    expect(predicate(inputWithArgs({}), noopTranscript)).toBe(false);
    expect(() => predicate(inputWithArgs({}), weird)).not.toThrow();
    expect(predicate(inputWithArgs({}), weird)).toBe(false);
  });
});

// ===========================================================================
// §5.4 — dispatcher integration through the existing escapeHatch seam
// ===========================================================================

describe('ttlWaiverHatch — dispatcher integration (PRD §5.4)', () => {
  it('a fresh-token transcript bypasses the spawn and records exactly one bypassed event', async () => {
    // P1 external contract: wired as escapeHatch, a valid waiver must skip the body and
    // measure `bypassed` with exit 0. File absence proves no spawn. Mutation caught: the
    // predicate not reaching a true verdict end-to-end (body would spawn and block).
    const outFile = join(dir, 'should-not-exist.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'ttl-waiver-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: echoToFileScript(outFile, 1) },
      escapeHatch: ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow }),
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
      transcript: fakeTranscript([
        { text: `${TOKEN}\nedit the protected file`, timestampMs: NOW - 100 },
      ]),
    });

    expect(result.exitCode).toBe(0);
    expect(existsSync(outFile)).toBe(false);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('bypassed');
  });

  it('an expired-token transcript restores blocking: the body spawns and records blocked with exit 2', async () => {
    // P0 fail-closed restoration ("re-block after expiry"): once the waiver window closes,
    // the same registration must fall back to the covenant body. File presence proves the
    // spawn; a blocking body yields exit 2 and a `blocked` record. Mutation caught: the TTL
    // upper bound being dropped (an expired token would keep waiving forever — the exact
    // env-valve failure this ticket removes).
    const outFile = join(dir, 'body-ran.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'ttl-waiver-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: { command: process.execPath, args: echoToFileScript(outFile, 2) },
      escapeHatch: ttlWaiverHatch({ token: TOKEN, ttlMs: 5000, now: fakeNow }),
    };

    const result = await dispatchCovenants({
      stdinPayload: JSON.stringify(input),
      registrations: [reg],
      telemetryPath,
      transcript: fakeTranscript([{ text: TOKEN, timestampMs: NOW - 6000 }]),
    });

    expect(result.exitCode).toBe(2);
    expect(existsSync(outFile)).toBe(true);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('blocked');
  });
});
