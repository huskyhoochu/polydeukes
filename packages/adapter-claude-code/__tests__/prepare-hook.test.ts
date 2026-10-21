import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareHook } from '../src/prepare-hook.ts';

const TOOL = 'Write';
const TARGET = 'nested.txt';
const NOW = 1_800_000_000_000;
let repoRoot: string;
beforeEach(() => {
  repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-prepare-')));
});
afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});
function payload(extra: Record<string, unknown> = {}) {
  const toolInput = { file_path: TARGET, content: 'new text\n' };
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: 'session-a',
    tool_name: TOOL,
    tool_input: toolInput,
    cwd: repoRoot,
    ...extra,
  });
}
function prepare(rawPayload: string) {
  return prepareHook({ repoRoot, rawPayload });
}

describe('prepareHook process-free input contract', () => {
  it('returns a judged create with the actual target and content without an npm installation', () => {
    // Dropping mutation evidence would make protected-path judgment fall back to mentions.
    const result = prepare(payload());
    expect(result).toMatchObject({
      outcome: 'check',
      input: {
        toolCalls: [
          { name: TOOL, fileChange: { kind: 'create', path: TARGET, post: 'new text\n' } },
        ],
      },
    });
  });
  it.each([
    ['absent', ''],
    ['cut JSON', '{"tool'],
    ['non-object', 'null'],
  ])('returns unavailable for %s input', (_name, raw) => {
    // Treating an incomplete envelope as an empty observation would fabricate permission.
    expect(prepare(raw)).toMatchObject({ outcome: 'unavailable', reason: expect.any(String) });
  });
  it('refuses an explicitly truncated envelope before making an IR', () => {
    // Complete JSON can still carry a host truncation marker.
    expect(prepare(payload({ truncated: true }))).toMatchObject({
      outcome: 'unavailable',
      reason: expect.any(String),
    });
  });
  it('allows future envelope fields without dropping consumed mutation evidence', () => {
    // Rejecting an unused host field would block every call after an additive host upgrade.
    const result = prepare(payload({ future_host_field: { version: 2 } }));
    expect(result).toMatchObject({
      outcome: 'check',
      input: { toolCalls: [{ fileChange: { path: TARGET } }] },
    });
  });
  it('resolves a relative file against the event cwd before making it root relative', () => {
    // Root-anchoring a relative event path judges a different file from the host.
    mkdirSync(join(repoRoot, 'sub'));
    expect(prepare(payload({ cwd: join(repoRoot, 'sub') }))).toMatchObject({
      outcome: 'check',
      input: { toolCalls: [{ fileChange: { path: `sub/${TARGET}` } }] },
    });
  });
  it('reports a pre-state read failure instead of claiming a creation', () => {
    // A directory at the target is unreadable file evidence, rather than a missing file.
    mkdirSync(join(repoRoot, TARGET));
    expect(prepare(payload())).toMatchObject({
      outcome: 'unavailable',
      reason: expect.any(String),
    });
  });
});

describe('prepareHook transcript provenance', () => {
  it.each([
    ['human', { kind: 'human' }, true],
    ['unknown', undefined, false],
  ])(
    'carries %s-origin witness evidence according to proved provenance',
    (_name, origin, admitted) => {
      // Losing the source check opens the witness; losing the transcript removes a valid human choice.
      const transcript = join(repoRoot, 'transcript.jsonl');
      const text = 'witness token';
      writeFileSync(
        transcript,
        `${JSON.stringify({ type: 'user', origin, promptSource: 'typed', message: { role: 'user', content: text }, timestamp: new Date(NOW).toISOString(), uuid: 'message-1' })}\n`,
      );
      const result = prepare(payload({ transcript_path: transcript }));
      expect(result.outcome).toBe('check');
      if (result.outcome !== 'check') throw new Error('expected observed input');
      expect(result.input.session?.userMessages ?? []).toEqual(
        admitted ? [{ text, timestampMs: NOW }] : [],
      );
    },
  );
});

describe('prepareHook working-directory context', () => {
  it.each(['.', 'sub'])('carries shell cwd %s without rewriting the command', (directory) => {
    // Dropping cwd routes a relative redirect to a different file; rewriting command loses its evidence.
    const shellTool = 'Bash';
    const command = "printf 'literal ../text' > gate.txt";
    mkdirSync(join(repoRoot, 'sub'));
    const result = prepare(
      payload({
        cwd: join(repoRoot, directory),
        tool_name: shellTool,
        tool_input: { command: command },
      }),
    );
    expect(result).toMatchObject({
      outcome: 'check',
      input: { toolCalls: [{ name: shellTool, cwd: directory, args: { command: command } }] },
    });
  });
});
