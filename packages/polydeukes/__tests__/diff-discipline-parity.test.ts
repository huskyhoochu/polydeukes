import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
// The live root config's pre/post-reading disciplines, judged from `git diff --cached`
// translated to the IR. Each declaration is read from polydeukes.config.yaml at test time
// so the fixture cannot drift from what the repository actually runs. The fixtures
// discriminate hunk-line semantics: a break lives on a `+`/`-` line, and a line that
// already carries the pattern sits untouched as context, so a translator that leaks
// context into `pre` or `post` flips the verdict.
import { runCovenantCheck } from '../src/covenant-check.ts';
import { covenantInputFromUnifiedDiff } from '../src/diff-ir.ts';
import { type CheckRepo, createCheckRepo } from './helpers.ts';

const ROOT_CONFIG = resolve(import.meta.dirname, '../../../polydeukes.config.yaml');

type Discipline = {
  id: string;
  declare: { extract: Record<string, { op: string; re?: string }[]> };
};

/** The live declaration with the given id, exactly as the root config carries it. */
function liveDiscipline(id: string): Discipline {
  const { disciplines } = parse(readFileSync(ROOT_CONFIG, 'utf-8')) as {
    disciplines: Discipline[];
  };
  const entry = disciplines.find((discipline) => discipline.id === id);
  if (entry === undefined) throw new Error(`root config has no discipline '${id}'`);
  return entry;
}

/** The first alternative of the capture group in an extract pipeline's `keyByPattern` step. */
function firstBannedWord(discipline: Discipline, pipeline: string): string {
  const step = discipline.declare.extract[pipeline]?.find((s) => s.op === 'keyByPattern');
  const alternatives = /\(([^)]+)\)/.exec(step?.re ?? '')?.[1]?.split('|');
  const word = alternatives?.[0];
  if (word === undefined) throw new Error(`no capture alternatives in '${pipeline}'`);
  return word;
}

type Row = { event: string; subject: string; witnesses: { key: string; value: unknown }[] };

/** Rows under `label`: event, subject, and the flattened witness list of every relate id. */
function rowsUnder(telemetryPath: string, label: string): Row[] {
  return readRecords(telemetryPath)
    .records.filter((record) => record.label === label)
    .map((record) => ({
      event: record.event,
      subject: record.subject,
      witnesses:
        record.witnesses === undefined
          ? []
          : (
              JSON.parse(record.witnesses) as { witnesses: { key: string; value: unknown }[] }[]
            ).flatMap((entry) => entry.witnesses),
    }));
}

let repo: CheckRepo;
let repoRoot: string;
let git: CheckRepo['git'];
let write: CheckRepo['write'];
/** Telemetry outside the repository so it is never part of what git sees. */
let logDir: string;
let telemetryPath: string;

beforeEach(() => {
  repo = createCheckRepo('pdks-diff-parity-');
  ({ repoRoot, git, write } = repo);
  logDir = mkdtempSync(join(tmpdir(), 'pdks-diff-parity-log-'));
  telemetryPath = join(logDir, 'roi.log');
});

afterEach(() => {
  repo.cleanup();
  rmSync(logDir, { recursive: true, force: true });
});

/** Judge the staged diff through the translator, with the real judges. */
async function checkStaged(): Promise<{ exitCode: number }> {
  return runCovenantCheck({
    repoRoot,
    input: covenantInputFromUnifiedDiff({ text: git('diff', '--cached') }),
    telemetryPath,
  });
}

/** Write the JSON config with exactly one live discipline and commit it as the baseline. */
function commitConfigWith(discipline: Discipline, files: [string, string][]): void {
  repo.writeConfig({ disciplines: [discipline] });
  for (const [path, content] of files) write(path, content);
  git('add', '-A');
  git('commit', '--quiet', '-m', 'baseline');
}

function stage(path: string, content: string): void {
  write(path, content);
  git('add', path);
}

describe('covenant-vocabulary (added-only) from a diff', () => {
  const ID = 'covenant-vocabulary';
  const SOURCE = 'packages/x/src/a.ts';
  const discipline = liveDiscipline(ID);
  const banned = firstBannedWord(discipline, 'after');
  const untouched = `// the ${banned} word already lives here\n`;
  const filler = Array.from({ length: 6 }, (_, i) => `export const k${i} = ${i};\n`).join('');
  const base = `${untouched}${filler}`;

  it('a new line carrying the banned word is advised, with the new line as the witness', async () => {
    // The untouched first line carries the same word: a translator that folds context or
    // the whole file into `pre` finds the key on both sides and reports nothing added.
    commitConfigWith(discipline, [[SOURCE, base]]);
    const added = `export const z = 1; // ${banned} again`;
    stage(SOURCE, `${base}${added}\n`);

    await checkStaged();

    expect(rowsUnder(telemetryPath, ID)).toEqual([
      { event: 'advised', subject: SOURCE, witnesses: [{ key: banned, value: added }] },
    ]);
  });

  it('an unrelated edit to a file that already carries the banned word is not advised', async () => {
    // The pre-existing line stays context. A translator that leaks context into `post`
    // alone reports the old debt as a new occurrence on every edit of that file.
    commitConfigWith(discipline, [[SOURCE, base]]);
    stage(SOURCE, `${base}export const unrelated = 2;\n`);

    await checkStaged();

    expect(rowsUnder(telemetryPath, ID).map((row) => [row.event, row.subject])).toEqual([
      ['passed', SOURCE],
    ]);
  });
});

describe('changelog-keeps-every-release (one-way-marker) from a diff', () => {
  const ID = 'changelog-keeps-every-release';
  const CHANGELOG = 'CHANGELOG.md';
  const discipline = liveDiscipline(ID);
  const headings = [
    '## [0.6.1] - 2026-09-01',
    '## [0.6.0] - 2026-08-20',
    '## [0.5.0] - 2026-08-01',
  ];
  const base = `# Changelog\n\n${headings.map((h) => `${h}\n\n- a line\n\n`).join('')}`;

  it('removing a release heading is advised naming the heading', async () => {
    commitConfigWith(discipline, [[CHANGELOG, base]]);
    stage(CHANGELOG, base.replace(`${headings[2]}\n\n- a line\n\n`, ''));

    await checkStaged();

    expect(rowsUnder(telemetryPath, ID)).toEqual([
      {
        event: 'advised',
        subject: CHANGELOG,
        witnesses: [{ key: '## [0.5.0', value: headings[2] }],
      },
    ]);
  });

  it('moving a release heading (removed at one place, added at another) is not advised', async () => {
    // Both a `-` and a `+` line carry the heading. A translator that drops `+` lines from
    // a modification's `post` sees a removal alone.
    commitConfigWith(discipline, [[CHANGELOG, base]]);
    const moved = `# Changelog\n\n${[headings[2], headings[0], headings[1]].map((h) => `${h}\n\n- a line\n\n`).join('')}`;
    stage(CHANGELOG, moved);

    await checkStaged();

    expect(rowsUnder(telemetryPath, ID).map((row) => [row.event, row.subject])).toEqual([
      ['passed', CHANGELOG],
    ]);
  });
});

describe('valve-is-not-the-agents (self-absolution-ban) from a diff', () => {
  const ID = 'valve-is-not-the-agents';
  const CONFIG_YAML = 'polydeukes.config.yaml';
  const discipline = liveDiscipline(ID);

  /** The YAML config the discipline scopes on, carrying the witness block and itself. */
  function configText(ttlMinutes: number, testCmd: string): string {
    return stringify({
      languages: { typescript: { productionGlob: 'lib/**/*.ts', testCmd } },
      telemetry: { logPath: telemetryPath },
      witness: { token: 'agreed-token', ttlMinutes },
      disciplines: [discipline],
    });
  }

  function commitYamlConfig(): void {
    write(CONFIG_YAML, configText(10, 'echo {scope}'));
    git('add', CONFIG_YAML);
    git('commit', '--quiet', '-m', 'baseline');
  }

  it('changing ttlMinutes is advised at the ttlMinutes key', async () => {
    // `state` pairs `pre` and `post` from the hunk: the `-` line and the `+` line share
    // the key and differ in value. A translator that leaves `pre` empty on a modification
    // makes `unchanged` see one side only, which is a config fault, not a break.
    commitYamlConfig();
    stage(CONFIG_YAML, configText(30, 'echo {scope}'));

    await checkStaged();

    expect(
      rowsUnder(telemetryPath, ID).map((row) => [
        row.event,
        row.subject,
        row.witnesses.map((w) => w.key),
      ]),
    ).toEqual([['advised', CONFIG_YAML, ['ttlMinutes:']]]);
  });

  it('an edit elsewhere in the config leaves the witness block unchanged — not advised', async () => {
    // The witness lines are context. A translator that puts context into one side only
    // reports the block as changed on every config edit.
    commitYamlConfig();
    stage(CONFIG_YAML, configText(10, 'echo changed {scope}'));

    await checkStaged();

    expect(rowsUnder(telemetryPath, ID).map((row) => [row.event, row.subject])).toEqual([
      ['passed', CONFIG_YAML],
    ]);
  });
});

describe('docs-stay-bilingual (companion over the change set) from a diff', () => {
  const ID = 'docs-stay-bilingual';
  const EN_DOC = 'README.md';
  const KO_DOC = 'README.ko.md';
  const discipline = liveDiscipline(ID);

  it('README.md staged alone is advised ko-follows on README.md', async () => {
    // `changes` is derived from the translated IR; a runner that hands each dispatch its
    // own path alone never finds the missing side.
    commitConfigWith(discipline, [
      [EN_DOC, '# Title\n'],
      [KO_DOC, '# Title (ko)\n'],
    ]);
    stage(EN_DOC, '# Title\n\nA new paragraph.\n');

    await checkStaged();

    expect(rowsUnder(telemetryPath, ID)).toEqual([
      { event: 'advised', subject: EN_DOC, witnesses: [{ key: 'README', value: EN_DOC }] },
    ]);
  });

  it('both sides staged leave a passed row per side and no advised row', async () => {
    commitConfigWith(discipline, [
      [EN_DOC, '# Title\n'],
      [KO_DOC, '# Title (ko)\n'],
    ]);
    stage(EN_DOC, '# Title\n\nA new paragraph.\n');
    stage(KO_DOC, '# Title (ko)\n\nAn entirely different paragraph.\n');

    await checkStaged();

    expect(
      rowsUnder(telemetryPath, ID)
        .map((row) => [row.event, row.subject])
        .sort(),
    ).toEqual([
      ['passed', KO_DOC],
      ['passed', EN_DOC],
    ]);
  });
});
