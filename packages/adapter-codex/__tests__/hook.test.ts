import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { type CovenantInput, parseInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareHook } from '../src/prepare-hook.ts';

const APPLY_PATCH = 'apply_patch';
const BASH = 'Bash';
const COMMAND_ARG = 'command';
const OTHER_FILE = 'notes/other.txt';
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
function writeFixture(relative: string, content = PRE_STATE): string {
  const path = join(repoRoot, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return path;
}
function checkedInput(result: ReturnType<typeof prepareHook>): CovenantInput {
  expect(result.outcome).toBe('check');
  if (result.outcome !== 'check') throw new Error('expected observed input');
  return result.input;
}
function expectCodexRoster(ir: CovenantInput) {
  expect(ir.tools).toEqual({
    mutating: [APPLY_PATCH],
    shell: [BASH],
    commandArgs: [COMMAND_ARG],
  });
  expect('actor' in ir).toBe(false);
}

function envelope(
  toolName: string,
  toolInput: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    cwd: repoRoot,
    hook_event_name: 'PreToolUse',
    model: 'gpt-5.3-codex',
    permission_mode: 'default',
    session_id: 'sess-1',
    tool_input: toolInput,
    tool_name: toolName,
    tool_use_id: 'call-1',
    transcript_path: join(repoRoot, 'transcript.jsonl'),
    turn_id: 'turn-1',
    ...overrides,
  };
}

function patchText(...hunks: string[][]): string {
  return ['*** Begin Patch', ...hunks.flat(), '*** End Patch', ''].join('\n');
}

function addHunk(path: string, ...lines: string[]): string[] {
  return [`*** Add File: ${path}`, ...lines.map((line) => `+${line}`)];
}

function patchPayload(patch: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify(envelope(APPLY_PATCH, { command: patch }, overrides));
}

function bashPayload(command: string): string {
  return JSON.stringify(envelope(BASH, { command }));
}

/** The real path a target resolves to when the target itself does not exist yet. */
function realTargetPath(target: string): string {
  const rest: string[] = [];
  let existing = target;
  for (;;) {
    try {
      return join(realpathSync(existing), ...rest);
    } catch {
      rest.unshift(basename(existing));
      existing = dirname(existing);
    }
  }
}

describe('prepareHook — observed input', () => {
  it('returns a protocol-valid IR with the Codex roster, the apply_patch name, and an empty named session', () => {
    const result = prepareHook({
      repoRoot,
      rawPayload: patchPayload(patchText(addHunk(OTHER_FILE, 'x'))),
    });

    expect(parseInput(JSON.stringify(checkedInput(result))).ok).toBe(true);
    const ir = checkedInput(result);
    expectCodexRoster(ir);
    expect(ir.toolCalls).toHaveLength(1);
    expect(ir.toolCalls[0]?.name).toBe(APPLY_PATCH);
    expect(ir.session).toEqual({
      evidencePath: expect.stringMatching(/\.polydeukes\/codex-sessions\/[a-f0-9]{64}\.jsonl$/),
      userMessages: [],
      toolCalls: [],
    });
  });
});

describe('prepareHook — apply_patch evidence, one element per file', () => {
  it('carries the repoRoot-relative path when the cwd is a subdirectory, and reads the pre-state at the cwd-resolved absolute path', () => {
    writeFixture(TARGET_FILE);

    const result = prepareHook({
      repoRoot,
      rawPayload: patchPayload(
        patchText(['*** Update File: inner.txt', '@@', '-locked: yes', '+locked: no']),
        { cwd: join(repoRoot, 'gate') },
      ),
    });

    expect(checkedInput(result).toolCalls[0]?.fileChange).toEqual({
      kind: 'modify',
      path: TARGET_FILE,
      pre: PRE_STATE,
      post: 'locked: no\n',
    });
  });

  it('relativizes an absolute patch path to repoRoot as well', () => {
    const result = prepareHook({
      repoRoot,
      rawPayload: patchPayload(patchText(addHunk(join(repoRoot, OTHER_FILE), 'x')), {
        cwd: join(repoRoot, 'gate'),
      }),
    });

    expect(checkedInput(result).toolCalls[0]?.fileChange).toEqual({
      kind: 'create',
      path: OTHER_FILE,
      post: 'x\n',
    });
  });

  it('lands N files as N toolCalls elements in one IR, in patch order, each with its own evidence, in one observation', () => {
    writeFixture(TARGET_FILE);

    const result = prepareHook({
      repoRoot,
      rawPayload: patchPayload(
        patchText(addHunk(OTHER_FILE, 'harmless'), [`*** Delete File: ${TARGET_FILE}`]),
      ),
    });

    expect(result.outcome).toBe('check');

    const ir = checkedInput(result);
    expect(parseInput(JSON.stringify(checkedInput(result))).ok).toBe(true);
    expectCodexRoster(ir);
    expect(ir.toolCalls.map((call) => call.name)).toEqual([APPLY_PATCH, APPLY_PATCH]);
    expect(ir.toolCalls.map((call) => call.fileChange)).toEqual([
      { kind: 'create', path: OTHER_FILE, post: 'harmless\n' },
      { kind: 'delete', path: TARGET_FILE, pre: PRE_STATE },
    ]);
  });

  it('lands a `Move to` as two elements — the source’s delete and the destination’s create', () => {
    writeFixture(TARGET_FILE);

    const result = prepareHook({
      repoRoot,
      rawPayload: patchPayload(
        patchText([`*** Update File: ${TARGET_FILE}`, `*** Move to: ${OTHER_FILE}`]),
      ),
    });

    const ir = checkedInput(result);
    expect(ir.toolCalls.map((call) => call.name)).toEqual([APPLY_PATCH, APPLY_PATCH]);
    expect(ir.toolCalls.map((call) => call.fileChange)).toEqual([
      { kind: 'delete', path: TARGET_FILE, pre: PRE_STATE },
      { kind: 'create', path: OTHER_FILE, post: PRE_STATE },
    ]);
  });
});

describe('prepareHook — file targets outside repoRoot', () => {
  it.each([
    ['a relative path climbing out of the root', () => '../outside.txt'],
    ['an absolute path beside the root', () => `${repoRoot}-sibling/outside.txt`],
  ])('carries the target as its absolute real path — %s', (_title, targetName) => {
    // Refusing an outside target, or relativizing it instead of carrying the absolute
    // real path, would turn ordinary writes into unavailable evidence.
    const target = resolve(repoRoot, targetName());

    const result = prepareHook({
      repoRoot,
      rawPayload: patchPayload(patchText(addHunk(target, 'x'))),
    });

    expect(result.outcome).toBe('check');
    expect(checkedInput(result).toolCalls[0]?.fileChange).toEqual({
      kind: 'create',
      path: realTargetPath(target),
      post: 'x\n',
    });
  });
});

describe('prepareHook — Bash rides the shell axis', () => {
  it('carries the command in args, no fileChange, and the Bash name on the shell roster', () => {
    const result = prepareHook({ repoRoot, rawPayload: bashPayload(`rm ${TARGET_FILE}`) });

    const ir = checkedInput(result);
    expectCodexRoster(ir);
    expect(ir.toolCalls).toHaveLength(1);
    expect(ir.toolCalls[0]?.name).toBe(BASH);
    expect(ir.toolCalls[0]?.args).toEqual({ command: `rm ${TARGET_FILE}` });
    expect('fileChange' in (ir.toolCalls[0] as object)).toBe(false);
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

  it('an unparseable payload', () => {
    expect(expectFailureSpawn('{')).toMatch(/payload|JSON/i);
  });

  it('a camelCase envelope — this host has one spelling and the other is refused', () => {
    const camel = {
      cwd: repoRoot,
      hookEventName: 'PreToolUse',
      model: 'gpt-5.3-codex',
      permissionMode: 'default',
      sessionId: 'sess-1',
      toolInput: { command: patchText(addHunk(OTHER_FILE, 'x')) },
      toolName: APPLY_PATCH,
      toolUseId: 'call-1',
      transcriptPath: join(repoRoot, 'transcript.jsonl'),
      turnId: 'turn-1',
    };

    expectFailureSpawn(JSON.stringify(camel));
  });

  it('an event outside the registered lifecycle', () => {
    expectFailureSpawn(
      patchPayload(patchText(addHunk(OTHER_FILE, 'x')), { hook_event_name: 'Notification' }),
    );
  });

  it('a patch the grammar refuses — the reason names the patch, not the envelope', () => {
    const reason = expectFailureSpawn(patchPayload('*** Begin Patch\n*** End Patch\n'));

    expect(reason).toMatch(/patch/i);
  });

  it.skipIf(process.getuid?.() === 0)('a pre-state read refused by permissions', () => {
    const target = writeFixture(TARGET_FILE);
    chmodSync(target, 0o000);
    try {
      expectFailureSpawn(patchPayload(patchText([`*** Delete File: ${TARGET_FILE}`])));
    } finally {
      chmodSync(target, 0o600);
    }
  });

  it('a `Delete File` whose target the reader does not find', () => {
    expectFailureSpawn(patchPayload(patchText([`*** Delete File: ${TARGET_FILE}`])));
  });

  it.each([
    ['tool_input a string', () => ({ tool_input: '*** Begin Patch\n*** End Patch\n' })],
    ['tool_name a number', () => ({ tool_name: 7 })],
    ['cwd an array', () => ({ cwd: [repoRoot] })],
    ['hook_event_name null', () => ({ hook_event_name: null })],
    ['tool_input.command a number', () => ({ tool_input: { command: 42 } })],
  ])('a required value of the wrong type — %s', (_title, overrides) => {
    expectFailureSpawn(patchPayload(patchText(addHunk(OTHER_FILE, 'x')), overrides()));
  });

  it('names each failure with its own non-empty reason', () => {
    const reasons = [
      expectFailureSpawn('{'),
      expectFailureSpawn('{}'),
      expectFailureSpawn(patchPayload('*** Begin Patch\n*** End Patch\n')),
    ];

    for (const reason of reasons) expect(reason.length).toBeGreaterThan(0);
    expect(new Set(reasons).size).toBe(3);
  });
});

describe('prepareHook native consumed fields and tool names', () => {
  it.each(['cwd', 'hook_event_name', 'session_id', 'tool_input', 'tool_name'])(
    'refuses a missing consumed field %s',
    (key) => {
      const raw = envelope(APPLY_PATCH, { command: patchText(addHunk(OTHER_FILE, 'x')) });
      delete raw[key];
      expect(prepareHook({ repoRoot, rawPayload: JSON.stringify(raw) })).toMatchObject({
        outcome: 'unavailable',
        reason: expect.any(String),
      });
    },
  );
  it.each(['exec', 'code_mode_exec', 'web_search', 'bash'])(
    'refuses tool %s without creating a judged IR',
    (toolName) => {
      const rawPayload = JSON.stringify(
        envelope(toolName, { command: 'await tools.apply_patch("text")' }),
      );
      const result = prepareHook({ repoRoot, rawPayload });
      expect(result.outcome).toBe('unavailable');
      if (result.outcome !== 'unavailable') throw new Error('expected unavailable tool');
      expect(result.reason).toContain(toolName);
    },
  );
});
