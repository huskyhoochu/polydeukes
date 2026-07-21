import { execSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

// ADAPTER-04 §5.2 waiver-integration E2E. The waiver predicate lives in the covenant
// package; the JSONL transcript provider lives in this adapter package. Importing the
// covenant package directly would violate the one-way dependency rule (adapter depends
// only on core), so — mirroring assembly.e2e.test.ts — we drive both from BUILT dists
// via a spawned `node -e` script that imports each dist by absolute file URL. The
// script constructs ttlWaiverHatch, feeds it transcriptFromJsonl(<fixture>), and prints
// the boolean verdict; this file only asserts that verdict. This keeps the package
// dependency graph one-way while still verifying the cross-package assembly end to end.

const repoRoot = resolve(import.meta.dirname, '../../..');
const covenantDist = resolve(repoRoot, 'packages/covenant/dist/index.js');
const adapterDist = resolve(repoRoot, 'packages/adapter-claude-code/dist/index.js');

const TOKEN = 'PDKS-WAIVER-42';
// A fixed "message sent at" instant and a fixed clock: the assembled predicate is judged
// against these injected values only, so the verdict is deterministic (no wall clock).
const SENT_AT = Date.parse('2026-07-21T04:00:00.000Z');
const TTL_MS = 600_000; // 10 minutes, the roadmap's proposed default window.

beforeAll(() => {
  // The spawned script imports built dist; turbo caching makes repeat runs ~1s.
  execSync('pnpm turbo run build', { cwd: repoRoot, stdio: 'pipe' });
}, 120_000);

/**
 * Spawn a node process that assembles ttlWaiverHatch (covenant dist) over
 * transcriptFromJsonl (adapter dist) and prints the boolean verdict on the last line.
 * The fixture JSONL, token, TTL and fixed clock value are passed as JSON via env so the
 * inline script stays free of interpolation hazards.
 */
function waiverVerdict(params: {
  jsonl: string;
  token: string;
  ttlMs: number;
  nowMs: number;
}): boolean {
  const script = [
    `const { ttlWaiverHatch } = await import(${JSON.stringify(pathToFileURL(covenantDist).href)});`,
    `const { transcriptFromJsonl } = await import(${JSON.stringify(pathToFileURL(adapterDist).href)});`,
    'const p = JSON.parse(process.env.PDKS_E2E_PARAMS);',
    'const predicate = ttlWaiverHatch({ token: p.token, ttlMs: p.ttlMs, now: () => p.nowMs });',
    'const transcript = transcriptFromJsonl(p.jsonl);',
    'const input = { toolCalls: [], subagentSpawns: [], userMessages: [] };',
    'process.stdout.write(String(predicate(input, transcript)));',
  ].join('\n');

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf-8',
    env: { ...process.env, PDKS_E2E_PARAMS: JSON.stringify(params) },
  });

  if (result.status !== 0) {
    throw new Error(`waiver spawn failed (status ${result.status}): ${result.stderr}`);
  }
  const printed = result.stdout.trim();
  if (printed !== 'true' && printed !== 'false') {
    throw new Error(`waiver spawn printed a non-boolean verdict: ${JSON.stringify(result.stdout)}`);
  }
  return printed === 'true';
}

// ---------------------------------------------------------------------------
// Fixture entry builders (JSONL vocabulary stays in the adapter test surface).
// ---------------------------------------------------------------------------

function humanEntry(content: string, timestampMs?: number) {
  return {
    origin: { kind: 'human' },
    promptSource: 'typed',
    type: 'user',
    message: { role: 'user', content },
    ...(timestampMs === undefined ? {} : { timestamp: new Date(timestampMs).toISOString() }),
    uuid: 'u-human',
  };
}

function taskNotificationEntry(content: string, timestampMs: number) {
  return {
    origin: { kind: 'task-notification' },
    promptSource: 'system',
    type: 'user',
    message: { role: 'user', content },
    timestamp: new Date(timestampMs).toISOString(),
    uuid: 'u-notif',
  };
}

function toolResultEntry(text: string, timestampMs: number) {
  return {
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: text }] },
    timestamp: new Date(timestampMs).toISOString(),
    uuid: 'u-toolresult',
  };
}

function commandWrapperEntry(content: string, timestampMs: number) {
  return {
    type: 'user',
    message: { role: 'user', content },
    timestamp: new Date(timestampMs).toISOString(),
    uuid: 'u-command',
  };
}

function toJsonl(entries: unknown[]): string {
  return entries.map((entry) => JSON.stringify(entry)).join('\n');
}

describe('ADAPTER-04 §5.2 waiver integration — real dists, injected clock', () => {
  it('waives when a human token message sits inside the TTL window (true)', () => {
    // AC "waiver valid when a user message matches within 10 minutes": the assembled provider
    // must surface the human message WITH its timestamp so the fresh-token case waives.
    // Mutation caught: the provider dropping the timestamp (would fail-closed even inside the
    // window), or not surfacing the human message at all — either breaks the waiver end to end.
    // The token stands alone on the first line because COVENANT-15 narrowed matching from
    // substring to first-line-exact; the transport under test here is the timestamp, not the
    // match shape, so the fixture carries the token in its invoking form.
    const jsonl = toJsonl([humanEntry(`${TOKEN}\nplease do the thing`, SENT_AT)]);

    const verdict = waiverVerdict({ jsonl, token: TOKEN, ttlMs: TTL_MS, nowMs: SENT_AT + 1000 });

    expect(verdict).toBe(true);
  });

  // AUDIT: the past-TTL expiry case was pruned — the covenant package's ttl-waiver tests
  // already pin the expiry boundary to the millisecond against fake transcripts, and the
  // provider→predicate wiring is covered by the in-window case above (same seam, same path).

  it('does not waive when the token rides only on non-human entries (false)', () => {
    // AC "AI-synthesised non-user entries do not qualify" — the forgery-vector case. A fresh
    // token planted in task-notification, tool_result and no-origin entries must NOT waive.
    // Mutation caught: the provider relaxing its origin.kind==="human" allowlist, which would
    // let a subagent self-issue a waiver by printing the token into an AI-controlled surface.
    // Each entry's text is the BARE token in its invoking form (first line, alone): if the
    // allowlist ever admitted one of these entries, the match would succeed and this test
    // would fail. Decorated tokens would be refused on the match instead, leaving the
    // provenance check unexercised — the silent-green failure the COVENANT-15 review caught.
    const jsonl = toJsonl([
      taskNotificationEntry(TOKEN, SENT_AT),
      toolResultEntry(TOKEN, SENT_AT),
      commandWrapperEntry(TOKEN, SENT_AT),
    ]);

    const verdict = waiverVerdict({ jsonl, token: TOKEN, ttlMs: TTL_MS, nowMs: SENT_AT + 1000 });

    expect(verdict).toBe(false);
  });

  it('does not waive when the human token message has no timestamp (false)', () => {
    // AC "timestamp-less entry is fail-closed": the message is kept (timestampMs undefined) but
    // freshness is unprovable, so the waiver predicate must refuse it. Mutation caught: the
    // provider fabricating a timestamp for a timestamp-less entry, converting an unprovable
    // message into a waiving one. The token must match on the first line (COVENANT-15) or the
    // predicate would refuse on the match instead, and this test would go green without ever
    // reaching the freshness check it exists to pin.
    const jsonl = toJsonl([humanEntry(TOKEN)]);

    const verdict = waiverVerdict({ jsonl, token: TOKEN, ttlMs: TTL_MS, nowMs: SENT_AT + 1000 });

    expect(verdict).toBe(false);
  });
});
