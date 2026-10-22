import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCovenantCheck } from '../src/covenant-check.ts';
import { scaffoldProject } from '../src/scaffold-project.ts';
import { telemetryRows } from './helpers.ts';

/** Injected fixture values — the host tool name and the default entries under test. */
const WRITE_TOOL = 'write-tool';
const CODEX_CONFIG = '.codex/config.toml';
const CLAUDE_LOCAL_SETTINGS = '.claude/settings.local.json';
const TELEMETRY_FILE = 'roi.log';
const SELF_MOD_LABEL = 'self-mod';

let base: string;
let projectRoot: string;
let fakeHome: string;
let telemetryPath: string;

beforeEach(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'pdks-host-config-')));
  projectRoot = join(base, 'project');
  fakeHome = join(base, 'home');
  telemetryPath = join(base, TELEMETRY_FILE);
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(fakeHome, { recursive: true });
  scaffoldProject(projectRoot);
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

/** One absolute-path write by the host's mutating tool. */
function writeCall(path: string): CovenantInput['toolCalls'][number] {
  return {
    name: WRITE_TOOL,
    args: { file_path: path, content: 'new text\n' },
    fileChange: { kind: 'create', path, post: 'new text\n' },
  };
}

/** The session surface's input with only the mutating roster — no shell axis. */
function sessionInput(path: string): CovenantInput {
  return {
    toolCalls: [writeCall(path)],
    subagentSpawns: [],
    userMessages: [],
    tools: { mutating: [WRITE_TOOL], shell: [], commandArgs: [] },
  };
}

function judge(path: string) {
  return runCovenantCheck({
    surface: 'session',
    repoRoot: projectRoot,
    input: sessionInput(path),
    telemetryPath,
    enforce: 'block',
  });
}

describe('generated config protects host configuration files outside the project', () => {
  it.each([
    ['Codex', CODEX_CONFIG],
    ['Claude', CLAUDE_LOCAL_SETTINGS],
  ])('blocks a write to the home %s configuration file', async (_name, entry) => {
    // A protected entry matches any path whose segments contain it, whether the path is
    // inside the project or under the home directory; a list missing it, or a comparison
    // that is not segment-wise, lets an agent rewrite the host gate itself.
    const target = join(fakeHome, entry);

    const result = await judge(target);

    expect(result.exitCode).toBe(2);
    expect(telemetryRows(telemetryPath)).toEqual([['blocked', SELF_MOD_LABEL, entry]]);
  });

  it('does not block an ordinary file outside the project', async () => {
    // A segment match protects a file only when its path actually contains the entry; an
    // over-broad match sends ordinary scratchpad writes to the witness valve.
    const elsewhere = join(base, 'elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    const target = join(elsewhere, 'notes.txt');
    writeFileSync(target, 'ordinary\n');

    const result = await judge(target);

    expect(result.exitCode).toBe(0);
    expect(telemetryRows(telemetryPath).filter(([event]) => event === 'blocked')).toEqual([]);
  });
});
