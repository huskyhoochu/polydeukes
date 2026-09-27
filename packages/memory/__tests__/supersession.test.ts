import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingestMemory } from '../src/ingest-memory.ts';
import { lintMemory } from '../src/lint-memory.ts';
import { listSupersession } from '../src/list-supersession.ts';
import type { MemoryConfig } from '../src/memory-config.ts';
import { openMemoryDb } from '../src/schema.ts';
import { searchMemory } from '../src/search-memory.ts';

// Line markers, key patterns, and directions are fixture values: nothing in the package knows
// a `Supersedes:` word or a `doc:` prefix. The key pattern excludes its prefix, so the raw
// target a lint line reports is the bare name, and the same key pattern serves every rule so
// that a row can only come from the line pattern and direction that admitted it.
const INCLUDE = ['notes/**/*.md'];
const KEY = '(?<=doc:)[A-Za-z0-9-]+';
const SUPERSEDES_RULE = { line: 'Supersedes:', key: KEY, direction: 'supersedes' } as const;
const REPLACES_RULE = { line: 'Replaces:', key: KEY, direction: 'supersedes' } as const;
const SUPERSEDED_BY_RULE = {
  line: 'Superseded by:',
  key: KEY,
  direction: 'superseded-by',
} as const;
const BASE_CONFIG: MemoryConfig = { include: INCLUDE };
const CHAIN_CONFIG: MemoryConfig = { include: INCLUDE, supersedes: [SUPERSEDES_RULE] };
const BOTH_DIRECTIONS_CONFIG: MemoryConfig = {
  include: INCLUDE,
  supersedes: [SUPERSEDES_RULE, SUPERSEDED_BY_RULE],
};
const UNRESOLVED_SUPERSESSION = 'unresolved-supersession';
const UNQUOTED = 'unquoted';
const SUPERSESSION_RULES: ReadonlySet<string> = new Set([UNRESOLVED_SUPERSESSION, UNQUOTED]);

let tmp: string;
let root: string;
const opened: DatabaseSync[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pdks-supersession-'));
  root = join(tmp, 'tree');
  mkdirSync(root);
});

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function open(name: string): DatabaseSync {
  const db = openMemoryDb({ path: join(tmp, 'db', name) });
  opened.push(db);
  return db;
}

function writeDoc(relative: string, text: string): void {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

/** A typed document whose sections are given as `[heading text, body]` pairs. */
const typed = (title: string, ...sections: [string, string][]): string =>
  `---\ntitle: ${title}\ntype: note\n---\n${sections
    .map(([heading, body]) => `## ${heading}\n${body}\n`)
    .join('')}`;

const pair = (newer: string, older: string) => ({ newer, older });

/** The lint rows of the two supersession rules alone, as `[rule, id, detail]`. */
const supersessionViolations = (db: DatabaseSync): [string, string, string][] =>
  lintMemory({ db })
    .violations.filter((v) => SUPERSESSION_RULES.has(v.rule as string))
    .map((v) => [v.rule, v.id, v.detail]);

/**
 * The `unresolved-supersession` rows alone. Extraction and resolution fixtures declare pairs
 * without quoting, so the `unquoted` rows they also produce belong to the lint tests below.
 */
const unresolvedSupersession = (db: DatabaseSync): [string, string, string][] =>
  supersessionViolations(db).filter(([rule]) => rule === UNRESOLVED_SUPERSESSION);
const violationsOf = (db: DatabaseSync, rule: string): [string, string][] =>
  lintMemory({ db })
    .violations.filter((v) => (v.rule as string) === rule)
    .map((v) => [v.id, v.detail]);

describe('supersession extraction — line rules', () => {
  // A key taken by a first-match `match` without the global flag loses `gamma`; a row per
  // matching line or per rule writes `beta` and `nowhere` twice (a strict INSERT throws, a
  // loose table lists two violations); a rule run over the parsed prose skips the fenced
  // `delta`; one run over the raw file text reads `fm` out of the frontmatter and `head` out of
  // the H2 line; a table keyed without the direction folds the two `nowhere` rows into one.
  it('makes one row per (direction, key) over every match of every matching body line, fence included, and reads neither the frontmatter nor an H2 line', () => {
    writeDoc(
      'notes/alpha.md',
      [
        '---',
        'title: Alpha',
        'type: note',
        'note: "Supersedes: doc:fm"',
        '---',
        '## Supersedes: doc:head',
        'Supersedes: doc:beta and doc:gamma',
        'Replaces: doc:beta and Supersedes: doc:nowhere',
        'Superseded by: doc:nowhere',
        '```',
        'Supersedes: doc:delta',
        '```',
        '',
      ].join('\n'),
    );
    for (const name of ['beta', 'gamma', 'delta']) {
      writeDoc(`notes/${name}.md`, typed(name, ['Topic', `${name} text.`]));
    }
    const db = open('lines.db');
    ingestMemory({
      db,
      root,
      config: {
        include: INCLUDE,
        supersedes: [SUPERSEDES_RULE, REPLACES_RULE, SUPERSEDED_BY_RULE],
      },
    });

    expect(listSupersession({ db, id: 'notes/alpha' })).toEqual([
      pair('notes/alpha', 'notes/beta'),
      pair('notes/alpha', 'notes/delta'),
      pair('notes/alpha', 'notes/gamma'),
    ]);
    expect(unresolvedSupersession(db)).toEqual([
      [UNRESOLVED_SUPERSESSION, 'notes/alpha', 'superseded-by nowhere'],
      [UNRESOLVED_SUPERSESSION, 'notes/alpha', 'supersedes nowhere'],
    ]);
  });

  // A resolver that tries the ticket first, or only, leaves `300` NULL (two documents carry
  // that ticket) and never finds `target`; one that matches the name case-sensitively leaves
  // `Target2` NULL; one that picks the first of two same-named documents in id order takes
  // `notes/a/target`, so the same-directory candidate is the one that sorts second; one that
  // keeps the declaring document as a candidate resolves `alpha`
  // to itself and `555` to the declaring document; one that takes any document sharing the
  // ticket resolves `2071` to one of two.
  it('resolves a key by document name first (same directory preferred, case-insensitive), else by the one document with that ticket, else leaves it unresolved', () => {
    writeDoc(
      'notes/x/alpha.md',
      typed(
        'Alpha',
        ['Topic', 'Supersedes: doc:target'],
        ['Two', 'Supersedes: doc:Target2'],
        ['Three', 'Supersedes: doc:192'],
        ['Four', 'Supersedes: doc:2071'],
        ['Five', 'Supersedes: doc:300'],
        ['Six', 'Supersedes: doc:404'],
        ['Seven', 'Supersedes: doc:alpha'],
      ),
    );
    writeDoc('notes/a/target.md', typed('Target elsewhere', ['Topic', 'other.']));
    writeDoc('notes/x/target.md', typed('Target here', ['Topic', 'here.']));
    writeDoc('notes/y/target2.md', typed('Target two', ['Topic', 'two.']));
    writeDoc('notes/r/0192-old.md', typed('RFC 192', ['Topic', 'old.']));
    writeDoc('notes/r/2071-first.md', typed('RFC 2071 a', ['Topic', 'a.']));
    writeDoc('notes/r/2071-second.md', typed('RFC 2071 b', ['Topic', 'b.']));
    writeDoc('notes/300.md', typed('Named 300', ['Topic', 'named.']));
    writeDoc('notes/r/0300-a.md', typed('RFC 300', ['Topic', 'ticketed.']));
    writeDoc('notes/r/0555-self.md', typed('Self', ['Topic', 'Supersedes: doc:555']));
    const db = open('resolve.db');
    ingestMemory({
      db,
      root,
      config: {
        include: INCLUDE,
        ticket: [{ from: 'path', pattern: '[1-9][0-9]*' }],
        supersedes: [SUPERSEDES_RULE],
      },
    });

    expect(listSupersession({ db, id: 'notes/x/alpha' })).toEqual([
      pair('notes/x/alpha', 'notes/300'),
      pair('notes/x/alpha', 'notes/r/0192-old'),
      pair('notes/x/alpha', 'notes/x/target'),
      pair('notes/x/alpha', 'notes/y/target2'),
    ]);
    expect(listSupersession({ db, id: 'notes/a/target' })).toEqual([]);
    expect(listSupersession({ db, id: 'notes/r/0555-self' })).toEqual([]);
    expect(violationsOf(db, UNRESOLVED_SUPERSESSION)).toEqual([
      ['notes/r/0555-self', 'supersedes 555'],
      ['notes/x/alpha', 'supersedes 2071'],
      ['notes/x/alpha', 'supersedes 404'],
      ['notes/x/alpha', 'supersedes alpha'],
    ]);
  });

  // A marker line stored with no key match writes a row with an empty raw target, which the
  // resolver leaves NULL and lint then reports as `supersedes ` with nothing after it.
  it('writes no row and no lint line for a marker line on which the key matches nothing', () => {
    writeDoc('notes/alpha.md', typed('Alpha', ['Topic', 'Supersedes: nothing named here']));
    writeDoc('notes/beta.md', typed('Beta', ['Topic', 'beta text.']));
    const db = open('no-key.db');
    ingestMemory({ db, root, config: CHAIN_CONFIG });

    expect(listSupersession({ db, id: 'notes/alpha' })).toEqual([]);
    expect(supersessionViolations(db)).toEqual([]);
  });

  // A line rule run only over the H2 sections misses the declaration under the H1; a `^`
  // anchor tested against the whole body instead of each line never matches a line after the
  // first; a key pattern applied without the lookahead takes `graph-model.md`; a line pattern
  // compiled with the `i` flag admits the lower-case `replaces:` line and pairs `other` too.
  it('reads an anchored declaration line in the preamble and resolves a markdown link path key by name, matching the line case-sensitively', () => {
    writeDoc(
      'notes/v011.md',
      [
        '# Store design',
        '',
        '> status: accepted',
        '> **Replaces:** [graph-model](graph-model.md) — two items overturned.',
        '> **replaces:** [other](other.md) — not a declaration.',
        '',
        '## Body',
        'text.',
        '',
      ].join('\n'),
    );
    writeDoc('notes/graph-model.md', typed('Graph model', ['Topic', 'older.']));
    writeDoc('notes/other.md', typed('Other', ['Topic', 'other.']));
    const db = open('preamble.db');
    ingestMemory({
      db,
      root,
      config: {
        include: INCLUDE,
        supersedes: [
          {
            line: '^> \\*\\*Replaces:\\*\\*',
            key: '[\\w.-]+(?=\\.md\\))',
            direction: 'supersedes',
          },
        ],
      },
    });

    expect(listSupersession({ db, id: 'notes/v011' })).toEqual([
      pair('notes/v011', 'notes/graph-model'),
    ]);
    expect(listSupersession({ db, id: 'notes/other' })).toEqual([]);
    expect(unresolvedSupersession(db)).toEqual([]);
  });

  // A name match that compares the key to the last path segment alone never finds the
  // document whose whole id the key spells; one that tests `endsWith(key)` without the `/`
  // boundary resolves `target` to `notes/mytarget`.
  it('resolves a key equal to the whole document id and leaves a key that is only an unbounded suffix of an id unresolved', () => {
    writeDoc(
      'notes/alpha.md',
      typed('Alpha', ['Topic', 'Supersedes: doc:notes/beta'], ['Two', 'Supersedes: doc:target']),
    );
    writeDoc('notes/beta.md', typed('Beta', ['Topic', 'beta text.']));
    writeDoc('notes/mytarget.md', typed('My target', ['Topic', 'suffix text.']));
    const db = open('name-shapes.db');
    ingestMemory({
      db,
      root,
      config: {
        include: INCLUDE,
        supersedes: [{ ...SUPERSEDES_RULE, key: '(?<=doc:)[A-Za-z0-9/-]+' }],
      },
    });

    expect(listSupersession({ db, id: 'notes/alpha' })).toEqual([
      pair('notes/alpha', 'notes/beta'),
    ]);
    expect(listSupersession({ db, id: 'notes/mytarget' })).toEqual([]);
    expect(violationsOf(db, UNRESOLVED_SUPERSESSION)).toEqual([
      ['notes/alpha', 'supersedes target'],
    ]);
  });
});

describe('ingestMemory — supersession rows follow the documents and the rules', () => {
  const A = 'notes/a';
  const B = 'notes/b';
  const G = 'notes/g';
  const A_TEXT = typed('A', ['Topic', 'Supersedes: doc:b'], ['Notes', 'Replaces: doc:g']);
  const B_TEXT = typed('B', ['Topic', 'b text.']);
  const G_TEXT = typed('G', ['Topic', 'g text.']);
  /** Every pair and every supersession lint row the index holds, for an equality across builds. */
  const snapshot = (db: DatabaseSync) => ({
    a: listSupersession({ db, id: A }),
    b: listSupersession({ db, id: B }),
    g: listSupersession({ db, id: G }),
    lint: supersessionViolations(db),
  });

  // A resolution done once per replaced document leaves `b` NULL when `b.md` arrives after
  // `a.md` and keeps `dst_concept = notes/b` after `b.md` is gone; a content hash that leaves
  // `supersedes` out skips the unchanged `a.md` when the rules change, so the rows still say
  // `b` under a rule that no longer admits the line, and the first declaration of rules over an
  // already-indexed tree extracts nothing; rows without a cascade survive the deletion of `a`.
  it('re-resolves when only the target is added or removed, re-extracts when only the rules change, and follows the edit and deletion of the declaring document', () => {
    writeDoc('notes/a.md', A_TEXT);
    writeDoc('notes/b.md', B_TEXT);
    const db = open('follow.db');
    ingestMemory({ db, root, config: BASE_CONFIG });
    expect(listSupersession({ db, id: A })).toEqual([]);
    expect(unresolvedSupersession(db)).toEqual([]);

    ingestMemory({ db, root, config: CHAIN_CONFIG });
    expect(listSupersession({ db, id: A })).toEqual([pair(A, B)]);
    expect(listSupersession({ db, id: B })).toEqual([pair(A, B)]);

    rmSync(join(root, 'notes/b.md'));
    ingestMemory({ db, root, config: CHAIN_CONFIG });
    expect(listSupersession({ db, id: A })).toEqual([]);
    expect(listSupersession({ db, id: B })).toBeUndefined();
    expect(unresolvedSupersession(db)).toEqual([[UNRESOLVED_SUPERSESSION, A, 'supersedes b']]);

    writeDoc('notes/b.md', B_TEXT);
    ingestMemory({ db, root, config: CHAIN_CONFIG });
    expect(listSupersession({ db, id: B })).toEqual([pair(A, B)]);
    expect(unresolvedSupersession(db)).toEqual([]);

    writeDoc('notes/g.md', G_TEXT);
    ingestMemory({ db, root, config: { include: INCLUDE, supersedes: [REPLACES_RULE] } });
    expect(listSupersession({ db, id: A })).toEqual([pair(A, G)]);
    expect(listSupersession({ db, id: B })).toEqual([]);

    writeDoc('notes/a.md', typed('A', ['Topic', 'Supersedes: doc:g']));
    ingestMemory({ db, root, config: CHAIN_CONFIG });
    expect(listSupersession({ db, id: A })).toEqual([pair(A, G)]);

    rmSync(join(root, 'notes/a.md'));
    ingestMemory({ db, root, config: CHAIN_CONFIG });
    expect(listSupersession({ db, id: A })).toBeUndefined();
    expect(listSupersession({ db, id: G })).toEqual([]);
    expect(unresolvedSupersession(db)).toEqual([]);
  });

  // A resolution that runs per document as it is replaced answers differently depending on
  // whether the target or the declaring document was indexed first; a rebuild that drops the
  // table and an incremental ingest that keeps it must land on the same rows.
  it('lands on the same pairs and lint rows whether built at once, targets first, or declaring document first', () => {
    writeDoc('notes/a.md', A_TEXT);
    writeDoc('notes/b.md', B_TEXT);
    writeDoc('notes/g.md', G_TEXT);
    const config: MemoryConfig = { include: INCLUDE, supersedes: [SUPERSEDES_RULE, REPLACES_RULE] };
    const atOnce = open('at-once.db');
    ingestMemory({ db: atOnce, root, config, rebuild: true });
    const expected = snapshot(atOnce);
    expect(expected.a).toEqual([pair(A, B), pair(A, G)]);
    expect(expected.lint.filter(([rule]) => rule === UNRESOLVED_SUPERSESSION)).toEqual([]);

    const targetsFirst = open('targets-first.db');
    ingestMemory({ db: targetsFirst, root, config: { ...config, exclude: ['notes/a.md'] } });
    expect(listSupersession({ db: targetsFirst, id: A })).toBeUndefined();
    ingestMemory({ db: targetsFirst, root, config });

    const declaringFirst = open('declaring-first.db');
    ingestMemory({
      db: declaringFirst,
      root,
      config: { ...config, exclude: ['notes/b.md', 'notes/g.md'] },
    });
    expect(listSupersession({ db: declaringFirst, id: A })).toEqual([]);
    ingestMemory({ db: declaringFirst, root, config });

    expect(snapshot(targetsFirst)).toEqual(expected);
    expect(snapshot(declaringFirst)).toEqual(expected);
  });
});

describe('searchMemory — superseded documents rank in the deprecated tier and carry supersededBy', () => {
  /**
   * Five documents whose matched sections share one body, so under score and id alone the
   * order is the id order — and the two superseded documents sort first by id. The declaring
   * lines sit in a section the query never matches, so they change no score. `z-newest`
   * supersedes `a-old` and `b-older`; `a-old` supersedes `b-older`; `c-deprecated` carries
   * `status: deprecated`; `y-plain` is untouched.
   */
  const QUERY = 'needleword';
  const TOPIC = `${QUERY} here.`;
  const NEWEST = 'notes/z-newest';
  const OLD = 'notes/a-old';
  const OLDER = 'notes/b-older';
  const DEPRECATED = 'notes/c-deprecated';
  const PLAIN = 'notes/y-plain';
  function writeChain(): void {
    writeDoc(
      'notes/z-newest.md',
      typed('Newest', ['Topic', TOPIC], ['Notes', 'Supersedes: doc:a-old and doc:b-older']),
    );
    writeDoc(
      'notes/a-old.md',
      typed('Old', ['Topic', TOPIC], ['Notes', 'Supersedes: doc:b-older']),
    );
    writeDoc('notes/b-older.md', typed('Older', ['Topic', TOPIC]));
    writeDoc(
      'notes/c-deprecated.md',
      `---\ntitle: Deprecated\ntype: note\nstatus: deprecated\n---\n## Topic\n${TOPIC}\n`,
    );
    writeDoc('notes/y-plain.md', typed('Plain', ['Topic', TOPIC]));
  }

  // A ranking that ignores supersession keeps `a-old` and `b-older` first; one that puts
  // superseded sections after deprecated ones, or in a tier of their own before them, moves
  // `c-deprecated`; one that demotes the newer side too moves `z-newest` down; a
  // `supersededBy` that follows the chain lists `z-newest` on `b-older` twice or via `a-old`
  // only, one unsorted lists `z-newest` before `a-old`, one left undefined on an untouched
  // document is not the empty array.
  it("orders superseded sections after every non-superseded non-deprecated one, in the deprecated tier, and lists each section's direct newer documents sorted", async () => {
    writeChain();
    const db = open('rank.db');
    ingestMemory({ db, root, config: CHAIN_CONFIG });

    const results = await searchMemory({ db, query: QUERY });

    expect(results.map((r) => [r.id, r.supersededBy])).toEqual([
      [`${PLAIN}#topic`, []],
      [`${NEWEST}#topic`, []],
      [`${OLD}#topic`, [NEWEST]],
      [`${OLDER}#topic`, [OLD, NEWEST]],
      [`${DEPRECATED}#topic`, []],
    ]);
  });

  // A supersession tier that filters, dedupes, or re-matches changes the row set or the match
  // path tag the same corpus answers without the rules; without rules, a `supersededBy` left
  // off the result or filled from a stale table is not the empty array.
  it('keeps the result id set and match paths of the rule-free corpus, which itself carries supersededBy: [] everywhere and ranks by id', async () => {
    writeChain();
    const withRules = open('with-rules.db');
    ingestMemory({ db: withRules, root, config: CHAIN_CONFIG });
    const without = open('without-rules.db');
    ingestMemory({ db: without, root, config: BASE_CONFIG });

    const ruled = await searchMemory({ db: withRules, query: QUERY });
    const plain = await searchMemory({ db: without, query: QUERY });

    const asSet = (rows: typeof plain) => rows.map((r) => [r.id, r.matchPath]).sort();
    expect(asSet(ruled)).toEqual(asSet(plain));
    expect(plain.map((r) => r.id)).toEqual([
      `${OLD}#topic`,
      `${OLDER}#topic`,
      `${PLAIN}#topic`,
      `${NEWEST}#topic`,
      `${DEPRECATED}#topic`,
    ]);
    expect(plain.map((r) => r.supersededBy)).toEqual(plain.map(() => []));
    expect(supersessionViolations(without)).toEqual([]);
  });

  // A tier applied as a score penalty rather than a partition lets a superseded section with
  // enough repetitions of the term climb back above the plain one; a tier that sorts by id
  // instead of score puts `r-older` before the better-scoring `s-old`. The rule-free order is
  // asserted first so the fixture is known to give the superseded sections the better scores.
  it('keeps a superseded section behind a plain one it outscores, and keeps score order inside the superseded tier', async () => {
    const many = Array.from({ length: 6 }, () => QUERY).join(' ');
    const some = Array.from({ length: 3 }, () => QUERY).join(' ');
    writeDoc(
      'notes/t-new.md',
      typed('New', ['Topic', `${QUERY} here.`], ['Notes', 'Supersedes: doc:s-old and doc:r-older']),
    );
    writeDoc('notes/s-old.md', typed('Old', ['Topic', `${many}.`]));
    writeDoc('notes/r-older.md', typed('Older', ['Topic', `${some}.`]));
    writeDoc('notes/u-plain.md', typed('Plain', ['Topic', `${QUERY} once.`]));
    const without = open('score-without.db');
    ingestMemory({ db: without, root, config: BASE_CONFIG });
    const plain = await searchMemory({ db: without, query: QUERY });
    expect(plain.map((r) => r.id).slice(0, 2)).toEqual([
      'notes/s-old#topic',
      'notes/r-older#topic',
    ]);
    const withRules = open('score-with.db');
    ingestMemory({ db: withRules, root, config: CHAIN_CONFIG });

    const ruled = await searchMemory({ db: withRules, query: QUERY });

    expect(ruled.map((r) => r.id).slice(-2)).toEqual(['notes/s-old#topic', 'notes/r-older#topic']);
    expect(
      ruled
        .map((r) => r.id)
        .slice(0, 2)
        .sort(),
    ).toEqual(['notes/t-new#topic', 'notes/u-plain#topic']);
  });
});

describe('listSupersession', () => {
  const A = 'notes/a';
  const B = 'notes/b';
  const C = 'notes/c';
  const E = 'notes/e';
  /** A supersedes B and E; C says B supersedes it, so (B, C) comes from the `superseded-by` side. */
  function writeTree(): void {
    writeDoc('notes/a.md', typed('A', ['Topic', 'Supersedes: doc:b and doc:e']));
    writeDoc('notes/b.md', typed('B', ['Topic', 'b text.']));
    writeDoc('notes/c.md', typed('C', ['Topic', 'Superseded by: doc:b']));
    writeDoc('notes/e.md', typed('E', ['Topic', 'e text.']));
    writeDoc('notes/lone.md', typed('Lone', ['Topic', 'lone text.']));
  }

  // A walk that follows only one direction misses (A, B) from C or (B, C) from B; one that
  // follows the newer document's other older documents adds (A, E) to B's answer; a
  // `superseded-by` row mapped with the declaring document as the newer side yields (C, B);
  // an unsorted answer or one sorted by older first diverges from (newer, older).
  it('returns every pair on the chain through the document in both directions, sorted by (newer, older), and no sibling branch', () => {
    writeTree();
    const db = open('chain.db');
    ingestMemory({ db, root, config: BOTH_DIRECTIONS_CONFIG });

    expect(listSupersession({ db, id: B })).toEqual([pair(A, B), pair(B, C)]);
    expect(listSupersession({ db, id: C })).toEqual([pair(A, B), pair(B, C)]);
    expect(listSupersession({ db, id: E })).toEqual([pair(A, E)]);
    expect(listSupersession({ db, id: A })).toEqual([pair(A, B), pair(A, E), pair(B, C)]);
  });

  // An unknown document answered with `[]` reads as a document with no pairs; a document
  // with no pairs answered with `undefined` reads as unknown; a section id is not a document.
  it('answers undefined for an unknown id and [] for a document with no pair', () => {
    writeTree();
    const db = open('none.db');
    ingestMemory({ db, root, config: BOTH_DIRECTIONS_CONFIG });

    expect(listSupersession({ db, id: 'notes/lone' })).toEqual([]);
    expect(listSupersession({ db, id: 'notes/nowhere' })).toBeUndefined();
    expect(listSupersession({ db, id: `${A}#topic` })).toBeUndefined();
  });

  // A walk without a visited set never returns on X ⇄ Y; one that stops at the first repeated
  // document before recording the closing pair drops (Y, X).
  it('terminates on a cycle and returns both pairs of it', () => {
    writeDoc('notes/x.md', typed('X', ['Topic', 'Supersedes: doc:y']));
    writeDoc('notes/y.md', typed('Y', ['Topic', 'Supersedes: doc:x']));
    const db = open('cycle.db');
    ingestMemory({ db, root, config: CHAIN_CONFIG });

    expect(listSupersession({ db, id: 'notes/x' })).toEqual([
      pair('notes/x', 'notes/y'),
      pair('notes/y', 'notes/x'),
    ]);
  });
});

describe('lintMemory — unquoted', () => {
  const NEWER = 'notes/v011';
  const OLDER = 'notes/graph-model';
  /**
   * The older document's items are the two lines of `memory.adr.graph-model.md` that the
   * v0.11 store-design ADR overturns, as written there: bold markers, an italic word, an
   * inline code span, and a line break inside the parenthesis.
   */
  const OLDER_ITEMS = [
    '3. **dangling은 침묵 누락이 아니라 *거부*** — ingest 시 dst public_id가 없으면 에러. memoriq의',
    '   "조용히 버림"을 "명시적 실패"로 뒤집는다.',
    '5. **ingest-time link 요구** — 같은 ticket/area에 기존 row가 있는데 link 0개면 차단(`--no-link`',
    '   명시 예외). 81.5% 고립을 *결정론적으로* 막는다. (roadmap KB-05)',
  ].join('\n');
  /** The v0.11 ADR's D6 paragraph as written, with its two 「」 quotations spanning line breaks. */
  const QUOTE_ONE =
    '「dangling은 침묵 누락이\n아니라 *거부* — ingest 시 dst public_id가 없으면 에러」';
  const QUOTE_TWO =
    '「ingest-time link 요구 — 같은 ticket/area에\n기존 row가 있는데 link 0개면 차단(`--no-link` 명시 예외)」';
  const NEWER_PARAGRAPH = [
    `**이 결정은 \`memory.adr.graph-model.md\`의 두 항목을 대체한다.** 그 ADR은 ${QUOTE_ONE}와 ${QUOTE_TWO}을 정했다. DB가 원문의 파생물이 된 뒤로`,
    'ingest가 거부하면 DB와 원문이 어긋나고, 거부된 문서는 git에 그대로 남는다. 판정은 원문이 쓰이는',
    '자리(커밋 표면)로 옮기고, ingest는 dangling을 버리지도 거부하지도 않고 기록한다. OKF도 소비자가',
    '깨진 링크를 거부하지 말라고 정한다. 같은 ADR의 나머지 결정(edge는 1급 테이블 · 참조는 안정',
    '식별자 · same-ticket 추론)은 그대로다.',
  ].join('\n');
  const DECLARATION = 'Supersedes: doc:graph-model';

  function writeOlder(): void {
    writeDoc('notes/graph-model.md', typed('Graph model', ['Decision', OLDER_ITEMS]));
  }
  function writeNewer(body: string): void {
    writeDoc('notes/v011.md', typed('Store design', ['D6', `${DECLARATION}\n${body}`]));
  }

  // A comparison over the raw text finds neither quotation: the first differs from the item
  // by `**` around the phrase and a line break, the second by the line break inside the
  // parenthesis; a normalization that removes `*` only on one side, or collapses whitespace
  // on one side only, misses them too.
  it('reports nothing for the store-design ADR paragraph quoting the graph-model ADR items it overturns', () => {
    writeOlder();
    writeNewer(NEWER_PARAGRAPH);
    const db = open('real.db');
    ingestMemory({ db, root, config: CHAIN_CONFIG });

    expect(listSupersession({ db, id: NEWER })).toEqual([pair(NEWER, OLDER)]);
    expect(violationsOf(db, UNQUOTED)).toEqual([]);
  });

  // Documents written from one template share their head blockquote lines verbatim, so a
  // check that reads blockquotes before the first H2 lets that shared line stand in for a
  // quotation neither document makes.
  it('does not count a blockquote line of the text before the first H2 as a quotation', () => {
    const head = '> Written with: the shared planning template, section by section.';
    writeDoc(
      'notes/graph-model.md',
      `---\ntitle: Graph model\ntype: note\n---\n${head}\n\n## Decision\n${OLDER_ITEMS}\n`,
    );
    writeDoc(
      'notes/v011.md',
      `---\ntitle: Store design\ntype: note\n---\n${head}\n\n## D6\n${DECLARATION}\nNothing quoted.\n`,
    );
    const db = open('template-head.db');
    ingestMemory({ db, root, config: CHAIN_CONFIG });

    expect(listSupersession({ db, id: NEWER })).toEqual([pair(NEWER, OLDER)]);
    expect(violationsOf(db, UNQUOTED)).toEqual([[NEWER, OLDER]]);
  });

  // A check that treats any 「」 or any sentence of the newer document as a quotation, or that
  // never runs, stays silent on a declaration that quotes nothing; a violation keyed on the
  // older document or with the newer one as its detail sends the reader to the wrong file.
  it('reports one unquoted violation on the newer document naming the older one when the quotations are removed', () => {
    writeOlder();
    writeNewer(NEWER_PARAGRAPH.replace(QUOTE_ONE, '두 항목').replace(QUOTE_TWO, '한 항목'));
    const db = open('unquoted.db');
    ingestMemory({ db, root, config: CHAIN_CONFIG });

    expect(listSupersession({ db, id: NEWER })).toEqual([pair(NEWER, OLDER)]);
    expect(violationsOf(db, UNQUOTED)).toEqual([[NEWER, OLDER]]);
  });

  // Each form alone is the quotation: a check that reads only 「」 misses the blockquote and
  // the curly quotes; one that compares text as written misses a link written where the item
  // has a bare word, a code span dropped, a wikilink alias, or an italic marker dropped.
  it.each([
    {
      form: 'a blockquote line differing by an italic marker',
      body: '> 81.5% 고립을 결정론적으로 막는다.',
    },
    {
      form: 'curly quotes with a markdown link and the code span dropped',
      body: '“같은 ticket/area에 기존 row가 있는데 [link](https://example.test/link) 0개면 차단(--no-link 명시 예외)”',
    },
    {
      form: 'corner brackets with a wikilink alias standing for the item words',
      body: '「[[graph-model|ingest-time link 요구]] — 같은 ticket/area에」',
    },
    {
      form: 'a blockquote line whose own > marker is stripped before comparing',
      body: '> > memoriq의 "조용히 버림"을 "명시적 실패"로 뒤집는다.',
    },
  ])('accepts $form', ({ body }) => {
    writeOlder();
    writeNewer(body);
    const db = open('forms.db');
    ingestMemory({ db, root, config: CHAIN_CONFIG });

    expect(listSupersession({ db, id: NEWER })).toEqual([pair(NEWER, OLDER)]);
    expect(violationsOf(db, UNQUOTED)).toEqual([]);
  });

  // An empty quotation normalizes to the empty string, which every text contains: a check
  // without the non-empty condition accepts 「」, “”, and a bare `>` line as quotations. A
  // quotation of words the older document never wrote must not count either, nor may the
  // declaration line itself, which the newer document always contains.
  it.each([
    { form: 'empty corner brackets', body: '「」' },
    { form: 'empty curly quotes', body: '“”' },
    { form: 'a blockquote of whitespace', body: '>   ' },
    {
      form: 'a quotation the older document does not contain',
      body: '「이 문장은 어디에도 없다」',
    },
    {
      form: 'a matching sentence inside straight ASCII double quotes',
      body: '"81.5% 고립을 결정론적으로 막는다."',
    },
  ])('still reports unquoted for $form', ({ body }) => {
    writeOlder();
    writeNewer(body);
    const db = open('degenerate.db');
    ingestMemory({ db, root, config: CHAIN_CONFIG });

    expect(violationsOf(db, UNQUOTED)).toEqual([[NEWER, OLDER]]);
  });

  // A normalization run over the quotation only leaves the older text with its link target,
  // wikilink brackets, blockquote marker, reference label, tildes, or image syntax, so a bare
  // quotation of the visible words never matches; a reference link or strikethrough left
  // unhandled on the quotation side misses the same way.
  it.each([
    {
      form: 'a markdown link in the older text',
      older: 'the [link](https://example.test/x) applies here.',
      quote: '「the link applies here.」',
    },
    {
      form: 'a wikilink alias in the older text',
      older: 'see [[graph-model|the model]] first.',
      quote: '「see the model first.」',
    },
    {
      form: 'a blockquote marker in the older text',
      older: '> quoted line in the older document.',
      quote: '「quoted line in the older document.」',
    },
    {
      form: 'a reference-style link in the older text',
      older: 'refer to [text][ref] here.\n\n[ref]: https://example.test/ref',
      quote: '「refer to text here.」',
    },
    {
      form: 'a strikethrough in the older text',
      older: 'this is ~~struck~~ through.',
      quote: '「this is struck through.」',
    },
    {
      form: 'an image in the older text, standing for its alt text',
      older: 'an ![alt text](img.png) inline.',
      quote: '「an alt text inline.」',
    },
    {
      form: 'a reference-style link in the quotation',
      older: 'refer to text here.',
      quote: '“refer to [text][ref] here.”',
    },
    {
      form: 'a strikethrough in the quotation',
      older: 'this is struck through.',
      quote: '> this is ~~struck~~ through.',
    },
  ])('accepts $form', ({ older, quote }) => {
    writeDoc('notes/graph-model.md', typed('Graph model', ['Decision', older]));
    writeNewer(quote);
    const db = open('older-side.db');
    ingestMemory({ db, root, config: CHAIN_CONFIG });

    expect(listSupersession({ db, id: NEWER })).toEqual([pair(NEWER, OLDER)]);
    expect(violationsOf(db, UNQUOTED)).toEqual([]);
  });

  // A comparison over the older document's first section alone misses a sentence in its
  // second; one over the newer document's declaring section alone misses a quotation placed
  // in a later section.
  it('finds the quoted sentence in any section of the older document and the quotation in any section of the newer one', () => {
    writeDoc(
      'notes/graph-model.md',
      typed('Graph model', ['First', 'nothing relevant.'], ['Second', 'the sentence lives here.']),
    );
    writeDoc(
      'notes/v011.md',
      typed('Store design', ['D6', DECLARATION], ['Later', '「the sentence lives here.」']),
    );
    const db = open('scope.db');
    ingestMemory({ db, root, config: CHAIN_CONFIG });

    expect(listSupersession({ db, id: NEWER })).toEqual([pair(NEWER, OLDER)]);
    expect(violationsOf(db, UNQUOTED)).toEqual([]);
  });

  // The older document's `superseded by` line is not the newer author's declaration: a check
  // over every resolved pair reports the newer document for a quotation it was never asked
  // to write. The pair itself must still exist, or the silence proves nothing.
  it('never reports a pair that comes from a superseded-by row', () => {
    writeDoc(
      'notes/graph-model.md',
      typed('Graph model', ['Decision', `Superseded by: doc:v011\n${OLDER_ITEMS}`]),
    );
    writeDoc('notes/v011.md', typed('Store design', ['D6', '두 항목을 대체한다.']));
    const db = open('superseded-by.db');
    ingestMemory({ db, root, config: BOTH_DIRECTIONS_CONFIG });

    expect(listSupersession({ db, id: NEWER })).toEqual([pair(NEWER, OLDER)]);
    expect(violationsOf(db, UNQUOTED)).toEqual([]);
  });

  // A list sorted by id across rules interleaves `notes/linker` with the supersession rows;
  // one that puts the two new rules before `untyped`, or `unquoted` before
  // `unresolved-supersession`, or sorts a rule's rows by detail before id, diverges here; a
  // list that drops a rule leaves fewer than six rows.
  it('orders violations by rule — unresolved, untyped, unresolved-supersession, unquoted — then id, then detail', () => {
    writeOlder();
    writeDoc(
      'notes/v011.md',
      typed('Store design', ['D6', `${DECLARATION}\nSupersedes: doc:zz-gone and doc:aa-gone`]),
    );
    writeDoc('notes/second.md', typed('Second', ['Topic', DECLARATION]));
    writeDoc('notes/linker.md', typed('Linker', ['Topic', '[[nowhere]] here.']));
    writeDoc('notes/untyped.md', '---\ntitle: Untyped\n---\n## Topic\nplain.\n');
    const db = open('order.db');
    ingestMemory({ db, root, config: CHAIN_CONFIG });

    expect(lintMemory({ db }).violations.map((v) => [v.rule, v.id, v.detail])).toEqual([
      ['unresolved', 'notes/linker#topic', '[[nowhere]]'],
      ['untyped', 'notes/untyped', ''],
      [UNRESOLVED_SUPERSESSION, NEWER, 'supersedes aa-gone'],
      [UNRESOLVED_SUPERSESSION, NEWER, 'supersedes zz-gone'],
      [UNQUOTED, 'notes/second', OLDER],
      [UNQUOTED, NEWER, OLDER],
    ]);
  });
});
