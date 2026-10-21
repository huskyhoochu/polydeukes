import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { type CovenantInput, parseInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { prepareHook } from '../src/prepare-hook.ts';

const WRITE = 'write';
const SEARCH_REPLACE = 'search_replace';
const RUN = 'run_terminal_command';
const COMMAND_ARG = 'command';
const WRITE_CONTENT = 'unlocked: now\n';
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
function expectGrokRoster(ir: CovenantInput) {
  expect(ir.tools).toEqual({
    mutating: [WRITE, SEARCH_REPLACE],
    shell: [RUN],
    commandArgs: [COMMAND_ARG],
  });
  expect('session' in ir).toBe(false);
  expect('actor' in ir).toBe(false);
}

function writePayload(filePath: string, content: string): string {
  return JSON.stringify({
    hookEventName: 'pre_tool_use',
    toolName: WRITE,
    toolInput: { file_path: filePath, content },
  });
}

function dualKeyWritePayload(filePath: string, content: string): string {
  // Live host envelopes carry both spellings together, with the same Grok name in each.
  return JSON.stringify({
    hookEventName: 'pre_tool_use',
    toolName: WRITE,
    tool_name: WRITE,
    toolInput: { file_path: filePath, content },
    tool_input: { file_path: filePath, content },
  });
}

function searchReplacePayload(
  filePath: string,
  oldString: string,
  newString: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    hookEventName: 'pre_tool_use',
    toolName: SEARCH_REPLACE,
    toolInput: { file_path: filePath, old_string: oldString, new_string: newString, ...extra },
  });
}

function shellPayload(command: string): string {
  return JSON.stringify({
    hookEventName: 'pre_tool_use',
    toolName: RUN,
    toolInput: { command },
  });
}

describe('prepareHook — observed input', () => {
  it('returns a protocol-valid IR with the Grok roster, the write name, and no session or actor', () => {
    const target = writeTarget();

    const result = prepareHook({ repoRoot, rawPayload: writePayload(target, WRITE_CONTENT) });

    const stdin = JSON.stringify(checkedInput(result));
    expect(parseInput(stdin).ok).toBe(true);
    const ir = checkedInput(result);
    expectGrokRoster(ir);
    expect(ir.toolCalls[0]?.name).toBe(WRITE);
    expect(ir.toolCalls[0]?.args).toMatchObject({ file_path: target, content: WRITE_CONTENT });
  });

  it('builds the same name and roster from a dual-key envelope as from camelCase-only', () => {
    const target = writeTarget();

    const result = prepareHook({
      repoRoot,
      rawPayload: dualKeyWritePayload(target, WRITE_CONTENT),
    });

    const ir = checkedInput(result);
    expectGrokRoster(ir);
    expect(ir.toolCalls[0]?.name).toBe(WRITE);
  });

  it('prefers camelCase toolInput when a dual-key envelope carries both input objects', () => {
    const camelPath = writeTarget();
    const snakePath = join(repoRoot, 'gate/snake.txt');
    mkdirSync(dirname(snakePath), { recursive: true });
    writeFileSync(snakePath, 'snake-pre\n');

    const result = prepareHook({
      repoRoot,
      rawPayload: JSON.stringify({
        hookEventName: 'pre_tool_use',
        toolName: WRITE,
        tool_name: WRITE,
        toolInput: { file_path: camelPath, content: WRITE_CONTENT },
        tool_input: { file_path: snakePath, content: 'snake-content-must-not-win' },
      }),
    });

    const ir = checkedInput(result);
    expect(ir.toolCalls[0]?.name).toBe(WRITE);
    expect(ir.toolCalls[0]?.fileChange).toEqual({
      kind: 'modify',
      path: TARGET_FILE,
      pre: PRE_STATE,
      post: WRITE_CONTENT,
    });
  });
});

describe('prepareHook — write, search_replace, and shell evidence', () => {
  it('attaches create evidence for a write whose target is absent', () => {
    const target = join(repoRoot, TARGET_FILE);

    const result = prepareHook({ repoRoot, rawPayload: writePayload(target, WRITE_CONTENT) });

    const ir = checkedInput(result);
    expect(ir.toolCalls[0]?.fileChange).toEqual({
      kind: 'create',
      path: TARGET_FILE,
      post: WRITE_CONTENT,
    });
  });

  it('attaches substituted modify evidence for a search_replace with one match', () => {
    const target = writeTarget();

    const result = prepareHook({
      repoRoot,
      rawPayload: searchReplacePayload(target, 'locked: yes', 'locked: no'),
    });

    const ir = checkedInput(result);
    expectGrokRoster(ir);
    expect(ir.toolCalls[0]?.name).toBe(SEARCH_REPLACE);
    expect(ir.toolCalls[0]?.fileChange).toEqual({
      kind: 'modify',
      path: TARGET_FILE,
      pre: PRE_STATE,
      post: 'locked: no\n',
    });
  });

  it('omits fileChange when search_replace old_string occurs zero times', () => {
    const target = writeTarget();

    const result = prepareHook({
      repoRoot,
      rawPayload: searchReplacePayload(target, 'absent-token', 'locked: no'),
    });

    const call = checkedInput(result).toolCalls[0] as object;
    expect('fileChange' in call).toBe(false);
  });

  it('omits fileChange when search_replace old_string occurs twice and replace_all is absent', () => {
    const target = writeTarget('alpha and alpha\n');

    const result = prepareHook({
      repoRoot,
      rawPayload: searchReplacePayload(target, 'alpha', 'beta'),
    });

    const call = checkedInput(result).toolCalls[0] as object;
    expect('fileChange' in call).toBe(false);
  });

  it('replaces every occurrence when search_replace carries replace_all true', () => {
    const target = writeTarget('alpha and alpha\n');

    const result = prepareHook({
      repoRoot,
      rawPayload: searchReplacePayload(target, 'alpha', 'beta', { replace_all: true }),
    });

    expect(checkedInput(result).toolCalls[0]?.fileChange).toEqual({
      kind: 'modify',
      path: TARGET_FILE,
      pre: 'alpha and alpha\n',
      post: 'beta and beta\n',
    });
  });

  it('inserts new_string literally — $-replacement patterns are never expanded', () => {
    const target = writeTarget('foo\n');

    const result = prepareHook({
      repoRoot,
      rawPayload: searchReplacePayload(target, 'foo', '$&bar'),
    });

    expect(checkedInput(result).toolCalls[0]?.fileChange).toEqual({
      kind: 'modify',
      path: TARGET_FILE,
      pre: 'foo\n',
      post: '$&bar\n',
    });
  });

  it('omits fileChange for run_terminal_command and puts that name on the shell roster', () => {
    const result = prepareHook({ repoRoot, rawPayload: shellPayload('echo hi') });

    const ir = checkedInput(result);
    expectGrokRoster(ir);
    expect(ir.toolCalls[0]?.name).toBe(RUN);
    expect(ir.toolCalls[0]?.args).toEqual({ command: 'echo hi' });
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
    expectFailureSpawn('{');
  });

  it('an envelope the translator does not recognise', () => {
    expectFailureSpawn('{}');
  });

  it.skipIf(process.getuid?.() === 0)('a pre-state read refused by permissions', () => {
    const target = writeTarget();
    chmodSync(target, 0o000);
    try {
      expectFailureSpawn(writePayload(target, WRITE_CONTENT));
    } finally {
      chmodSync(target, 0o600);
    }
  });

  it.skipIf(process.getuid?.() === 0)(
    'names each of the three failures with its own non-empty reason',
    () => {
      const reasons: string[] = [];

      reasons.push(expectFailureSpawn('{'));
      reasons.push(expectFailureSpawn('{}'));

      const target = writeTarget();
      chmodSync(target, 0o000);
      try {
        reasons.push(expectFailureSpawn(writePayload(target, WRITE_CONTENT)));
      } finally {
        chmodSync(target, 0o600);
      }

      expect(reasons).toHaveLength(3);
      for (const reason of reasons) expect(reason.length).toBeGreaterThan(0);
      expect(new Set(reasons).size).toBe(3);
    },
  );
});
