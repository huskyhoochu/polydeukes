// `pdks explain` renders the DECLARED level of a `disciplines:` entry on BOTH surfaces'
// registration tables: an explicit `enforce: advise` and an explicit `enforce: block` each
// show their value, and an entry that omits the key renders without any level word. The
// session surface header states the default the omission resolves to. The marker's exact
// form is the implementation's; what is pinned is only that the level word reaches the row.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { explain } from '../src/explain.ts';
import { writeConfigAt } from './helpers';

const SESSION_HEADER = 'surface: session (claude-code hook)';
const COMMIT_HEADER = 'surface: commit (git pre-commit)';
const SURFACE_HEADERS = [SESSION_HEADER, COMMIT_HEADER] as const;

/** The level words the rendered row must carry — asserted as tokens, never as a format. */
const ADVISE_TOKEN = 'advise';
const BLOCK_TOKEN = 'block';
/** The session header's statement of the default and the meta remnant. */
const SESSION_DEFAULT_PHRASE = 'disciplines: advise unless enforce: block';
const SESSION_META_PHRASE = 'meta: block';

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

describe('explain marks the advise level on both surfaces', () => {
  it("renders the `judge` row of an enforce: 'advise' entry with the level word on each surface", async () => {
    // The author's level must be visible where the assembly is read. Both surfaces are
    // checked because the commit root builds its table separately.
    writeFixtureConfig([softEntry, plainEntry]);

    const { text } = await explain({ repoRoot });

    for (const header of SURFACE_HEADERS) {
      expect(rowOf(text, header, 'judge', SOFT_ID)).toContain(ADVISE_TOKEN);
    }
  });

  it('renders an entry that omits enforce without ANY level word (absence stays unmarked)', async () => {
    // The declared level is rendered, never the effective one. A marker driven by the
    // compiled registration would make every plain entry read `enforce: advise`, so the
    // default and an author's explicit choice of it would become indistinguishable.
    writeFixtureConfig([softEntry, plainEntry]);

    const { text } = await explain({ repoRoot });

    for (const header of SURFACE_HEADERS) {
      const row = rowOf(text, header, 'judge', PLAIN_ID);
      expect(row).not.toContain(ADVISE_TOKEN);
      expect(row).not.toContain(BLOCK_TOKEN);
    }
  });

  it("renders an explicit enforce: 'block' entry with the level word on each surface", async () => {
    // The promotion rung must be visible where the assembly is read — it is the one choice
    // that keeps an entry at exit 2 on the session surface. A marker gated on
    // `=== 'advise'` would make an explicit block read like an omission.
    writeFixtureConfig([hardEntry, softEntry]);

    const { text } = await explain({ repoRoot });

    for (const header of SURFACE_HEADERS) {
      const row = rowOf(text, header, 'judge', HARD_ID);
      expect(row).toContain(BLOCK_TOKEN);
      expect(row).not.toContain(ADVISE_TOKEN);
    }
  });

  it('states the default on the commit header line too, beside the observer level', async () => {
    // The commit header names the OBSERVER's level, which a reader would otherwise combine
    // with an unmarked row into "this entry blocks" — false, since an omitted level is
    // advise. So the commit header must state the default too, not the session one alone.
    writeFixtureConfig([plainEntry]);

    const { text } = await explain({ repoRoot });
    const headerLine = text.split('\n').find((line) => line.startsWith(COMMIT_HEADER));

    expect(headerLine).toBeDefined();
    expect(headerLine).toContain('enforce: block');
    expect(headerLine).toContain(SESSION_DEFAULT_PHRASE);
  });

  it('states the default and the meta remnant on the session header line', async () => {
    // The session surface has no observer level, so the header is the only place a reader
    // learns that an omitted level means advise and that meta-covenants still block.
    writeFixtureConfig([plainEntry]);

    const { text } = await explain({ repoRoot });
    const headerLine = text.split('\n').find((line) => line.startsWith(SESSION_HEADER));

    expect(headerLine).toBeDefined();
    expect(headerLine).toContain(SESSION_DEFAULT_PHRASE);
    expect(headerLine).toContain(SESSION_META_PHRASE);
  });
});
