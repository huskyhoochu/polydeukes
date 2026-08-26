// The parity net over both surfaces, each observed from OUTSIDE the process — a real
// hook spawn and a real bin spawn — so the stderr expectations hold regardless of how
// the judges write their reasons internally.
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BASELINE_FIRST_RUN_ROW, telemetryRows } from './helpers';

const repoRoot = resolve(import.meta.dirname, '../../..');
const hookPath = join(repoRoot, '.claude/hooks/covenant-pretooluse.mjs');
const BIN = resolve(import.meta.dirname, '../dist/bin.js');

// Injected fixture values. The protected entry is nested so the telemetry subject
// (the matched ENTRY) can never coincide with a judged file path; the discipline set
// covers three families so one sequence exercises meta-covenants AND disciplines.
const PROTECTED_ENTRY = '.git/hooks';
const DELTA_ID = 'no-todo';
const COMMAND_ID = 'hooks-armed';
const CONTEXT_ID = 'needs-precedent';
const CONTEXT_TOOL = 'WebFetch';
const DISCIPLINE_SCOPE = 'lib/**/*.ts';
const SCOPED_TARGET = 'lib/a.ts';
const DELTA_WHY = 'todos rot in place';
/** The block reason the session surface must keep emitting byte-for-byte. */
const BLOCK_REASON = `Write would modify protected path ${PROTECTED_ENTRY}/pre-commit\n`;

const DISCIPLINES = [
  { id: DELTA_ID, forbid: { added: 'TODO' }, in: DISCIPLINE_SCOPE, why: DELTA_WHY },
  { id: COMMAND_ID, forbidCommand: 'zzz_probe_cmd', why: 'the probe reshapes unseen state' },
  { id: CONTEXT_ID, requirePrecedent: { tool: CONTEXT_TOOL }, in: DISCIPLINE_SCOPE },
];

let tmpRoot: string;
let telemetryPath: string;

beforeAll(() => {
  // The hook and the bin import built dist; turbo caching makes repeat runs fast.
  execSync('pnpm turbo run build', { cwd: repoRoot, stdio: 'pipe' });
}, 240_000);

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'pdks-dispatch-parity-'));
  telemetryPath = join(tmpRoot, 'roi.log');
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

const rows = () => telemetryRows(telemetryPath);

/** A transcript carrying ONE successful CONTEXT_TOOL call — the context entry's evidence. */
function transcriptWithPrecedent(): string {
  const path = join(tmpRoot, 'session.jsonl');
  const lines = [
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          {
            type: 'tool_use',
            id: 'tu-1',
            name: CONTEXT_TOOL,
            input: { url: 'https://example.com' },
          },
        ],
      },
    }),
    JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' }],
      },
    }),
  ];
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

/** Copy the real hook into a fixture tree carrying the parity config, spawn it on `payload`. */
function runHook(payload: Record<string, unknown>) {
  const fixtureRoot = join(tmpRoot, 'fixture-tree');
  mkdirSync(join(fixtureRoot, '.claude', 'hooks'), { recursive: true });
  cpSync(hookPath, join(fixtureRoot, '.claude', 'hooks', 'covenant-pretooluse.mjs'));
  symlinkSync(join(repoRoot, 'packages'), join(fixtureRoot, 'packages'), 'dir');
  symlinkSync(join(repoRoot, 'node_modules'), join(fixtureRoot, 'node_modules'), 'dir');
  writeFileSync(
    join(fixtureRoot, 'polydeukes.config.json'),
    JSON.stringify(
      {
        languages: { typescript: { productionGlob: DISCIPLINE_SCOPE, testCmd: 'echo {scope}' } },
        telemetry: { logPath: telemetryPath },
        protectedPaths: [PROTECTED_ENTRY],
        disciplines: DISCIPLINES,
      },
      null,
      2,
    ),
  );
  return spawnSync(
    process.execPath,
    [join(fixtureRoot, '.claude', 'hooks', 'covenant-pretooluse.mjs')],
    {
      cwd: fixtureRoot,
      input: JSON.stringify({ cwd: fixtureRoot, ...payload }),
      encoding: 'utf-8',
      env: { ...process.env, POLYDEUKES_TELEMETRY_PATH: telemetryPath },
    },
  );
}

describe('DISPATCH-01 AC-1 ① — session surface, passing payload (measured pre-conversion)', () => {
  it('a scoped Write mentioning the protected entry passes every matched registration: exit 0, four passed rows in registration order', () => {
    // Order, labels, and subjects are all load-bearing here.
    const transcript = transcriptWithPrecedent();
    const result = runHook({
      hook_event_name: 'PreToolUse',
      session_id: 's-1',
      tool_name: 'Write',
      tool_input: {
        file_path: SCOPED_TARGET,
        content: `// see ${PROTECTED_ENTRY} before touching this\nexport const y = 2;\n`,
      },
      transcript_path: transcript,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['passed', 'self-mod', PROTECTED_ENTRY],
      ['passed', 'shell-mod', PROTECTED_ENTRY],
      ['passed', DELTA_ID, SCOPED_TARGET],
      ['passed', CONTEXT_ID, SCOPED_TARGET],
    ]);
  });

  it('a scoped shell append mentioning the protected entry read-only lands the skipped pair: exit 0, two passed + two skipped', () => {
    // A skipped row turning into a pass with NO row is the defect class: the recorded
    // absence of a judgment is not a pass.
    const transcript = transcriptWithPrecedent();
    const result = runHook({
      hook_event_name: 'PreToolUse',
      session_id: 's-1',
      tool_name: 'Bash',
      tool_input: { command: `cat ${PROTECTED_ENTRY}/pre-commit >> ${SCOPED_TARGET}` },
      transcript_path: transcript,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['passed', 'self-mod', PROTECTED_ENTRY],
      ['passed', 'shell-mod', PROTECTED_ENTRY],
      ['skipped', DELTA_ID, SCOPED_TARGET],
      ['skipped', CONTEXT_ID, SCOPED_TARGET],
    ]);
  });
});

describe('DISPATCH-01 AC-1 ② — session surface, blocking payload (measured pre-conversion)', () => {
  it('a Write targeting a protected file blocks: exit 2, blocked self-mod then passed shell-mod, the reason verbatim on stderr', () => {
    // The reason reaches stderr verbatim — never reformatted, dropped, or written twice.
    const result = runHook({
      hook_event_name: 'PreToolUse',
      session_id: 's-1',
      tool_name: 'Write',
      tool_input: { file_path: `${PROTECTED_ENTRY}/pre-commit`, content: '#!/bin/sh\nexit 0\n' },
    });

    expect(result.status).toBe(2);
    expect(result.stderr).toBe(BLOCK_REASON);
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['blocked', 'self-mod', PROTECTED_ENTRY],
      ['passed', 'shell-mod', PROTECTED_ENTRY],
    ]);
  });
});

/** Build a throwaway commit repo with `config` keys, stage an initial-then-edited scoped file, run the bin. */
function runCommitCheck(config: Record<string, unknown>, editedContent: string) {
  const projectRoot = join(tmpRoot, 'commit-repo');
  mkdirSync(projectRoot, { recursive: true });
  const git = (...args: string[]): string =>
    execFileSync('git', args, { cwd: projectRoot, encoding: 'utf-8' });
  git('init', '--quiet');
  git('config', 'user.email', 'test@polydeukes.local');
  git('config', 'user.name', 'Polydeukes Test');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(
    join(projectRoot, 'polydeukes.config.json'),
    JSON.stringify({
      languages: { typescript: { productionGlob: DISCIPLINE_SCOPE, testCmd: 'echo {scope}' } },
      telemetry: { logPath: telemetryPath },
      ...config,
    }),
  );
  const target = join(projectRoot, SCOPED_TARGET);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, 'export const y = 1;\n');
  git('add', SCOPED_TARGET, 'polydeukes.config.json');
  git('commit', '--quiet', '-m', 'initial');
  writeFileSync(target, editedContent);
  git('add', SCOPED_TARGET);

  return spawnSync(process.execPath, [BIN, 'covenant', 'check'], {
    cwd: projectRoot,
    encoding: 'utf-8',
  });
}

describe('DISPATCH-01 AC-1 ③ — commit surface advise translation (the domain W1 never measured)', () => {
  it('a staged delta violation under adapters.git advise: exit 0, ONE advised row, the why line and the advisory summary verbatim on stderr', () => {
    // Advise is not mute: the reason line, the entry's `why`, and one advisory summary
    // all reach stderr.
    const result = runCommitCheck(
      {
        disciplines: [
          { id: DELTA_ID, forbid: { added: 'TODO' }, in: DISCIPLINE_SCOPE, why: DELTA_WHY },
        ],
        adapters: { git: { enforce: 'advise' } },
      },
      'export const y = 1;\n// TODO: later\n',
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe(
      `discipline '${DELTA_ID}' broken on ${SCOPED_TARGET}: edit adds new forbidden match(es): TODO — why: ${DELTA_WHY}\n` +
        'covenant advisory: 1 verdict(s) recorded as advised, commit allowed\n',
    );
    expect(rows()).toEqual([['advised', DELTA_ID, SCOPED_TARGET]]);
  });

  it('a requirePrecedent discipline on a matched staged change records ONE skipped row (exit 0, silent)', () => {
    // The commit surface's permanent no-transcript condition must stay a recorded skip:
    // neither a block, nor a pass with NO row.
    const result = runCommitCheck(
      {
        disciplines: [
          { id: CONTEXT_ID, requirePrecedent: { tool: CONTEXT_TOOL }, in: DISCIPLINE_SCOPE },
        ],
      },
      'export const y = 2;\n',
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(rows()).toEqual([['skipped', CONTEXT_ID, SCOPED_TARGET]]);
  });
});
