import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeMemoryIndex } from '../src/describe-memory-index.ts';
import { ingestMemory } from '../src/ingest-memory.ts';
import type { MemoryConfig } from '../src/memory-config.ts';
import { openMemoryDb } from '../src/schema.ts';
import { showMemory } from '../src/show-memory.ts';

// Two documents whose stored `ticket` column holds the same non-NULL string are related to
// each other. Nothing is stored for it: `showMemory` lists the related documents from the
// `concept` rows at the time of the call, and `describeMemoryIndex` counts a document that
// has such a partner as connected. Explicit links keep their own counts and rules.

// Globs and the ticket pattern are fixture values: nothing in the functions knows this
// repository's layout or ticket identifiers.
const INCLUDE = ['notes/**/*.md'];
const TICKET_CONFIG: MemoryConfig = {
  include: INCLUDE,
  ticket: [{ from: 'title', pattern: 'RQ-[0-9]+' }],
};
const NO_TICKET_CONFIG: MemoryConfig = { include: INCLUDE };

let tmp: string;
let root: string;
const opened: DatabaseSync[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pdks-same-ticket-'));
  root = join(tmp, 'tree');
  mkdirSync(root);
});

afterEach(() => {
  for (const db of opened.splice(0)) {
    try {
      db.close();
    } catch {
      // already closed by the test
    }
  }
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

/** A typed document with one H2 section, so no untyped violation enters a lint result. */
const page = (title: string, body = 'plain text.'): string =>
  `---\ntitle: ${title}\ntype: note\n---\n## One {#one}\n${body}\n`;

describe('showMemory — documents sharing a ticket', () => {
  // A list that includes the document itself adds `notes/a` to its own list; one in
  // insertion order puts `notes/c` (written first) before `notes/b`; a comparison by prefix
  // or LIKE relates `RQ-7` to `RQ-70`; a list computed one way only leaves `notes/b`'s
  // empty; a section result that copies the document's list gains a key it never had.
  it('lists the other documents with the same stored ticket in ascending id order, exactly matched, and nothing for a ticket held by one document', () => {
    writeDoc('notes/c.md', page('Gamma RQ-7'));
    writeDoc('notes/a.md', page('Alpha RQ-7'));
    writeDoc('notes/b.md', page('Beta RQ-7'));
    writeDoc('notes/d.md', page('Delta RQ-9'));
    writeDoc('notes/e.md', page('Epsilon RQ-70'));
    const db = open('related.db');
    ingestMemory({ db, root, config: TICKET_CONFIG });

    expect(showMemory({ db, id: 'notes/a' })).toMatchObject({ related: ['notes/b', 'notes/c'] });
    expect(showMemory({ db, id: 'notes/b' })).toMatchObject({ related: ['notes/a', 'notes/c'] });
    expect(showMemory({ db, id: 'notes/d' })).toMatchObject({ related: [] });
    expect(showMemory({ db, id: 'notes/e' })).toMatchObject({ related: [] });
    expect(showMemory({ db, id: 'notes/a#one' })).not.toHaveProperty('related');
  });

  // A frontmatter rule without a pattern stores the value as written, so two spellings of
  // one identifier reach the column; a LIKE, NOCASE, trim, or lower comparison relates them.
  it('relates only documents whose stored tickets are the same string, not a case or whitespace variant', () => {
    const typed = (title: string, ticket: string): string =>
      `---\ntitle: ${title}\ntype: note\nticket: ${ticket}\n---\n## One {#one}\nplain text.\n`;
    writeDoc('notes/upper.md', typed('Upper', 'RQ-7'));
    writeDoc('notes/partner.md', typed('Partner', 'RQ-7'));
    writeDoc('notes/lower.md', typed('Lower', 'rq-7'));
    writeDoc('notes/spaced.md', typed('Spaced', '"RQ-7 "'));
    const db = open('spelling.db');
    ingestMemory({
      db,
      root,
      config: { include: INCLUDE, ticket: [{ from: 'frontmatter', key: 'ticket' }] },
    });

    expect(showMemory({ db, id: 'notes/upper' })).toMatchObject({ related: ['notes/partner'] });
    expect(showMemory({ db, id: 'notes/lower' })).toMatchObject({ related: [] });
    expect(showMemory({ db, id: 'notes/spaced' })).toMatchObject({ related: [] });
  });

  // A grouping by `ticket ?? ''`, or a join that reads NULL = NULL as true, relates every
  // document the rule misses to every other and clears them all from `isolated`.
  it('relates nothing when the title matches no ticket rule, and leaves those documents isolated', () => {
    writeDoc('notes/plain-one.md', page('Plain one'));
    writeDoc('notes/plain-two.md', page('Plain two'));
    const db = open('null-ticket.db');
    ingestMemory({ db, root, config: TICKET_CONFIG });

    expect(showMemory({ db, id: 'notes/plain-one' })).toMatchObject({ related: [] });
    expect(showMemory({ db, id: 'notes/plain-two' })).toMatchObject({ related: [] });
    expect(describeMemoryIndex({ db })).toMatchObject({ documents: 2, isolated: 2 });
  });

  // A relation read from the title text instead of the stored column relates the two
  // documents whose titles carry the same identifier when no rule ever filled the column.
  it('relates nothing when the ingest settings carry no ticket rule, and leaves those documents isolated', () => {
    writeDoc('notes/a.md', page('Alpha RQ-7'));
    writeDoc('notes/b.md', page('Beta RQ-7'));
    const db = open('no-rule.db');
    ingestMemory({ db, root, config: NO_TICKET_CONFIG });

    expect(showMemory({ db, id: 'notes/a' })).toMatchObject({ related: [] });
    expect(showMemory({ db, id: 'notes/b' })).toMatchObject({ related: [] });
    expect(describeMemoryIndex({ db })).toMatchObject({ documents: 2, isolated: 2 });
  });
});

describe('describeMemoryIndex — isolation counts a shared ticket as a connection', () => {
  // A count that ignores the ticket column reports 4; one that clears any document with a
  // ticket clears `notes/c`; one that treats an intra-document link as a connection clears
  // `notes/d`; a `links` count that adds the ticket pairs reports more than the one edge.
  it('counts as isolated only the documents with neither a cross-document link nor a ticket partner', () => {
    writeDoc('notes/a.md', page('Alpha RQ-7'));
    writeDoc('notes/b.md', page('Beta RQ-7'));
    writeDoc('notes/c.md', page('Gamma RQ-9'));
    writeDoc('notes/d.md', page('Delta', '[me](#one)'));
    const db = open('isolated.db');
    ingestMemory({ db, root, config: TICKET_CONFIG });

    expect(describeMemoryIndex({ db })).toMatchObject({
      documents: 4,
      sections: 4,
      links: 1,
      unresolved: 0,
      isolated: 2,
    });
  });

  // A count that subtracts the link-connected set and the ticket-connected set separately
  // takes `notes/a` and `notes/b` off twice and reports -1 or 0 instead of 1.
  it('counts a document connected both by a link and by a ticket once', () => {
    writeDoc('notes/a.md', page('Alpha RQ-7', '[[b]]'));
    writeDoc('notes/b.md', page('Beta RQ-7'));
    writeDoc('notes/c.md', page('Gamma'));
    const db = open('overlap.db');
    ingestMemory({ db, root, config: TICKET_CONFIG });

    expect(describeMemoryIndex({ db })).toMatchObject({ documents: 3, links: 1, isolated: 1 });
  });
});

describe('same-ticket relation does not depend on ingest order', () => {
  const alpha = () => writeDoc('notes/alpha.md', page('Alpha RQ-7'));
  const beta = () => writeDoc('notes/beta.md', page('Beta RQ-7'));
  const freshBuild = (name: string): DatabaseSync => {
    const db = open(name);
    ingestMemory({ db, root, config: TICKET_CONFIG, rebuild: true });
    return db;
  };
  const expectSameView = (a: DatabaseSync, b: DatabaseSync): void => {
    expect(showMemory({ db: a, id: 'notes/alpha' })).toEqual(
      showMemory({ db: b, id: 'notes/alpha' }),
    );
    expect(showMemory({ db: a, id: 'notes/beta' })).toEqual(
      showMemory({ db: b, id: 'notes/beta' }),
    );
    expect(describeMemoryIndex({ db: a }).isolated).toBe(describeMemoryIndex({ db: b }).isolated);
  };

  // A relation computed per document at ingest and stored never revisits `alpha`, whose hash
  // is unchanged when `beta` arrives: alpha's list stays empty after beta arrives and keeps
  // `notes/beta` after beta's file is gone, while a rebuild says otherwise at both steps.
  it("adds a partner to an unchanged document's list when it arrives, removes it when its file goes, and matches a rebuild at every step", () => {
    alpha();
    const db = open('order.db');
    ingestMemory({ db, root, config: TICKET_CONFIG });
    expect(showMemory({ db, id: 'notes/alpha' })).toMatchObject({ related: [] });
    expect(describeMemoryIndex({ db }).isolated).toBe(1);

    beta();
    ingestMemory({ db, root, config: TICKET_CONFIG });
    expect(showMemory({ db, id: 'notes/alpha' })).toMatchObject({ related: ['notes/beta'] });
    expect(showMemory({ db, id: 'notes/beta' })).toMatchObject({ related: ['notes/alpha'] });
    expect(describeMemoryIndex({ db }).isolated).toBe(0);
    expectSameView(db, freshBuild('fresh-both.db'));

    rmSync(join(root, 'notes/beta.md'));
    ingestMemory({ db, root, config: TICKET_CONFIG });
    expect(showMemory({ db, id: 'notes/alpha' })).toMatchObject({ related: [] });
    expect(describeMemoryIndex({ db }).isolated).toBe(1);
    expect(showMemory({ db, id: 'notes/alpha' })).toEqual(
      showMemory({ db: freshBuild('fresh-alone.db'), id: 'notes/alpha' }),
    );
  });
});
