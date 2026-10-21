import {
  appendFileSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareHook } from '../src/prepare-hook.ts';
import { COMMAND_ARGS, MUTATING_TOOLS, SHELL_TOOLS } from '../src/session-vocabulary.ts';

const SESSION_ID = 's-1';
const TARGET_FILE = 'gate/inner.txt';
const PRE_STATE = 'locked: yes\n';
let repoRoot: string;
let outside: string;
beforeEach(() => {
  repoRoot = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-observed-hook-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-observed-outside-')));
});
afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});
function writeTarget(content = PRE_STATE): string {
  const path = join(repoRoot, TARGET_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}
function checkedInput(result: ReturnType<typeof prepareHook>): CovenantInput {
  expect(result.outcome).toBe('check');
  if (result.outcome !== 'check') throw new Error('expected observed input');
  return result.input;
}
function editPayload(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: 'PreToolUse',
    session_id: SESSION_ID,
    cwd: repoRoot,
    tool_name: 'Edit',
    tool_input: {
      file_path: join(repoRoot, TARGET_FILE),
      old_string: 'locked: yes',
      new_string: 'locked: no',
    },
    ...extra,
  });
}

/** A human-typed transcript line beside which a sidecar directory can sit. */
function writeTranscript(): string {
  const path = join(outside, `${SESSION_ID}.jsonl`);
  writeFileSync(
    path,
    `${JSON.stringify({
      origin: { kind: 'human' },
      promptSource: 'typed',
      type: 'user',
      message: { role: 'user', content: 'carry on' },
      timestamp: new Date().toISOString(),
      uuid: 'u-human',
    })}\n`,
  );
  return path;
}

describe('prepareHook — observed input', () => {
  it('returns an IR carrying the host roster and the Edit’s file-change evidence', () => {
    writeTarget();

    const result = prepareHook({ repoRoot, rawPayload: editPayload() });

    const ir = checkedInput(result);
    expect(ir.tools).toEqual({
      mutating: MUTATING_TOOLS,
      shell: SHELL_TOOLS,
      commandArgs: COMMAND_ARGS,
    });
    expect(ir.toolCalls[0]?.name).toBe('Edit');
    expect(ir.toolCalls[0]?.fileChange).toMatchObject({ path: TARGET_FILE, pre: PRE_STATE });
  });

  it('leaves fileChange absent, not null, when the Edit has no computable evidence', () => {
    const result = prepareHook({ repoRoot, rawPayload: editPayload() });

    const ir = checkedInput(result);
    expect(ir.toolCalls).toHaveLength(1);
    expect('fileChange' in (ir.toolCalls[0] as object)).toBe(false);
  });

  it('carries the session evidence under `session` when the payload names a transcript', () => {
    writeTarget();
    const transcript = writeTranscript();

    const result = prepareHook({
      repoRoot,
      rawPayload: editPayload({ transcript_path: transcript }),
    });

    const ir = checkedInput(result);
    expect(ir.session?.evidencePath).toBe(transcript);
    expect(ir.session?.userMessages.map((message) => message.text)).toEqual(['carry on']);
  });

  it('omits the `session` key entirely when the payload names no transcript', () => {
    writeTarget();

    const result = prepareHook({ repoRoot, rawPayload: editPayload() });

    expect('session' in checkedInput(result)).toBe(false);
  });

  it('carries an empty session with the evidencePath when the named transcript does not exist', () => {
    writeTarget();
    const missing = join(outside, `${SESSION_ID}.jsonl`);

    const result = prepareHook({
      repoRoot,
      rawPayload: editPayload({ transcript_path: missing }),
    });

    expect(result.outcome).toBe('check');
    const ir = checkedInput(result);
    expect(ir.session).toEqual({ evidencePath: missing, userMessages: [], toolCalls: [] });
  });
});

describe('prepareHook — a call made inside a subagent', () => {
  it('returns the subagent’s own tool calls, not the parent’s', () => {
    const agentId = 'a7b52c110d65a4668';
    const SUBAGENT_SHELL = 'Bash';

    writeTarget();
    const transcript = writeTranscript();
    appendFileSync(
      transcript,
      `${JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_p',
              name: SUBAGENT_SHELL,
              input: { command: 'parent-run' },
            },
          ],
        },
        uuid: 'a-parent',
      })}\n`,
    );
    const record = join(outside, SESSION_ID, 'subagents', `agent-${agentId}.jsonl`);
    mkdirSync(dirname(record), { recursive: true });
    writeFileSync(
      record,
      `${[
        {
          type: 'assistant',
          message: {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'toolu_s',
                name: SUBAGENT_SHELL,
                input: { command: 'subagent-run' },
              },
            ],
          },
          uuid: 'a-sub',
        },
        {
          type: 'user',
          message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: 'toolu_s', content: 'ok' }],
          },
          uuid: 'u-sub',
        },
      ]
        .map((entry) => JSON.stringify(entry))
        .join('\n')}\n`,
    );

    const result = prepareHook({
      repoRoot,
      rawPayload: editPayload({ transcript_path: transcript, agent_id: agentId }),
    });

    const session = checkedInput(result).session as
      | { evidencePath: string; toolCalls: unknown[] }
      | undefined;
    expect(session?.evidencePath).toBe(transcript);
    expect(session?.toolCalls).toEqual([
      { name: SUBAGENT_SHELL, args: { command: 'subagent-run' }, succeeded: true },
    ]);
  });
});

describe('prepareHook — unavailable evidence', () => {
  /** Runs one failing payload through the seam and returns the reason text after the prefix. */
  function expectFailureSpawn(rawPayload: string): string {
    const result = prepareHook({ repoRoot, rawPayload });
    expect(result.outcome).toBe('unavailable');
    if (result.outcome !== 'unavailable') throw new Error('expected unavailable input');
    expect(result.reason.length).toBeGreaterThan(0);
    return result.reason;
  }

  /** A transcript with a sidecar directory beside it that no mode can read. */
  function writeRefusedSidecar(): { transcript: string; subagents: string } {
    const transcript = writeTranscript();
    const subagents = join(outside, SESSION_ID, 'subagents');
    mkdirSync(subagents, { recursive: true });
    writeFileSync(join(subagents, 'agent-001.meta.json'), '{"agentType":"x","toolUseId":"t"}');
    chmodSync(subagents, 0o000);
    return { transcript, subagents };
  }

  it('an unparseable payload', () => {
    expectFailureSpawn('{');
  });

  it('an envelope the translator does not recognise', () => {
    expectFailureSpawn('{}');
  });

  it.skipIf(process.getuid?.() === 0)('a pre-state read refused by permissions', () => {
    const target = writeTarget();
    chmodSync(target, 0o000);
    try {
      expectFailureSpawn(editPayload());
    } finally {
      chmodSync(target, 0o600);
    }
  });

  it.skipIf(process.getuid?.() === 0)('a sidecar directory refused by permissions', () => {
    writeTarget();
    const { transcript, subagents } = writeRefusedSidecar();
    try {
      expectFailureSpawn(editPayload({ transcript_path: transcript }));
    } finally {
      chmodSync(subagents, 0o700);
    }
  });

  it.skipIf(process.getuid?.() === 0)(
    'names each of the four failures with its own non-empty reason',
    () => {
      const reasons: string[] = [];

      reasons.push(expectFailureSpawn('{'));
      reasons.push(expectFailureSpawn('{}'));

      const target = writeTarget();
      chmodSync(target, 0o000);
      try {
        reasons.push(expectFailureSpawn(editPayload()));
      } finally {
        chmodSync(target, 0o600);
      }

      const { transcript, subagents } = writeRefusedSidecar();
      try {
        reasons.push(expectFailureSpawn(editPayload({ transcript_path: transcript })));
      } finally {
        chmodSync(subagents, 0o700);
      }

      expect(reasons).toHaveLength(4);
      for (const reason of reasons) expect(reason.length).toBeGreaterThan(0);
      expect(new Set(reasons).size).toBe(4);
    },
  );
});
