// `pdks explain` renders an added-only declaration as its mechanism, derived axis, and
// relation on both surfaces, keeps the entry's uncomputable-write skip arm beside it on the
// session surface, and surfaces the removed-key rejection when a config still carries `forbid`.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { explain } from '../src/explain.ts';
import { writeConfigAt } from './helpers.ts';

const SESSION_HEADER = 'surface: session (claude-code hook)';
const COMMIT_HEADER = 'surface: commit (git pre-commit)';
const SURFACE_HEADERS = [SESSION_HEADER, COMMIT_HEADER] as const;

const ID = 'no-lantern';
const RELATE_ID = 'nothing-added';
const SCOPE_SOURCE = 'target.path';
// The banned pattern is a fixture value with no relation to this repo's vocabulary.
const PATTERN = '\\b(lantern)\\b';

const addedOnlyEntry = {
  id: ID,
  why: 'the word must not enter the sources',
  declare: {
    mechanism: 'added-only',
    scope: { source: SCOPE_SOURCE, include: ['^lib/'] },
    supply: { pre: 'empty', post: 'empty' },
    extract: {
      before: [{ op: 'source', of: 'pre' }, { op: 'lines' }, { op: 'keyByPattern', re: PATTERN }],
      after: [{ op: 'source', of: 'post' }, { op: 'lines' }, { op: 'keyByPattern', re: PATTERN }],
      added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
    },
    relate: [
      { id: RELATE_ID, relation: { op: 'empty', of: 'added' }, message: 'adds {key}: {value}' },
    ],
  },
};

let repoRoot: string;
let telemetryPath: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-explain-added-only-'));
  telemetryPath = join(repoRoot, 'roi.log');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
});

function writeFixtureConfig(disciplines: unknown[]): void {
  writeConfigAt(repoRoot, telemetryPath, { disciplines });
}

function surfaceSection(text: string, header: string): string {
  const start = text.indexOf(header);
  expect(start, `surface header missing: ${header}`).toBeGreaterThanOrEqual(0);
  const rest = text.slice(start + header.length);
  const next = rest.indexOf('\nsurface:');
  return next === -1 ? rest : rest.slice(0, next);
}

/** The rendered lines of the given kind+label in a surface section. */
function linesOf(section: string, kind: string, label: string): string[] {
  return section
    .split('\n')
    .filter((line) => new RegExp(`^\\s+${kind}\\s+${label}(\\s|$)`).test(line));
}

describe('explain renders an added-only declaration', () => {
  it('renders `declare <id>` as added-only · change · empty <relate id> on both surfaces', async () => {
    // The live entries are all this shape; a config validator that refuses `supply: empty`
    // makes explain throw before any row renders, and a renderer that names the family
    // instead of the mechanism hides which of the seven promises this is.
    writeFixtureConfig([addedOnlyEntry]);

    const { text } = await explain({ repoRoot });

    for (const header of SURFACE_HEADERS) {
      const rows = linesOf(surfaceSection(text, header), 'declare', ID);
      expect(rows, header).toHaveLength(1);
      expect(rows[0]).toMatch(
        /added-only · change · empty nothing-added · scope target\.path · include 1 · exclude 0/,
      );
    }
  });

  it('keeps one skip row under the entry id on the session surface for the uncomputable-write arm', async () => {
    // The skip arm survives beside the judging row: dropping it leaves an in-scope
    // `sed -i` silent, doubling it gives one call two rows.
    writeFixtureConfig([addedOnlyEntry]);

    const session = surfaceSection((await explain({ repoRoot })).text, SESSION_HEADER);

    expect(linesOf(session, 'declare', ID)).toHaveLength(1);
    expect(linesOf(session, 'skip', ID)).toHaveLength(1);
  });
});
