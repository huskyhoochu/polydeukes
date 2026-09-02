import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CanonicalTranscript, CovenantInput } from '@polydeukes/core';
import { noopTranscript, parseRecordLine, transcriptFromInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CovenantRegistration } from '../src/dispatch.ts';
import { dispatchCovenants } from '../src/dispatch.ts';
import { ttlWitness } from '../src/ttl-witness.ts';
import { inputWithArgs, markerThunk, readTelemetryLines } from './helpers.js';

const TOKEN = 'PDKS-WITNESS-42';
const NOW = 1_000_000;
/** A deterministic injected clock. */
const fakeNow = (): number => NOW;

/**
 * A fake transcript whose findUserMessages returns exactly the given messages, each
 * carrying its own optional timestampMs.
 */
function fakeTranscript(
  userMessages: { text: string; timestampMs?: number }[],
): CanonicalTranscript {
  return {
    findUserMessages: () => userMessages,
    findToolCalls: () => [],
  };
}

let dir: string;
let telemetryPath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pdks-ttl-witness-'));
  telemetryPath = join(dir, 'roi.log');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('ttlWitness — verdict', () => {
  it('bypasses a token-bearing user message that is within the TTL window', () => {
    const predicate = ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([
      { text: `${TOKEN}\n\nfix the hook file`, timestampMs: NOW - 1000 },
    ]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(true);
  });

  it('witnesses AT the TTL boundary (now - ts === ttlMs) and blocks one ms past it', () => {
    // The interval is closed on the far edge.
    const predicate = ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const atBoundary = fakeTranscript([{ text: TOKEN, timestampMs: NOW - 5000 }]);
    const pastBoundary = fakeTranscript([{ text: TOKEN, timestampMs: NOW - 5001 }]);
    expect(predicate(inputWithArgs({}), atBoundary)).toBe(true);
    expect(predicate(inputWithArgs({}), pastBoundary)).toBe(false);
  });

  it('does not witness when the only token-bearing message lacks a timestamp', () => {
    // An absent timestampMs is unprovable freshness, so it can never witness: defaulting it
    // to 0 or to now would open the valve on evidence that does not exist.
    const predicate = ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([{ text: TOKEN }]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(false);
  });

  it('rejects a future timestamp (ts > now, negative elapsed)', () => {
    // The interval is 0 <= elapsed <= ttlMs: without the lower bound a future or replayed
    // timestamp witnesses, and a clock that cannot prove a PAST agreement proves nothing.
    const predicate = ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([{ text: TOKEN, timestampMs: NOW + 1 }]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(false);
  });

  it('witnesses when exactly one of several messages qualifies (order-independent)', () => {
    // The predicate is "SOME message satisfies ALL the conditions", never all-must-qualify
    // and never first-or-last-only.
    const predicate = ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([
      { text: 'no token here', timestampMs: NOW - 100 },
      { text: TOKEN, timestampMs: NOW - 100 },
      { text: 'also no token', timestampMs: NOW - 100 },
    ]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(true);
  });

  it('never witnesses against noopTranscript or a bare transcriptFromInput (no timestamps)', () => {
    // Both a zero-evidence transcript and a timestamp-free one fail closed. Even when the
    // input's own user message carries the token, the wrapped transcript omits timestampMs,
    // so reading userMessages off the input directly would open the valve on it.
    const predicate = ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const input: CovenantInput = {
      toolCalls: [],
      subagentSpawns: [],
      userMessages: [{ text: TOKEN }],
    };
    expect(predicate(input, noopTranscript)).toBe(false);
    expect(predicate(input, transcriptFromInput(input))).toBe(false);
  });
});

// The token invokes only when the FIRST LINE of the message, trimmed, equals it exactly.
// Every case below merely MENTIONS the token and must stay false.

describe('ttlWitness — mention exclusion', () => {
  it('does not witness when the token sits mid-sentence in a question about the witness', () => {
    // Asking ABOUT the valve must not open it, which substring matching cannot distinguish.
    const predicate = ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([
      { text: `so when does ${TOKEN} expire?`, timestampMs: NOW - 100 },
    ]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(false);
  });

  it('does not witness when the first line starts with the token but carries trailing text', () => {
    // A prefix is not enough: `.startsWith` would let any sentence opening with the token
    // through.
    const predicate = ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([
      { text: `${TOKEN} — what is that?`, timestampMs: NOW - 100 },
    ]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(false);
  });

  it('does not witness when the token is wrapped in backticks', () => {
    // Code formatting signals mention, not intent. Exact match excludes it with no
    // stripping code at all, so any normalisation that peels backticks reopens it.
    const predicate = ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([{ text: `\`${TOKEN}\``, timestampMs: NOW - 100 }]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(false);
  });

  it('does not witness when the token appears only on a line below the first', () => {
    // Quoting the token under an introduction is a mention, so the scan is the first line
    // alone rather than every line.
    const predicate = ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([
      { text: `here is the token:\n${TOKEN}`, timestampMs: NOW - 100 },
    ]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(false);
  });

  it('does not witness when a leading blank line precedes the token', () => {
    // The token IS the start of the utterance: forgiving a leading blank line reintroduces
    // the "how many lines do we search" boundary the exact rule removes.
    const predicate = ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([{ text: `\n${TOKEN}`, timestampMs: NOW - 100 }]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(false);
  });
});

// The narrowing above must not break real invocations.

describe('ttlWitness — invocation preserved', () => {
  it('witnesses when the whole utterance is the bare token', () => {
    // The canonical invocation form must keep working, or the narrowing has produced a
    // dead valve.
    const predicate = ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([{ text: TOKEN, timestampMs: NOW - 100 }]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(true);
  });

  it('witnesses when the first line is the token and later lines carry the work instruction', () => {
    // Text below the first line is free: comparing the WHOLE text to the token rejects
    // every multi-line invocation, which is the realistic usage shape.
    const predicate = ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([
      { text: `${TOKEN}\n\nfix the hook file`, timestampMs: NOW - 100 },
    ]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(true);
  });

  it('witnesses when the first line has surrounding whitespace around the token', () => {
    // Leading and trailing spaces on the first line are removed before comparing, so an
    // accidentally indented invocation still opens the valve.
    const predicate = ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([{ text: `  ${TOKEN}  \nfix it`, timestampMs: NOW - 100 }]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(true);
  });

  it('witnesses when the message was transported with CRLF line endings', () => {
    // A `\r` left at the end of the first line by CRLF transport must be absorbed by the
    // trim, or the valve is silently dead for every CRLF-carried transcript.
    const predicate = ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([{ text: `${TOKEN}\r\nfix it`, timestampMs: NOW - 100 }]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(true);
  });
});

describe('ttlWitness — layer boundary', () => {
  it('ignores a token planted outside user messages (toolCalls args)', () => {
    // The token may ride on user messages only. Here it lives in the tool-call args, so a
    // predicate scanning the input itself would let an agent-synthesised token open the
    // valve for itself. The planted token is BARE: under first-line-exact matching a
    // decorated token never matches anywhere, so a decorated fixture would let a leaked
    // scan pass this test unnoticed.
    const predicate = ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([{ text: 'ordinary message', timestampMs: NOW - 100 }]);
    const input = inputWithArgs({ note: TOKEN });
    expect(predicate(input, transcript)).toBe(false);
  });
});

describe('ttlWitness — factory validation', () => {
  it('throws when the token is empty or whitespace-only', () => {
    // A blank token matches every message, witnessing everything.
    expect(() => ttlWitness({ token: '', ttlMs: 5000, now: fakeNow })).toThrow();
    expect(() => ttlWitness({ token: '   ', ttlMs: 5000, now: fakeNow })).toThrow();
  });

  it('throws when the token contains a line break (structurally inert under first-line matching)', () => {
    // The judgment compares an utterance's FIRST LINE, which never contains a line break,
    // so a token with an embedded \n or lone \r can never match anything. Accepting it at
    // the factory ships a valve that refuses every utterance with no error naming the
    // token.
    expect(() => ttlWitness({ token: 'pdks\nwitness', ttlMs: 5000, now: fakeNow })).toThrow();
    expect(() => ttlWitness({ token: 'pdks\rwitness', ttlMs: 5000, now: fakeNow })).toThrow();
  });

  it('normalises a token configured with surrounding whitespace instead of dying silently', () => {
    // The first line is compared trimmed, so normalising only that side leaves a token
    // carrying stray whitespace unable to equal it — again a valve that refuses every
    // utterance with no error to explain it.
    const predicate = ttlWitness({ token: `  ${TOKEN}  `, ttlMs: 5000, now: fakeNow });
    const transcript = fakeTranscript([{ text: TOKEN, timestampMs: NOW - 100 }]);
    expect(predicate(inputWithArgs({}), transcript)).toBe(true);
  });

  it('throws when ttlMs is not a finite positive number', () => {
    // Each of these breaks the closed interval's meaning: 0 disables the valve, negative is
    // impossible, NaN never compares true, and Infinity never expires.
    expect(() => ttlWitness({ token: TOKEN, ttlMs: 0, now: fakeNow })).toThrow();
    expect(() => ttlWitness({ token: TOKEN, ttlMs: -1, now: fakeNow })).toThrow();
    expect(() => ttlWitness({ token: TOKEN, ttlMs: Number.NaN, now: fakeNow })).toThrow();
    expect(() =>
      ttlWitness({ token: TOKEN, ttlMs: Number.POSITIVE_INFINITY, now: fakeNow }),
    ).toThrow();
  });

  it('a successfully built predicate never throws (returns a plain false instead)', () => {
    // Validation is a factory-time concern and the predicate is total: validation leaking
    // into the predicate body throws at dispatch time, which the dispatcher silently
    // absorbs as no opening.
    const predicate = ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow });
    const weird = fakeTranscript([{ text: TOKEN }]);
    expect(() => predicate(inputWithArgs({}), noopTranscript)).not.toThrow();
    expect(predicate(inputWithArgs({}), noopTranscript)).toBe(false);
    expect(() => predicate(inputWithArgs({}), weird)).not.toThrow();
    expect(predicate(inputWithArgs({}), weird)).toBe(false);
  });
});

describe('ttlWitness — dispatcher integration', () => {
  it('a fresh-token transcript opens the valve after the verdict and records exactly one witnessed event', async () => {
    // Wired as the witness, a valid token relaxes the body's break and measures
    // `witnessed`. The marker file proves the judge still ran.
    const outFile = join(dir, 'body-ran.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'ttl-witness-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: markerThunk(outFile, 1),
      witness: ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow }),
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
    expect(existsSync(outFile)).toBe(true);
    const lines = readTelemetryLines(telemetryPath);
    expect(lines).toHaveLength(1);
    expect(parseRecordLine(lines[0])?.event).toBe('witnessed');
  });

  it('an expired-token transcript restores blocking: the body spawns and records blocked with exit 2', async () => {
    // Once the window closes the same registration blocks again. Without the TTL upper
    // bound an expired token keeps witnessing forever, which is what a valve carried in the
    // environment does.
    const outFile = join(dir, 'body-ran.txt');
    const input = inputWithArgs({ target: 'sub/protected/file.txt' });
    const reg: CovenantRegistration = {
      label: 'ttl-witness-covenant',
      protectedPaths: ['sub/protected/file.txt'],
      body: markerThunk(outFile, 2),
      witness: ttlWitness({ token: TOKEN, ttlMs: 5000, now: fakeNow }),
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
