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
//
// These cases run the judge out of the covenant package's BUILT output, not the working
// tree: the composition root resolves the module through the package's `exports` map, which
// the test runner's source alias does not reach. `turbo test` builds first, so the whole
// suite is honest; invoking this file alone after editing a judge reports on the previous
// build until `pnpm build` runs. This file deliberately carries no rebuild of its own —
// a suite that rebuilds mid-edit is how a session locks itself out.
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
    // World axis with `equal`: two supplied files must carry the same keys.
    mechanism: 'pairing',
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
        relation: { op: 'equal', of: ['koKeys', 'enKeys'] },
        messageBySide: { left: '{key} is in ko only', right: '{key} is in en only' },
      },
    ],
  },
};

/**
 * The parity rows a surface left: (event, label), the witness keys the fifth field names,
 * and each witness's `side`. `Equal` tags a left-only item `left` and a right-only one
 * `right`, and that tag is what picks the `messageBySide` template — so a comparison that
 * found the right keys under swapped tags renders every break message backwards.
 */
type ParityRow = {
  event: string;
  label: string;
  witnessKeys: string[];
  witnessSides: string[];
  witnesses?: string;
};

function parityRows(telemetryPath: string): ParityRow[] {
  return readRecords(telemetryPath)
    .records.filter((record: TelemetryRecord) => record.label === DECLARE_ID)
    .map((record) => {
      const entries =
        record.witnesses === undefined
          ? []
          : (JSON.parse(record.witnesses) as {
              id: string;
              witnesses: { key: string; side?: string }[];
            }[]);
      const witnesses = entries.filter((e) => e.id === RELATE_ID).flatMap((e) => e.witnesses);
      return {
        event: record.event,
        label: record.label,
        witnessKeys: witnesses.map((w) => w.key),
        witnessSides: witnesses.map((w) => w.side ?? '(none)'),
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
      parityRows(sessionLog).map(({ event, label, witnessKeys, witnessSides }) => [
        event,
        label,
        witnessKeys,
        witnessSides,
      ]),
    ).toEqual([['advised', DECLARE_ID, [ADDED_KEY], ['right']]]);
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

describe('the parity declaration over the shapes a locale pair actually takes', () => {
  /** Edit `file` to `content` through the session surface, answering the rows it left. */
  async function editThroughSession(file: string, content: string): Promise<ParityRow[]> {
    const rawPayload = JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: 's-1',
      cwd: sessionRoot,
      tool_name: 'Edit',
      tool_input: {
        file_path: join(sessionRoot, file),
        old_string: readFileSync(join(sessionRoot, file), 'utf-8'),
        new_string: content,
      },
    });
    await runClaudeCodeHook({ repoRoot: sessionRoot, rawPayload, telemetryPath: sessionLog });
    return parityRows(sessionLog);
  }

  it('translated values with the same keys uphold — only the key paths are compared', () => {
    // The premise of the whole discipline: a locale pair differs in every value by
    // definition. A relation comparing values would break on every real pair, so this is
    // the case that separates a key comparison from a value one.
    writeFileSync(join(sessionRoot, EN_FILE), '{"greeting":"Hello","bye":"Bye"}');
    writeFileSync(join(sessionRoot, KO_FILE), '{"greeting":"안녕","bye":"잘 가"}');

    return expect(
      editThroughSession(EN_FILE, '{"greeting":"Hi","bye":"Bye"}').then((rows) =>
        rows.map(({ event }) => event),
      ),
    ).resolves.toEqual(['passed']);
  });

  it('a key missing from en is witnessed on the other side than a key missing from ko', async () => {
    // The sibling case above adds to `en`; this one adds to `ko`. `Equal` is the only
    // two-sided relation, and a single-direction `Subset` implementation passes one of
    // these two while failing the other.
    writeFileSync(join(sessionRoot, EN_FILE), '{"a":1}');
    writeFileSync(join(sessionRoot, KO_FILE), '{"a":1}');

    const rows = await editThroughSession(KO_FILE, '{"a":1,"koOnly":2}');

    // `ko` is the declaration's left extract, so a key only it carries is tagged `left` —
    // the tag `messageBySide` reads. The en-only sibling above tags `right`; swapping the
    // two literals in `relateEqual` keeps both key lists intact and inverts every message.
    expect(
      rows.map(({ event, witnessKeys, witnessSides }) => [event, witnessKeys, witnessSides]),
    ).toEqual([['advised', ['koOnly'], ['left']]]);
  });

  it('a nested key is witnessed by its dot path, not by its leaf name', async () => {
    // Real locale files nest; `flattenKeys` is in the pipeline for exactly that. A step
    // that enumerated only top-level keys would report parity on this pair.
    writeFileSync(join(sessionRoot, EN_FILE), '{"nav":{"home":"Home"}}');
    writeFileSync(join(sessionRoot, KO_FILE), '{"nav":{"home":"홈"}}');

    const rows = await editThroughSession(EN_FILE, '{"nav":{"home":"Home","settings":"Settings"}}');

    expect(rows.map(({ event, witnessKeys }) => [event, witnessKeys])).toEqual([
      ['advised', ['nav.settings']],
    ]);
  });

  it('a missing counterpart file refuses rather than passing on one side alone', async () => {
    // `supply: error` is what stops a deleted mirror from reading as "no difference". A
    // supply refusal lands `blocked` whatever the enforce level says — it is the absence of
    // a judgment, not a lenient one — so the deletion cannot pass as parity.
    writeFileSync(join(sessionRoot, EN_FILE), '{"a":1}');
    rmSync(join(sessionRoot, KO_FILE));

    const rows = await editThroughSession(EN_FILE, '{"a":1,"b":2}');

    expect(rows.map(({ event, witnessKeys }) => [event, witnessKeys])).toEqual([['blocked', []]]);
  });
});
