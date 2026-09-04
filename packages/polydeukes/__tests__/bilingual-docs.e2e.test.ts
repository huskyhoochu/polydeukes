import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { readRecords, type TelemetryRecord } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// Two surfaces, one bilingual-docs declaration, two different answers by design. The
// declaration reads the antecedent from `target.path` and the consequent from `changes`
// (`Implies` over `keyByPattern` stems): a commit that stages one side of an `X.md` /
// `X.ko.md` pair lands `advised` naming the missing side, a commit staging both leaves no
// break, and the excluded internal docs never route. The session surface observes one call
// at a time, so it cannot see the pair — the same edit lands `skipped` there, and the
// asymmetry is the contract this file pins.
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

/** Injected fixture values — the bilingual declaration and the pair it judges. */
const DECLARE_ID = 'docs-stay-bilingual';
const KO_FOLLOWS = 'ko-follows';
const EN_FOLLOWS = 'en-follows';
const EN_DOC = 'README.md';
const KO_DOC = 'README.ko.md';
const STEM = 'README';
const INTERNAL_DOC = 'CLAUDE.md';
const INTERNAL_RULE_DOC = '.claude/rules/x.md';
const EN_BASE = '# Title\n';
const KO_BASE = '# Title (ko)\n';
const EN_EDITED = '# Title\n\nA new paragraph.\n';
const KO_EDITED = '# Title (ko)\n\nAn entirely different paragraph.\n';
const EN_PATTERN = '^(.+?)(?<!\\.ko)\\.md$';
const KO_PATTERN = '^(.+)\\.ko\\.md$';
const declareEntry = {
  id: DECLARE_ID,
  why: 'English is the default and Korean mirrors live in *.ko.md; only presence in the change set is judged, never content.',
  declare: {
    // Change axis with `implies`: one file's presence obliges another's.
    mechanism: 'companion',
    scope: {
      source: 'target.path',
      include: ['\\.md$'],
      exclude: ['^\\.claude/', '^CLAUDE\\.md$'],
    },
    extract: {
      en: [
        { op: 'source', of: 'target.path' },
        { op: 'keyByPattern', re: EN_PATTERN },
      ],
      ko: [
        { op: 'source', of: 'target.path' },
        { op: 'keyByPattern', re: KO_PATTERN },
      ],
      enChanged: [
        { op: 'source', of: 'changes' },
        { op: 'items' },
        { op: 'keyByPattern', re: EN_PATTERN },
      ],
      koChanged: [
        { op: 'source', of: 'changes' },
        { op: 'items' },
        { op: 'keyByPattern', re: KO_PATTERN },
      ],
    },
    relate: [
      {
        id: KO_FOLLOWS,
        relation: { op: 'implies', of: 'en', requires: 'koChanged' },
        message: '{value} changed without {key}.ko.md',
      },
      {
        id: EN_FOLLOWS,
        relation: { op: 'implies', of: 'ko', requires: 'enChanged' },
        message: '{value} changed without {key}.md',
      },
    ],
  },
};

/**
 * The rows a surface left under the declaration's label: event, subject, the relate ids
 * that broke, and the witnesses each of them named.
 */
type BilingualRow = {
  event: string;
  subject: string;
  relateIds: string[];
  witnesses: Record<string, { key: string; value: unknown }[]>;
};

function bilingualRows(telemetryPath: string): BilingualRow[] {
  return readRecords(telemetryPath)
    .records.filter((record: TelemetryRecord) => record.label === DECLARE_ID)
    .map((record) => {
      const entries =
        record.witnesses === undefined
          ? []
          : (JSON.parse(record.witnesses) as {
              id: string;
              witnesses: { key: string; value: unknown }[];
            }[]);
      return {
        event: record.event,
        subject: record.subject,
        relateIds: entries.map((e) => e.id),
        witnesses: Object.fromEntries(entries.map((e) => [e.id, e.witnesses])),
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
  sessionRoot = mkdtempSync(join(tmpdir(), 'pdks-bilingual-session-'));
  sessionLog = join(sessionRoot, 'roi.log');
  writeConfigAt(sessionRoot, sessionLog, { disciplines: [declareEntry] });
  for (const [file, content] of [
    [EN_DOC, EN_BASE],
    [KO_DOC, KO_BASE],
  ] as const) {
    const target = join(sessionRoot, file);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }

  commitRepo = createCheckRepo('pdks-bilingual-commit-');
  commitLogDir = mkdtempSync(join(tmpdir(), 'pdks-bilingual-commit-log-'));
  commitLog = join(commitLogDir, 'roi.log');
  commitRepo.writeConfig({ disciplines: [declareEntry] });
  commitRepo.write(EN_DOC, EN_BASE);
  commitRepo.write(KO_DOC, KO_BASE);
  commitRepo.git('add', 'polydeukes.config.json', EN_DOC, KO_DOC);
  commitRepo.git('commit', '--quiet', '-m', 'baseline');
});

afterEach(() => {
  rmSync(sessionRoot, { recursive: true, force: true });
  commitRepo.cleanup();
  rmSync(commitLogDir, { recursive: true, force: true });
});

/** Stage the given files at the given contents and run the staged check. */
async function checkStaged(files: [string, string][]) {
  for (const [file, content] of files) commitRepo.write(file, content);
  commitRepo.git('add', ...files.map(([file]) => file));
  return runCovenantCheck({
    repoRoot: commitRepo.repoRoot,
    telemetryPath: commitLog,
    domain: { kind: 'staged' },
  });
}

describe('the commit surface judges presence in the staged change set', () => {
  it('README.md staged alone lands one advised row: ko-follows, witness { key: stem, value: path }', async () => {
    // The whole discipline: the antecedent is the dispatched path, the consequent the staged
    // set. A consequent read from a derived `[own path]` set instead of `world.changes`
    // would still break here, so the paired case below is this case's control; the witness
    // key is the stem the capture produced — a positional key (`'0'`) means `keyByPattern`
    // never re-keyed and the two sides could never have met.
    const result = await checkStaged([[EN_DOC, EN_EDITED]]);

    expect(result.exitCode).toBe(0);
    expect(bilingualRows(commitLog)).toEqual([
      {
        event: 'advised',
        subject: EN_DOC,
        relateIds: [KO_FOLLOWS],
        witnesses: { [KO_FOLLOWS]: [{ key: STEM, value: EN_DOC }] },
      },
    ]);
  });

  it('README.ko.md staged alone lands en-follows under the same stem', async () => {
    // The other direction. A single `Implies` (or an en-side lookahead that also admits
    // `X.ko.md` as an en stem) reports a lone Korean edit as ko-follows, or not at all.
    const result = await checkStaged([[KO_DOC, KO_EDITED]]);

    expect(result.exitCode).toBe(0);
    expect(bilingualRows(commitLog)).toEqual([
      {
        event: 'advised',
        subject: KO_DOC,
        relateIds: [EN_FOLLOWS],
        witnesses: { [EN_FOLLOWS]: [{ key: STEM, value: KO_DOC }] },
      },
    ]);
  });

  it('both sides staged with unrelated content leave a passed row per side and no break', async () => {
    // Presence, never content: the two edits share not one line. A judgment comparing
    // values breaks here; a root that dispatches each change with only its own path as the
    // change set breaks here twice. Two `passed` rows prove both paths routed.
    const result = await checkStaged([
      [EN_DOC, EN_EDITED],
      [KO_DOC, KO_EDITED],
    ]);

    expect(result.exitCode).toBe(0);
    expect(
      bilingualRows(commitLog)
        .map((row) => [row.event, row.subject])
        .sort(),
    ).toEqual([
      ['passed', KO_DOC],
      ['passed', EN_DOC],
    ]);
  });

  it('CLAUDE.md staged alone leaves no row under the label', async () => {
    // The exclude list: a scope that compiles `exclude` and never subtracts it reports the
    // one internal document that has no mirror, on every commit that touches it.
    await checkStaged([[INTERNAL_DOC, '# guidance\n']]);

    expect(bilingualRows(commitLog)).toEqual([]);
  });

  it('a markdown file under .claude/ staged alone leaves no row under the label', async () => {
    // The second exclude pattern; an anchor written `^CLAUDE\.md$` alone lets every rule
    // and skill file under `.claude/` route.
    await checkStaged([[INTERNAL_RULE_DOC, '# a rule\n']]);

    expect(bilingualRows(commitLog)).toEqual([]);
  });
});

describe('the two surfaces answer the same edit differently, by declaration', () => {
  it('session Edit of README.md lands skipped; commit --worktree of the same edit lands advised ko-follows', async () => {
    // The session surface observes one call and cannot see the pair, so it records the
    // absence of a judgment; the commit surface observes the worktree and judges. An
    // `advised` row from the session is the structural false positive the skip prevents;
    // a session with no row at all is a declaration that went inert; and a commit that
    // also skips has lost the only surface that can judge this declaration.
    expect(readFileSync(join(sessionRoot, EN_DOC), 'utf-8')).toBe(EN_BASE);
    const rawPayload = JSON.stringify({
      hook_event_name: 'PreToolUse',
      session_id: 's-1',
      cwd: sessionRoot,
      tool_name: 'Edit',
      tool_input: {
        file_path: join(sessionRoot, EN_DOC),
        old_string: EN_BASE,
        new_string: EN_EDITED,
      },
    });

    const session = await runClaudeCodeHook({
      repoRoot: sessionRoot,
      rawPayload,
      telemetryPath: sessionLog,
    });

    commitRepo.write(EN_DOC, EN_EDITED);
    const commit = await runCovenantCheck({
      repoRoot: commitRepo.repoRoot,
      telemetryPath: commitLog,
      domain: { kind: 'worktree' },
    });

    expect(session.exitCode).toBe(0);
    expect(commit.exitCode).toBe(0);
    const fromSession = bilingualRows(sessionLog);
    const fromCommit = bilingualRows(commitLog);
    expect(fromSession.map((row) => [row.event, row.subject, row.relateIds])).toEqual([
      ['skipped', EN_DOC, []],
    ]);
    expect(fromCommit.map((row) => [row.event, row.subject, row.relateIds])).toEqual([
      ['advised', EN_DOC, [KO_FOLLOWS]],
    ]);
    expect(fromSession[0]?.event).not.toBe(fromCommit[0]?.event);
  });
});
