// The parity net over both surfaces, each observed from OUTSIDE the process — a real
// hook spawn and a real bin spawn — so the stderr expectations hold regardless of how
// the judges write their reasons internally.
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { TelemetryRecord } from '@polydeukes/core';
import { readRecords } from '@polydeukes/core';
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
const CONTEXT_ID = 'needs-precedent';
const CONTEXT_TOOL = 'WebFetch';
const SESSION = 'session';
const DISCIPLINE_SCOPE = 'lib/**/*.ts';
const DISCIPLINE_SCOPE_RE = '^lib/.*\\.ts$';
const SCOPED_TARGET = 'lib/a.ts';
const DELTA_WHY = 'todos rot in place';
/** The block reason the session surface must keep emitting byte-for-byte. */
const BLOCK_REASON = `Write would modify protected path ${PROTECTED_ENTRY}/pre-commit\n`;

const DISCIPLINES = [
  {
    id: DELTA_ID,
    declare: {
      mechanism: 'added-only',
      scope: { source: 'target.path', include: ['^lib/.*\\.ts$'] },
      supply: { pre: 'empty', post: 'empty' },
      extract: {
        before: [
          { op: 'source', of: 'pre' },
          { op: 'lines' },
          { op: 'keyByPattern', re: '(TODO)' },
        ],
        after: [
          { op: 'source', of: 'post' },
          { op: 'lines' },
          { op: 'keyByPattern', re: '(TODO)' },
        ],
        added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
      },
      relate: [
        { id: 'nothing-added', relation: { op: 'empty', of: 'added' }, message: 'adds {key}' },
      ],
    },
    why: DELTA_WHY,
  },
  {
    id: CONTEXT_ID,
    declare: {
      mechanism: 'precedent',
      scope: { source: 'target.path', include: [DISCIPLINE_SCOPE_RE] },
      sources: { [SESSION]: { transcript: true } },
      supply: { [SESSION]: 'pass' },
      extract: {
        fetched: [
          { op: 'source', of: SESSION },
          { op: 'toolUses', names: [CONTEXT_TOOL] },
          { op: 'field', name: 'name' },
        ],
      },
      relate: [
        {
          id: 'fetched-first',
          relation: { op: 'nonEmpty', of: 'fetched' },
          message: 'no {value} call precedes this edit',
        },
      ],
    },
  },
];

// The declare entry judges the path alone, so a create on either surface supplies every
// source it reads; its scope routes only `.db` paths, so the sibling entries' rows stay as
// they are above.
const DECLARE_ID = 'db-only-under-knowledge';
const DECLARE_RELATE_ID = 'placed';
const DB_OUTSIDE = 'lib/x.db';
const DB_INSIDE = 'memory/knowledge/y.db';
const declareEntry = {
  id: DECLARE_ID,
  why: 'a *.db file may exist only under memory/knowledge/',
  declare: {
    // A path convention: `naming` admits `empty` on the change axis, scoped on target.path.
    mechanism: 'naming',
    scope: { source: 'target.path', include: ['\\.db$'] },
    extract: {
      outside: [
        { op: 'source', of: 'target.path' },
        { op: 'matches', re: '^(?!memory/knowledge/)' },
      ],
    },
    relate: [
      {
        id: DECLARE_RELATE_ID,
        relation: { op: 'empty', of: 'outside' },
        message: '{value} is outside memory/knowledge/',
      },
    ],
  },
};
const WITH_DECLARE = [...DISCIPLINES, declareEntry];
/** The break the declare entry records for `DB_OUTSIDE`: one relate id, one witness, keyed `'0'`. */
const EXPECTED_WITNESSES = [
  { id: DECLARE_RELATE_ID, witnesses: [{ key: '0', value: DB_OUTSIDE }], total: 1 },
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

/** A transcript carrying ONE successful CONTEXT_TOOL call — the precedent declaration's evidence. */
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
function runHook(payload: Record<string, unknown>, disciplines: unknown[] = DISCIPLINES) {
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
        disciplines,
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

describe('① session surface, passing payload (measured pre-conversion)', () => {
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

describe('② session surface, blocking payload (measured pre-conversion)', () => {
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

/** A throwaway commit repo under `tmpRoot/<name>` carrying the parity config plus `config` keys. */
function initCommitRepo(name: string, config: Record<string, unknown>) {
  const projectRoot = join(tmpRoot, name);
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
  return { projectRoot, git };
}

/** Build a throwaway commit repo with `config` keys, stage an initial-then-edited scoped file, run the bin. */
function runCommitCheck(config: Record<string, unknown>, editedContent: string) {
  const { projectRoot, git } = initCommitRepo('commit-repo', config);
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

describe('③ commit surface advise translation (the domain W1 never measured)', () => {
  it('a staged delta violation under adapters.git advise: exit 0, ONE advised row, the why line and the advisory summary verbatim on stderr', () => {
    // Advise is not mute: the reason line, the entry's `why`, and one advisory summary
    // all reach stderr.
    const result = runCommitCheck(
      {
        disciplines: [
          {
            id: DELTA_ID,
            declare: {
              mechanism: 'added-only',
              scope: { source: 'target.path', include: ['^lib/.*\\.ts$'] },
              supply: { pre: 'empty', post: 'empty' },
              extract: {
                before: [
                  { op: 'source', of: 'pre' },
                  { op: 'lines' },
                  { op: 'keyByPattern', re: '(TODO)' },
                ],
                after: [
                  { op: 'source', of: 'post' },
                  { op: 'lines' },
                  { op: 'keyByPattern', re: '(TODO)' },
                ],
                added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
              },
              relate: [
                {
                  id: 'nothing-added',
                  relation: { op: 'empty', of: 'added' },
                  message: 'adds {key}',
                },
              ],
            },
            why: DELTA_WHY,
          },
        ],
        adapters: { git: { enforce: 'advise' } },
      },
      'export const y = 1;\n// TODO: later\n',
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe(
      `discipline '${DELTA_ID}' broken on ${SCOPED_TARGET}: adds TODO — why: ${DELTA_WHY}\n` +
        'covenant advisory: 1 verdict(s) recorded as advised, commit allowed\n',
    );
    expect(rows()).toEqual([['advised', DELTA_ID, SCOPED_TARGET]]);
  });

  it('a session-reading discipline on a matched staged change records ONE skipped row (exit 0, silent)', () => {
    // The commit surface's permanent no-session condition must stay a recorded skip:
    // neither a block, nor a pass with NO row.
    const result = runCommitCheck(
      {
        disciplines: [
          {
            id: CONTEXT_ID,
            declare: {
              mechanism: 'precedent',
              scope: { source: 'target.path', include: [DISCIPLINE_SCOPE_RE] },
              sources: { [SESSION]: { transcript: true } },
              supply: { [SESSION]: 'pass' },
              extract: {
                fetched: [
                  { op: 'source', of: SESSION },
                  { op: 'toolUses', names: [CONTEXT_TOOL] },
                  { op: 'field', name: 'name' },
                ],
              },
              relate: [
                {
                  id: 'fetched-first',
                  relation: { op: 'nonEmpty', of: 'fetched' },
                  message: 'no {value} call precedes this edit',
                },
              ],
            },
          },
        ],
      },
      'export const y = 2;\n',
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(rows()).toEqual([['skipped', CONTEXT_ID, SCOPED_TARGET]]);
  });
});

/** Commit the config alone, then stage `relPath` as a NEW file and run the bin on it. */
function runCommitCheckCreating(name: string, relPath: string, content: string) {
  const { projectRoot, git } = initCommitRepo(name, { disciplines: WITH_DECLARE });
  git('add', 'polydeukes.config.json');
  git('commit', '--quiet', '-m', 'initial');
  const target = join(projectRoot, relPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
  git('add', relPath);

  return spawnSync(process.execPath, [BIN, 'covenant', 'check'], {
    cwd: projectRoot,
    encoding: 'utf-8',
  });
}

/** Every record the declare entry wrote, with the witnesses field the row may carry. */
function declareRecords(): (TelemetryRecord & { witnesses?: string })[] {
  return readRecords(telemetryPath).records.filter((record) => record.label === DECLARE_ID);
}

/** A session `Write` of `relPath` with `content` under the config carrying the declare entry. */
function writeViaHook(relPath: string, content: string) {
  rmSync(join(tmpRoot, 'fixture-tree'), { recursive: true, force: true });
  return runHook(
    {
      hook_event_name: 'PreToolUse',
      session_id: 's-1',
      tool_name: 'Write',
      tool_input: { file_path: relPath, content },
    },
    WITH_DECLARE,
  );
}

describe('④ two surfaces, one declare verdict', () => {
  it('session: a Write of a .db outside the allowed root lands ONE advised row carrying the witnesses; inside lands passed with none', () => {
    // The row must come from the declare entry (label) about the judged path (subject),
    // and the fifth field must carry the engine's witness list — a `passed` row, a row
    // under the wrong subject, or a row with no witnesses would each be a judgment that
    // never named what broke.
    expect(writeViaHook(DB_OUTSIDE, 'x').status).toBe(0);
    expect(rows()).toContainEqual(['advised', DECLARE_ID, DB_OUTSIDE]);
    const [advised] = declareRecords();
    expect(advised.witnesses).toBeDefined();
    expect(JSON.parse(advised.witnesses as string)).toEqual(EXPECTED_WITNESSES);

    expect(writeViaHook(DB_INSIDE, 'y').status).toBe(0);
    expect(declareRecords().map((r) => [r.event, r.subject, r.witnesses])).toEqual([
      ['advised', DB_OUTSIDE, expect.any(String)],
      ['passed', DB_INSIDE, undefined],
    ]);
  });

  it('session: a Write outside the declare scope leaves the sibling rows exactly as without the entry', () => {
    // A declare registration that routes on every world — scope ignored — would add a row
    // here; the row set of the passing payload is pinned unchanged.
    const transcript = transcriptWithPrecedent();
    const result = runHook(
      {
        hook_event_name: 'PreToolUse',
        session_id: 's-1',
        tool_name: 'Write',
        tool_input: {
          file_path: SCOPED_TARGET,
          content: `// see ${PROTECTED_ENTRY} before touching this\nexport const y = 2;\n`,
        },
        transcript_path: transcript,
      },
      WITH_DECLARE,
    );

    expect(result.status).toBe(0);
    expect(rows()).toEqual([
      BASELINE_FIRST_RUN_ROW,
      ['passed', 'self-mod', PROTECTED_ENTRY],
      ['passed', 'shell-mod', PROTECTED_ENTRY],
      ['passed', DELTA_ID, SCOPED_TARGET],
      ['passed', CONTEXT_ID, SCOPED_TARGET],
    ]);
  });

  it('commit: the same staged .db lands the same advised row with the byte-identical witnesses string; inside lands passed', () => {
    // Two observers, one verdict: the commit surface must serialise the same witness list
    // the session surface did — same order, same keys — so the fifth field is compared
    // as the string the log carries, not as a parsed shape.
    expect(writeViaHook(DB_OUTSIDE, 'x').status).toBe(0);

    const commit = runCommitCheckCreating('commit-outside', DB_OUTSIDE, 'x');
    expect(commit.status).toBe(0);
    expect(rows().filter(([, label]) => label === DECLARE_ID)).toEqual([
      ['advised', DECLARE_ID, DB_OUTSIDE],
      ['advised', DECLARE_ID, DB_OUTSIDE],
    ]);
    const [fromSession, fromCommit] = declareRecords();
    expect(fromSession.witnesses).toBeDefined();
    expect(fromCommit.witnesses).toBe(fromSession.witnesses);

    const inside = runCommitCheckCreating('commit-inside', DB_INSIDE, 'y');
    expect(inside.status).toBe(0);
    expect(declareRecords().at(-1)).toMatchObject({ event: 'passed', subject: DB_INSIDE });
    expect(declareRecords().at(-1)?.witnesses).toBeUndefined();
  });
});
