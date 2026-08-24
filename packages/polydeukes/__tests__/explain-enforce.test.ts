// CONFIG-11 AC-6 / §4.5 — `pdks explain` marks an `enforce: advise` entry on BOTH surfaces'
// registration tables, and marks nothing else: an entry that omits the key and an entry
// carrying explicit `block` render without the level (absence and explicit block both mean
// "block today", and a marker that said so would invert its meaning the day POSTURE-01
// flips the default). The marker's exact form is the implementation's; what is pinned is
// only that the level word reaches the row.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { explain } from '../src/explain.ts';
import { writeConfigAt } from './helpers';

const SESSION_HEADER = 'surface: session (claude-code hook)';
const COMMIT_HEADER = 'surface: commit (git pre-commit)';
const SURFACE_HEADERS = [SESSION_HEADER, COMMIT_HEADER] as const;

/** The level word the rendered row must carry — asserted as a token, never as a format. */
const ADVISE_TOKEN = 'advise';

// Ids deliberately avoid the token so a containment check reads the DESCRIPTION column,
// not the label. All three judged entries are delta family, which renders as `judge` on
// both surfaces — the one family whose rows are comparable across the two tables.
const SOFT_ID = 'softly-held';
const HARD_ID = 'hard-held';
const PLAIN_ID = 'plain-held';

const softEntry = { id: SOFT_ID, forbid: 'zzz_banned', enforce: 'advise' };
const hardEntry = { id: HARD_ID, forbid: 'zzz_banned', enforce: 'block' };
const plainEntry = { id: PLAIN_ID, forbid: 'zzz_banned' };

let repoRoot: string;
let telemetryPath: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-explain-enforce-'));
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

/** The single `<kind> <label>` row of a surface, failing if it is missing or doubled. */
function rowOf(text: string, header: string, kind: string, label: string): string {
  const lines = linesOf(surfaceSection(text, header), kind, label);
  expect(lines, `${kind} ${label} on '${header}'`).toHaveLength(1);
  return lines[0];
}

describe('CONFIG-11 AC-6 — explain marks the advise level on both surfaces', () => {
  it("renders the `judge` row of an enforce: 'advise' entry with the level word on each surface", () => {
    // P0 render contract: the author's level is visible where the assembly is read.
    // Mutation caught: the marker rendered on one surface only (the commit root builds
    // its table separately), or the level never reaching the row at all.
    writeFixtureConfig([softEntry, plainEntry]);

    const { text } = explain({ repoRoot });

    for (const header of SURFACE_HEADERS) {
      expect(rowOf(text, header, 'judge', SOFT_ID)).toContain(ADVISE_TOKEN);
    }
  });

  it('renders an entry that omits enforce without the level word (absence stays unmarked)', () => {
    // §4.5: absence inherits the default and is NOT annotated. Mutation caught: the
    // marker driven by the effective level instead of the declared one — every plain
    // entry would read as its default, and the marker's meaning flips with POSTURE-01.
    writeFixtureConfig([softEntry, plainEntry]);

    const { text } = explain({ repoRoot });

    for (const header of SURFACE_HEADERS) {
      expect(rowOf(text, header, 'judge', PLAIN_ID)).not.toContain(ADVISE_TOKEN);
    }
  });

  it("renders an explicit enforce: 'block' entry without the level word", () => {
    // §4.5: only advise is marked. Mutation caught: the marker rendering whatever value
    // the key holds (`enforce: block` annotated the same way), which would make the
    // explicit rung indistinguishable from the one this ticket introduces.
    writeFixtureConfig([hardEntry, softEntry]);

    const { text } = explain({ repoRoot });

    for (const header of SURFACE_HEADERS) {
      expect(rowOf(text, header, 'judge', HARD_ID)).not.toContain(ADVISE_TOKEN);
    }
  });
});
