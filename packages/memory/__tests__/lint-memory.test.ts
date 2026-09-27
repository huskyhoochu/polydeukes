import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingestMemory } from '../src/ingest-memory.ts';
import { lintMemory } from '../src/lint-memory.ts';
import type { MemoryConfig } from '../src/memory-config.ts';
import { openMemoryDb } from '../src/schema.ts';

// `lintMemory` reads the stored rows alone: an edge with no target document, a document
// that shares a ticket with another and links out to nothing, and a document whose stored
// metadata carries no type. The ticket column comes from the ingest settings, so the
// second rule is only ever as informed as the configuration that filled it.

// Globs and the ticket pattern are fixture values: nothing in the function knows this
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
  tmp = mkdtempSync(join(tmpdir(), 'pdks-lint-memory-'));
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

/** A typed document whose sections are given as `[anchor, body]` pairs. */
const typed = (title: string, ...sections: [string, string][]): string =>
  `---\ntitle: ${title}\ntype: note\n---\n${sections
    .map(([anchor, body]) => `## ${anchor} {#${anchor}}\n${body}\n`)
    .join('')}`;

/**
 * One tree that breaks every rule at least once and holds a near miss for each: `hub`
 * links out (so it is not unlinked) but two of its targets are missing; `spoke` shares
 * hub's ticket and links to nothing; `dangling` and `selfish` share it too and link only
 * to a missing target or to their own section; `solo` links to nothing but no other
 * document shares its ticket; `typeless`, `emptytype`, `numtype`, and `broken` carry no
 * usable type in four shapes.
 */
const violatingTree = () => {
  writeDoc(
    'notes/hub.md',
    typed('Hub RQ-7', ['one', '[[spoke]] [y](zzz.md) [[nowhere]]'], ['two', '[x](missing.md)']),
  );
  writeDoc('notes/spoke.md', typed('Spoke RQ-7', ['one', 'spoke text.']));
  writeDoc('notes/dangling.md', typed('Dangling RQ-7', ['one', '[[nowhere-else]]']));
  writeDoc('notes/selfish.md', typed('Selfish RQ-7', ['one', '[me](#one)']));
  writeDoc('notes/solo.md', typed('Solo RQ-9', ['one', 'solo text.']));
  writeDoc('notes/typeless.md', '---\ntitle: Typeless\n---\n## One\ntypeless text.\n');
  writeDoc('notes/emptytype.md', '---\ntitle: Empty type\ntype: ""\n---\n## One\nempty text.\n');
  writeDoc('notes/numtype.md', '---\ntitle: Number type\ntype: 3\n---\n## One\nnumber text.\n');
  writeDoc('notes/broken.md', '---\n: [\n---\n## One\nunparseable frontmatter.\n');
};

const UNRESOLVED = [
  { rule: 'unresolved', id: 'notes/dangling#one', detail: '[[nowhere-else]]' },
  { rule: 'unresolved', id: 'notes/hub#one', detail: '[[nowhere]]' },
  { rule: 'unresolved', id: 'notes/hub#one', detail: 'zzz.md' },
  { rule: 'unresolved', id: 'notes/hub#two', detail: 'missing.md' },
];
const UNTYPED = [
  { rule: 'untyped', id: 'notes/broken', detail: '' },
  { rule: 'untyped', id: 'notes/emptytype', detail: '' },
  { rule: 'untyped', id: 'notes/numtype', detail: '' },
  { rule: 'untyped', id: 'notes/typeless', detail: '' },
];

describe('lintMemory', () => {
  // A rule that reports every unlinked document adds `solo`; one that counts only resolved
  // outgoing edges adds `dangling`, only cross-document edges adds `selfish`; a type check
  // by truthiness keeps `numtype` (3 is truthy), one by `typeof` alone keeps `emptytype`,
  // and one that reads the type before the frontmatter failed to parse keeps `broken`; a
  // sort by id alone interleaves the rules, by rule name alphabetically puts `unlinked`
  // first; a detail that strips the wikilink brackets prints `nowhere`.
  it('reports unresolved edges, unlinked same-ticket documents, and untyped documents in rule, id, detail order', () => {
    violatingTree();
    const db = open('violations.db');
    ingestMemory({ db, root, config: TICKET_CONFIG });

    expect(lintMemory({ db })).toEqual({
      violations: [
        ...UNRESOLVED,
        { rule: 'unlinked', id: 'notes/spoke', detail: 'RQ-7' },
        ...UNTYPED,
      ],
    });
  });

  // A rule that groups documents by a NULL ticket reports every ticket-less document as
  // unlinked once no configuration fills the column.
  it('never reports unlinked when the ingest settings carry no ticket rule', () => {
    violatingTree();
    const db = open('no-ticket.db');
    ingestMemory({ db, root, config: NO_TICKET_CONFIG });

    expect(lintMemory({ db })).toEqual({ violations: [...UNRESOLVED, ...UNTYPED] });
  });
});
