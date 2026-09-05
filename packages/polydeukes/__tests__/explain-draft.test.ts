// `pdks explain` renders a draft entry on BOTH surfaces as an unpromoted line and counts
// it in the header aggregate WITHOUT it ever becoming a registration: the assembled label
// lists and `registrations N` are identical with and without the draft.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantRegistration } from '@polydeukes/covenant';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { assembleSessionRegistrations } from '../src/claude-code-hook.ts';
import { assembleCommitRegistrations } from '../src/covenant-check.ts';
import { loadCovenantModule } from '../src/covenant-module.ts';
import { explain } from '../src/explain.ts';
import { loadConfig } from '../src/load-config.ts';
import { REAL_COVENANT_DIST, writeConfigAt } from './helpers';

/** The covenant module both `explain` and the direct assemblies below judge with — loaded
 * from the real dist so the render and the assembly cannot diverge on which judges exist. */
const realCovenant = await loadCovenantModule(REAL_COVENANT_DIST);

const SESSION_HEADER = 'surface: session (claude-code hook)';
const COMMIT_HEADER = 'surface: commit (git pre-commit)';
const SURFACE_HEADERS = [SESSION_HEADER, COMMIT_HEADER] as const;

const DRAFT_ID = 'bilingual-docs-sync';
const draftEntry = { id: DRAFT_ID, why: 'keep the en and ko doc mirrors in sync', draft: true };
const JUDGED_FORBID_ID = 'no-todo';
const judgedForbid = { id: JUDGED_FORBID_ID, forbidCommand: 'TODO' };
const judgedImmutable = {
  id: 'changelog-precedent',
  requirePrecedent: { command: 'npm view ' },
};

const JUDGED_ONLY = [judgedForbid, judgedImmutable];
const WITH_DRAFT = [judgedForbid, draftEntry, judgedImmutable];

let repoRoot: string;
let telemetryPath: string;

beforeEach(() => {
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-explain-draft-'));
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

/** The `registrations N` tally from a surface's aggregate header line. */
function registrationsOf(section: string): number {
  const match = /registrations (\d+)/.exec(section);
  expect(match, 'registrations tally missing').not.toBeNull();
  return Number((match as RegExpExecArray)[1]);
}

describe('explain renders the draft as unpromoted on both surfaces', () => {
  it('renders one `draft <id>` line with the fixed unpromoted description per surface', async () => {
    // A draft rendered as `skip` or `excluded` would claim a judgment disposition it never
    // had, so the kind word is pinned exactly, on both surfaces.
    writeFixtureConfig(WITH_DRAFT);

    const { text } = await explain({ repoRoot });

    for (const header of SURFACE_HEADERS) {
      const lines = linesOf(surfaceSection(text, header), 'draft', DRAFT_ID);
      expect(lines, `draft line on '${header}'`).toHaveLength(1);
      expect(lines[0]).toContain('unpromoted — no judgment');
    }
  });

  it('adds `· draft 1` to each surface header aggregate', async () => {
    // Drafts get their own tally in the header, like `excluded` — never folded into
    // another bucket's number.
    writeFixtureConfig(WITH_DRAFT);

    const { text } = await explain({ repoRoot });

    for (const header of SURFACE_HEADERS) {
      expect(surfaceSection(text, header)).toContain('· draft 1');
    }
  });

  it('registrations N is unchanged by the draft on both surfaces', async () => {
    // A draft counted into `registrations N` would claim a judging body that does not
    // exist, so the tally must be identical with and without it.
    writeFixtureConfig(JUDGED_ONLY);
    const withoutDraft = (await explain({ repoRoot })).text;
    writeFixtureConfig(WITH_DRAFT);
    const withDraft = (await explain({ repoRoot })).text;

    for (const header of SURFACE_HEADERS) {
      expect(registrationsOf(surfaceSection(withDraft, header))).toBe(
        registrationsOf(surfaceSection(withoutDraft, header)),
      );
    }
  });
  it('tallies two drafts as `· draft 2` with a line per draft', async () => {
    // A hardcoded `draft 1` or a `drafts ? 1 : 0` tally passes the single-draft case;
    // only a second draft distinguishes counting from presence.
    const secondDraft = { id: 'measure-first', why: 'count producers first', draft: true };
    writeFixtureConfig([...WITH_DRAFT, secondDraft]);

    const { text } = await explain({ repoRoot });

    for (const header of SURFACE_HEADERS) {
      const section = surfaceSection(text, header);
      expect(section).toContain('· draft 2');
      expect(linesOf(section, 'draft', DRAFT_ID)).toHaveLength(1);
      expect(linesOf(section, 'draft', 'measure-first')).toHaveLength(1);
    }
  });

  it('renders a drafts-only config: draft lines present, meta registrations intact', async () => {
    // Drafts-only resolves with zero judged entries, which walks the empty-discipline edge
    // of the renderer: a width computed as `Math.max(...[])` would be -Infinity and corrupt
    // every line. The meta covenants still register, so both surfaces must render them
    // alongside the draft.
    writeFixtureConfig([draftEntry]);

    const { text } = await explain({ repoRoot });

    for (const header of SURFACE_HEADERS) {
      const section = surfaceSection(text, header);
      expect(linesOf(section, 'draft', DRAFT_ID)).toHaveLength(1);
      expect(section).toContain('· draft 1');
      expect(section).not.toContain('Infinity');
      expect(registrationsOf(section)).toBeGreaterThan(0);
    }
  });
});

describe('judgment invariance: assembly never sees the draft', () => {
  it('both roots assemble identical label lists with and without the draft entry', () => {
    // The covenant compiler has no path that receives a draft, so the assembled
    // registrations stay label-for-label identical. A resolution split leaking the draft
    // into `disciplines` would surface here as an extra label.
    writeFixtureConfig(JUDGED_ONLY);
    const judgedOnlyConfig = loadConfig({ rootDir: repoRoot }).config;
    writeFixtureConfig(WITH_DRAFT);
    const withDraftConfig = loadConfig({ rootDir: repoRoot }).config;

    const labels = (registrations: CovenantRegistration[]): string[] =>
      registrations.map((registration) => registration.label);
    const sessionOf = (config: typeof judgedOnlyConfig) =>
      labels(
        assembleSessionRegistrations({
          config,
          rootDir: repoRoot,
          covenant: realCovenant,
          transcriptPath: join(repoRoot, 'session.jsonl'),
        }),
      );
    const commitOf = (config: typeof judgedOnlyConfig) =>
      labels(
        assembleCommitRegistrations({
          config,
          rootDir: repoRoot,
          covenant: realCovenant,
        }),
      );

    const sessionWithDraft = sessionOf(withDraftConfig);
    const commitWithDraft = commitOf(withDraftConfig);

    expect(sessionWithDraft).toEqual(sessionOf(judgedOnlyConfig));
    expect(commitWithDraft).toEqual(commitOf(judgedOnlyConfig));
    // The draft id appears in NO assembled label — a registration carrying it would be
    // a judgment the entry never promised.
    expect(sessionWithDraft).not.toContain(DRAFT_ID);
    expect(commitWithDraft).not.toContain(DRAFT_ID);
  });
});
