import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingestMemory } from '../src/ingest-memory.ts';
import { listObligations } from '../src/list-obligations.ts';
import type { MemoryConfig } from '../src/memory-config.ts';
import { parseDocument } from '../src/parse-document.ts';
import { replaceDocument } from '../src/replace-document.ts';
import { openMemoryDb } from '../src/schema.ts';

// Marker patterns, key patterns, and section titles are fixture values: nothing in the
// package knows a checkbox, a carry-over word, or this repository's ticket form. Every rule
// below arrives through `obligations`, and the same key pattern serves every line rule so
// that a row can only come from the line pattern that admitted it.
const INCLUDE = ['notes/**/*.md'];
const KEY = '[A-Z]+-[0-9]+';
const CHECKBOX_LINE = '^\\s*[-*] \\[ \\]';
const CARRY_LINE = 'carry-over';
const CHECKBOX_RULE = { line: CHECKBOX_LINE, key: KEY };
const CARRY_RULE = { line: CARRY_LINE, key: KEY };
const SECTION_TITLE = 'Unresolved questions';
const SECTION_ANCHOR = 'unresolved-questions';
const SECTION_RULE = { section: `^${SECTION_TITLE}$` };
/** A title pattern that matches every title, the preamble's empty one included. */
const ANY_SECTION_RULE = { section: '.*' };
const TICKET_FROM_PATH: MemoryConfig['ticket'] = [{ from: 'path', pattern: '[0-9]+' }];
const TICKET_FROM_ISSUE: MemoryConfig['ticket'] = [{ from: 'frontmatter', key: 'issue' }];

let tmp: string;
let root: string;
const opened: DatabaseSync[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pdks-obligations-'));
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

function replace(db: DatabaseSync, id: string, text: string, config: MemoryConfig): void {
  db.exec('BEGIN');
  replaceDocument({ db, document: parseDocument({ id, text }), config });
  db.exec('COMMIT');
}

function writeDoc(relative: string, text: string): void {
  const path = join(root, relative);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, text);
}

type ObligationRow = { section_id: string; ord: number; key: string; text: string };
const obligationRows = (db: DatabaseSync): ObligationRow[] =>
  db
    .prepare('SELECT section_id, ord, key, text FROM obligation ORDER BY section_id, ord, key')
    .all() as ObligationRow[];
const sectionBody = (db: DatabaseSync, id: string): string =>
  (db.prepare('SELECT body FROM section WHERE id = ?').get(id) as { body: string }).body;

describe('obligation extraction — line rules', () => {
  // A key taken by a first-match `match` without the global flag loses `AB-2`; a marker
  // line stored with no key match writes a row with an empty key; a rule that drops the
  // line pattern and keys every line adds `AB-3`; a text stored untrimmed keeps the indent;
  // an `ord` counted over marker lines instead of body lines puts `AB-4` at 2, and one
  // counted from a body that dropped the blank line under the heading puts `AB-1` at 0.
  it('makes one row per key match on a marker line, none for a marker line without a key, and stores the trimmed line at its body line index', () => {
    const db = open('lines.db');
    replace(
      db,
      'notes/a',
      '---\ntitle: A\n---\n## One\n\n- [ ] AB-1 and AB-2 pending\n- [ ] nothing here\nplain AB-3 line\n  * [ ] AB-4 indented\n',
      { include: INCLUDE, obligations: [CHECKBOX_RULE] },
    );

    expect(obligationRows(db)).toEqual([
      { section_id: 'notes/a#one', ord: 1, key: 'AB-1', text: '- [ ] AB-1 and AB-2 pending' },
      { section_id: 'notes/a#one', ord: 1, key: 'AB-2', text: '- [ ] AB-1 and AB-2 pending' },
      { section_id: 'notes/a#one', ord: 4, key: 'AB-4', text: '* [ ] AB-4 indented' },
    ]);
  });

  // Two rules admitting the same line, or the same key twice in one line, hand the same
  // (section, ord, key) to the table twice: an INSERT without a duplicate policy throws
  // and the replacement never commits, and a table keyed too loosely keeps both.
  it('stores one row when two rules admit the same line and when the same key repeats in it', () => {
    const db = open('dedupe.db');
    expect(() =>
      replace(
        db,
        'notes/a',
        '---\ntitle: A\n---\n## One\n- [ ] carry-over AB-1 then AB-1 again\n',
        {
          include: INCLUDE,
          obligations: [CHECKBOX_RULE, CARRY_RULE],
        },
      ),
    ).not.toThrow();

    expect(obligationRows(db)).toEqual([
      {
        section_id: 'notes/a#one',
        ord: 0,
        key: 'AB-1',
        text: '- [ ] carry-over AB-1 then AB-1 again',
      },
    ]);
  });

  // A line rule run only over the H2 sections, as a section rule is, misses the marker line
  // before the first heading, which a grep over the file finds.
  it('reads a marker line in the preamble', () => {
    const db = open('preamble-line.db');
    replace(db, 'notes/p', '# P\n- [ ] AB-5 early\n## One\nbody.\n', {
      include: INCLUDE,
      obligations: [CHECKBOX_RULE],
    });

    expect(obligationRows(db)).toEqual([
      { section_id: 'notes/p#', ord: 1, key: 'AB-5', text: '- [ ] AB-5 early' },
    ]);
  });

  // A rule run over the parsed prose rather than the stored body skips the fenced line; one
  // run over the raw file text reads the frontmatter's carry-over line as an obligation.
  it('reads a marker line inside a code fence and never a frontmatter line', () => {
    const db = open('fence.db');
    replace(
      db,
      'notes/f',
      '---\ntitle: F\nnote: carry-over AB-7\n---\n## One\n```\n- [ ] AB-9\n```\n',
      { include: INCLUDE, obligations: [CHECKBOX_RULE, CARRY_RULE] },
    );

    expect(obligationRows(db)).toEqual([
      { section_id: 'notes/f#one', ord: 1, key: 'AB-9', text: '- [ ] AB-9' },
    ]);
  });
});

describe('obligation extraction — section rules', () => {
  // A key read from the section title or the document title instead of the stored ticket,
  // a text stored as the first line rather than the whole body, an `ord` of 0 colliding
  // with a line row, and a row written for the document whose ticket rule matched nothing
  // all diverge here; a rule that matches by substring also takes `## Unresolved questions
  // (old)`.
  it('stores a section whose title matches as one row keyed by the document ticket at ord -1, and none for a document without a ticket', () => {
    const db = open('section.db');
    const config: MemoryConfig = {
      include: ['text/**/*.md'],
      ticket: TICKET_FROM_PATH,
      obligations: [SECTION_RULE],
    };
    const text = `---\ntitle: RFC text\n---\nlead.\n## ${SECTION_TITLE}\nfirst line.\nsecond line.\n## ${SECTION_TITLE} (old)\nstale.\n## Summary\nbody.\n`;
    replace(db, 'text/2094-nll', text, config);
    replace(db, 'text/no-number', text, config);

    expect(obligationRows(db)).toEqual([
      {
        section_id: `text/2094-nll#${SECTION_ANCHOR}`,
        ord: -1,
        key: '2094',
        text: sectionBody(db, `text/2094-nll#${SECTION_ANCHOR}`),
      },
    ]);
    expect(sectionBody(db, `text/2094-nll#${SECTION_ANCHOR}`)).toBe('first line.\nsecond line.');
  });

  // Two section rules admitting the same section hand (section, -1, ticket) to the table
  // twice; an insert path for section rules without the line rules' duplicate policy throws.
  it('stores one row when two section rules admit the same section', () => {
    const db = open('section-dedupe.db');
    expect(() =>
      replace(db, 'text/2094-nll', `## ${SECTION_TITLE}\nfirst.\n`, {
        include: ['text/**/*.md'],
        ticket: TICKET_FROM_PATH,
        obligations: [SECTION_RULE, { section: 'questions' }],
      }),
    ).not.toThrow();

    expect(obligationRows(db).map((r) => [r.section_id, r.ord, r.key])).toEqual([
      [`text/2094-nll#${SECTION_ANCHOR}`, -1, '2094'],
    ]);
  });

  // The preamble row carries the empty title, and `.*` matches it; a rule applied to every
  // stored section rather than to the H2 sections writes a row for `text/2094-nll#`.
  // An H2 with an empty title (`## {#open}`) is a section, not the preamble: a rule that tells
  // the preamble by its empty title drops it.
  it('never makes a row for the preamble, even under a title pattern that matches the empty title', () => {
    const db = open('preamble.db');
    replace(
      db,
      'text/2094-nll',
      `---\ntitle: RFC text\n---\nlead.\n## ${SECTION_TITLE}\nfirst.\n## Summary\nbody.\n## {#open}\nopen.\n`,
      { include: ['text/**/*.md'], ticket: TICKET_FROM_PATH, obligations: [ANY_SECTION_RULE] },
    );

    expect(obligationRows(db).map((r) => [r.section_id, r.ord, r.key])).toEqual([
      ['text/2094-nll#open', -1, '2094'],
      ['text/2094-nll#summary', -1, '2094'],
      [`text/2094-nll#${SECTION_ANCHOR}`, -1, '2094'],
    ]);
  });
});

describe('listObligations', () => {
  const COUNT = 25;
  // A query that ignores the key returns the `AB-2` row; one ordered by insertion or by
  // ord alone interleaves the two documents; one that puts the line row before the section
  // row of the same section sorts ord 1 before -1; a default limit of 10 or 20 cuts the
  // 25 rows of the second document; a row shape that drops the document title or the
  // section title, or that names the column `sectionId` differently, diverges from the
  // exact value.
  it('returns every row for one key in section id then ord order, with the document and section titles, and no limit', () => {
    const db = open('list.db');
    const config: MemoryConfig = {
      include: INCLUDE,
      ticket: TICKET_FROM_ISSUE,
      obligations: [CHECKBOX_RULE, SECTION_RULE],
    };
    replace(
      db,
      'notes/a',
      `---\ntitle: Doc A\nissue: AB-1\n---\n## ${SECTION_TITLE}\nfirst.\n- [ ] AB-1 second\n## Zeta\n- [ ] AB-2 other\n`,
      config,
    );
    const items = Array.from({ length: COUNT }, (_, i) => `- [ ] AB-1 item ${i}`);
    replace(db, 'notes/b', `---\ntitle: Doc B\n---\n## One\n${items.join('\n')}\n`, config);

    expect(listObligations({ db, key: 'AB-1' })).toEqual([
      {
        key: 'AB-1',
        sectionId: `notes/a#${SECTION_ANCHOR}`,
        docTitle: 'Doc A',
        sectionTitle: SECTION_TITLE,
        text: 'first.\n- [ ] AB-1 second',
      },
      {
        key: 'AB-1',
        sectionId: `notes/a#${SECTION_ANCHOR}`,
        docTitle: 'Doc A',
        sectionTitle: SECTION_TITLE,
        text: '- [ ] AB-1 second',
      },
      ...items.map((text) => ({
        key: 'AB-1',
        sectionId: 'notes/b#one',
        docTitle: 'Doc B',
        sectionTitle: 'One',
        text,
      })),
    ]);
    expect(listObligations({ db, key: 'AB-2' })).toEqual([
      {
        key: 'AB-2',
        sectionId: 'notes/a#zeta',
        docTitle: 'Doc A',
        sectionTitle: 'Zeta',
        text: '- [ ] AB-2 other',
      },
    ]);
    expect(listObligations({ db, key: 'AB-3' })).toEqual([]);
  });
});

describe('ingestMemory — obligation rows follow the documents and the rules', () => {
  const withRules = (obligations: MemoryConfig['obligations']): MemoryConfig => ({
    include: INCLUDE,
    obligations,
  });

  // A replacement that inserts obligation rows without a cascade or an explicit delete
  // keeps `AB-1` beside `AB-3` after the edit and keeps `AB-2` after the file is gone; a
  // content hash that leaves `obligations` out skips every unchanged document when the rules
  // change, so the rows still say `AB-3` under a rule that no longer admits the line, and
  // the first declaration of rules over an already-indexed tree extracts nothing at all.
  it('re-extracts on edit and delete, re-extracts when only the rules change, and matches a rebuild', () => {
    writeDoc('notes/a.md', '---\ntitle: A\n---\n## One\n- [ ] AB-1 x\n');
    writeDoc('notes/b.md', '---\ntitle: B\n---\n## One\n- [ ] AB-2 y\n');
    const db = open('follow.db');
    ingestMemory({ db, root, config: { include: INCLUDE } });
    expect(obligationRows(db)).toEqual([]);

    ingestMemory({ db, root, config: withRules([CHECKBOX_RULE]) });
    expect(obligationRows(db)).toEqual([
      { section_id: 'notes/a#one', ord: 0, key: 'AB-1', text: '- [ ] AB-1 x' },
      { section_id: 'notes/b#one', ord: 0, key: 'AB-2', text: '- [ ] AB-2 y' },
    ]);

    writeDoc('notes/a.md', '---\ntitle: A\n---\n## One\n- [ ] AB-3 x\ncarry-over AB-4 y\n');
    rmSync(join(root, 'notes/b.md'));
    ingestMemory({ db, root, config: withRules([CHECKBOX_RULE]) });
    expect(obligationRows(db)).toEqual([
      { section_id: 'notes/a#one', ord: 0, key: 'AB-3', text: '- [ ] AB-3 x' },
    ]);

    ingestMemory({ db, root, config: withRules([CARRY_RULE]) });
    expect(obligationRows(db)).toEqual([
      { section_id: 'notes/a#one', ord: 1, key: 'AB-4', text: 'carry-over AB-4 y' },
    ]);

    const fresh = open('follow-fresh.db');
    ingestMemory({ db: fresh, root, config: withRules([CARRY_RULE]), rebuild: true });
    expect(obligationRows(fresh)).toEqual(obligationRows(db));
    expect(listObligations({ db: fresh, key: 'AB-4' })).toEqual(
      listObligations({ db, key: 'AB-4' }),
    );
  });
});
