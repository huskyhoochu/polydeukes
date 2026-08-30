import { execSync, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

// The witness predicate lives in the covenant package; the JSONL transcript provider lives
// in this adapter package. Importing the covenant package directly would violate the one-way
// dependency rule (adapter depends only on core), so both are driven from BUILT dists via a
// spawned `node -e` script that imports each by absolute file URL. That keeps the package
// dependency graph one-way while still verifying the cross-package assembly end to end.

const repoRoot = resolve(import.meta.dirname, '../../..');
const covenantDist = resolve(repoRoot, 'packages/covenant/dist/index.js');
const adapterDist = resolve(repoRoot, 'packages/adapter-claude-code/dist/transcript.js');

const TOKEN = 'PDKS-WITNESS-42';
// A fixed "message sent at" instant and a fixed clock: the assembled predicate is judged
// against these injected values only, so the verdict never depends on the wall clock.
const SENT_AT = Date.parse('2026-07-21T04:00:00.000Z');
const TTL_MS = 600_000;

beforeAll(() => {
  // The spawned script imports built dist.
  execSync('pnpm turbo run build', { cwd: repoRoot, stdio: 'pipe' });
}, 120_000);

/**
 * Spawn a node process that assembles ttlWitness (covenant dist) over
 * transcriptFromJsonl (adapter dist) and prints the boolean verdict on the last line.
 * The fixture JSONL, token, TTL and fixed clock value go through env as JSON so the inline
 * script stays free of interpolation hazards.
 */
function witnessVerdict(params: {
  jsonl: string;
  token: string;
  ttlMs: number;
  nowMs: number;
}): boolean {
  const script = [
    `const { ttlWitness } = await import(${JSON.stringify(pathToFileURL(covenantDist).href)});`,
    `const { transcriptFromJsonl } = await import(${JSON.stringify(pathToFileURL(adapterDist).href)});`,
    'const p = JSON.parse(process.env.PDKS_E2E_PARAMS);',
    'const predicate = ttlWitness({ token: p.token, ttlMs: p.ttlMs, now: () => p.nowMs });',
    'const transcript = transcriptFromJsonl(p.jsonl);',
    'const input = { toolCalls: [], subagentSpawns: [], userMessages: [] };',
    'process.stdout.write(String(predicate(input, transcript)));',
  ].join('\n');

  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf-8',
    env: { ...process.env, PDKS_E2E_PARAMS: JSON.stringify(params) },
  });

  if (result.status !== 0) {
    throw new Error(`witness spawn failed (status ${result.status}): ${result.stderr}`);
  }
  const printed = result.stdout.trim();
  if (printed !== 'true' && printed !== 'false') {
    throw new Error(
      `witness spawn printed a non-boolean verdict: ${JSON.stringify(result.stdout)}`,
    );
  }
  return printed === 'true';
}

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

describe('witness integration — real dists, injected clock', () => {
  it('witnesses when a human token message sits inside the TTL window (true)', () => {
    // The assembled provider must surface the human message WITH its timestamp: dropping the
    // timestamp fails closed even inside the window, and not surfacing the message at all
    // breaks the witness end to end. The token stands alone on the first line because that is
    // its invoking form — matching is first-line-exact, not substring — and what this test
    // exercises is the timestamp transport, not the match shape.
    const jsonl = toJsonl([humanEntry(`${TOKEN}\nplease do the thing`, SENT_AT)]);

    const verdict = witnessVerdict({ jsonl, token: TOKEN, ttlMs: TTL_MS, nowMs: SENT_AT + 1000 });

    expect(verdict).toBe(true);
  });

  it('does not witness when the token rides only on non-human entries (false)', () => {
    // The forgery vector: relaxing the provider's origin.kind==="human" allowlist would let a
    // subagent self-issue a witness by printing the token into an AI-controlled surface. Each
    // entry's text is the BARE token in its invoking form (first line, alone) so that the
    // provenance check is what refuses it — a decorated token would be refused on the match
    // instead, leaving provenance unexercised and this test green for the wrong reason.
    const jsonl = toJsonl([
      taskNotificationEntry(TOKEN, SENT_AT),
      toolResultEntry(TOKEN, SENT_AT),
      commandWrapperEntry(TOKEN, SENT_AT),
    ]);

    const verdict = witnessVerdict({ jsonl, token: TOKEN, ttlMs: TTL_MS, nowMs: SENT_AT + 1000 });

    expect(verdict).toBe(false);
  });

  it('does not witness when the human token message has no timestamp (false)', () => {
    // The message is kept (timestampMs undefined) but its freshness is unprovable, so the
    // predicate refuses it; a provider that fabricated a timestamp would turn an unprovable
    // message into a witnessing one. The token must match on the first line or the predicate
    // refuses on the match instead, never reaching the freshness check this test pins.
    const jsonl = toJsonl([humanEntry(TOKEN)]);

    const verdict = witnessVerdict({ jsonl, token: TOKEN, ttlMs: TTL_MS, nowMs: SENT_AT + 1000 });

    expect(verdict).toBe(false);
  });
});
