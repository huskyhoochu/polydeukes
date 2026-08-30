import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readRecords, type TelemetryRecord } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// Two surfaces, one content-parity verdict. A declaration that
// compares the key sets of two locale files (`sources` ko + en, `json` · `flattenKeys`,
// `Equal`) is judged over an Edit payload adding a key to `en.json` (session) and over the
// worktree holding the same edit (commit `--worktree`). Both must land the same label, the
// same `advised` event, and the same witness key.
//
// The session case is the proof of the override rule: the disk `en.json` is still the
// pre-edit text when the hook runs, so a judge reading the supplied file instead of the
// change's own `post` sees two equal key sets and records `passed` — the fixture asserts
// that precondition first, so the divergence it would cause is visible, not incidental.
import { runClaudeCodeHook } from '../src/claude-code-hook.ts';
import { runCovenantCheck } from '../src/covenant-check.ts';
import { type CheckRepo, createCheckRepo, writeConfigAt } from './helpers.ts';

/** Injected fixture values — the parity declaration and the two locales it names. */
const DECLARE_ID = 'locale-key-parity';
const RELATE_ID = 'parity';
const KO_FILE = 'locales/ko.json';
const EN_FILE = 'locales/en.json';
const BASE_CONTENT = '{"a":1}';
const EDITED_CONTENT = '{"a":1,"b":2}';
/** The key the edit adds to `en` alone — the one witness both surfaces must name. */
const ADDED_KEY = 'b';
const declareEntry = {
  id: DECLARE_ID,
  why: 'the ko and en locales must carry the same keys',
  declare: {
    sources: { ko: { file: KO_FILE }, en: { file: EN_FILE } },
    supply: { ko: 'error', en: 'error' },
    scope: { source: 'target.path', include: ['^locales/(ko|en)\\.json$'] },
    extract: {
      koKeys: [{ op: 'source', of: 'ko' }, { op: 'json' }, { op: 'flattenKeys' }],
      enKeys: [{ op: 'source', of: 'en' }, { op: 'json' }, { op: 'flattenKeys' }],
    },
    relate: [
      {
        id: RELATE_ID,
        relation: { op: 'Equal', of: ['koKeys', 'enKeys'] },
        messageBySide: { left: '{key} is in ko only', right: '{key} is in en only' },
      },
    ],
  },
};

/** The parity rows a surface left: (event, label) plus the witness keys the fifth field names. */
type ParityRow = { event: string; label: string; witnessKeys: string[]; witnesses?: string };

function parityRows(telemetryPath: string): ParityRow[] {
  return readRecords(telemetryPath)
    .records.filter((record: TelemetryRecord) => record.label === DECLARE_ID)
    .map((record) => {
      const entries =
        record.witnesses === undefined
          ? []
          : (JSON.parse(record.witnesses) as { id: string; witnesses: { key: string }[] }[]);
      return {
        event: record.event,
        label: record.label,
        witnessKeys: entries
          .filter((e) => e.id === RELATE_ID)
          .flatMap((e) => e.witnesses.map((w) => w.key)),
        ...(record.witnesses === undefined ? {} : { witnesses: record.witnesses }),
      };
    });
}

let sessionRoot: string;
let sessionLog: string;
let commitRepo: CheckRepo;
/** Commit telemetry lives outside the repository — the worktree domain collects untracked files. */
let commitLogDir: string;
let commitLog: string;

beforeEach(() => {
  sessionRoot = mkdtempSync(join(tmpdir(), 'pdks-world-parity-session-'));
  sessionLog = join(sessionRoot, 'roi.log');
  writeConfigAt(sessionRoot, sessionLog, { disciplines: [declareEntry] });
  for (const file of [KO_FILE, EN_FILE]) {
    const target = join(sessionRoot, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, BASE_CONTENT);
  }

  commitRepo = createCheckRepo('pdks-world-parity-commit-');
  commitLogDir = mkdtempSync(join(tmpdir(), 'pdks-world-parity-commit-log-'));
  commitLog = join(commitLogDir, 'roi.log');
  commitRepo.writeConfig({ disciplines: [declareEntry] });
  commitRepo.write(KO_FILE, BASE_CONTENT);
  commitRepo.write(EN_FILE, BASE_CONTENT);
  commitRepo.git('add', 'polydeukes.config.json', KO_FILE, EN_FILE);
  commitRepo.git('commit', '--quiet', '-m', 'baseline');
});

afterEach(() => {
  rmSync(sessionRoot, { recursive: true, force: true });
  commitRepo.cleanup();
  rmSync(commitLogDir, { recursive: true, force: true });
});

describe('the parity declaration lands one verdict on both surfaces', () => {
  it('session: an Edit adding a key to en.json, judged while the disk is still pre-edit, lands ONE advised row naming the added key', async () => {
    // The disk precondition is the control group: without the `post` override the judge
    // compares two `{"a":1}` files and records `passed`. A row under another label, a
    // `blocked` (a supply refusal dressed as a verdict), or a witness naming nothing would
    // each be a judgment that never compared the edited key set.
    expect(readFileSync(join(sessionRoot, EN_FILE), 'utf-8')).toBe(BASE_CONTENT);
    const rawPayload = JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: 's-1',
      cwd: sessionRoot,
      tool_name: 'Edit',
      tool_input: {
        file_path: join(sessionRoot, EN_FILE),
        old_string: BASE_CONTENT,
        new_string: EDITED_CONTENT,
      },
    });

    const result = await runClaudeCodeHook({
      repoRoot: sessionRoot,
      rawPayload,
      telemetryPath: sessionLog,
    });

    expect(result.exitCode).toBe(0);
    expect(
      parityRows(sessionLog).map(({ event, label, witnessKeys }) => [event, label, witnessKeys]),
    ).toEqual([['advised', DECLARE_ID, [ADDED_KEY]]]);
  });

  it('commit --worktree: the same edit on disk lands the same (label, event) and the same witness key as the session', async () => {
    // Two observers, one verdict. The commit root reads the worktree, the session root
    // read the payload's post over a pre-edit disk — if either surface assembles the world
    // differently (wrong `read`, missing override, a supplied `changes` that shadows the
    // derivation) the rows part here, and the fifth field is compared as the string the
    // log carries so a witness list serialised in another order cannot pass as equal.
    const sessionPayload = JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: 's-1',
      cwd: sessionRoot,
      tool_name: 'Edit',
      tool_input: {
        file_path: join(sessionRoot, EN_FILE),
        old_string: BASE_CONTENT,
        new_string: EDITED_CONTENT,
      },
    });
    await runClaudeCodeHook({
      repoRoot: sessionRoot,
      rawPayload: sessionPayload,
      telemetryPath: sessionLog,
    });

    commitRepo.write(EN_FILE, EDITED_CONTENT);
    const commit = await runCovenantCheck({
      repoRoot: commitRepo.repoRoot,
      telemetryPath: commitLog,
      domain: { kind: 'worktree' },
    });

    expect(commit.exitCode).toBe(0);
    const [fromSession] = parityRows(sessionLog);
    const [fromCommit] = parityRows(commitLog);
    expect(fromSession).toBeDefined();
    expect(parityRows(commitLog)).toHaveLength(1);
    expect([fromCommit?.event, fromCommit?.label]).toEqual([
      fromSession?.event,
      fromSession?.label,
    ]);
    expect([fromCommit?.event, fromCommit?.label]).toEqual(['advised', DECLARE_ID]);
    expect(fromCommit?.witnessKeys).toEqual([ADDED_KEY]);
    expect(fromCommit?.witnesses).toBe(fromSession?.witnesses);
  });
});
