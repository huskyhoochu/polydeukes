import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { describeMemoryIndex } from '../src/describe-memory-index.ts';
import { ingestMemory } from '../src/ingest-memory.ts';
import type { MemoryConfig } from '../src/memory-config.ts';
import { openMemoryDb } from '../src/schema.ts';

// The index state a reader sees beside a search result: how many documents the index holds
// and when the last committed ingest wrote them. The stamp is what tells a reader that an
// index has fallen behind the files; the count is what tells them an index is empty.

// Globs are fixture values: nothing in the function knows this repository's layout.
const INCLUDE = ['notes/**/*.md'];
const BASE_CONFIG: MemoryConfig = { include: INCLUDE };
/** ISO 8601 in UTC, as `Date#toISOString` writes it. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
/** A stamp no clock in this run can produce. */
const SENTINEL_STAMP = '2000-01-01T00:00:00.000Z';

let tmp: string;
let root: string;
const opened: DatabaseSync[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pdks-describe-memory-index-'));
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

/** A document with no preamble row and the given H2 sections. */
const page = (title: string, ...bodies: string[]): string =>
  `---\ntitle: ${title}\n---\n${bodies.map((body, i) => `## Part ${i + 1}\n${body}`).join('\n')}`;

const storedStamp = (db: DatabaseSync): unknown =>
  db.prepare("SELECT value FROM meta WHERE key = 'ingested_at'").get();

describe('describeMemoryIndex', () => {
  // A stamp defaulting to the epoch, an empty string, or "now" on a database no ingest has
  // written reads as an index that was built; `null` is the one value a reader cannot
  // mistake for a time.
  it('reports zero documents and a null stamp on a database no ingest has written', () => {
    const db = open('fresh.db');

    expect(describeMemoryIndex({ db })).toEqual({ documents: 0, ingestedAt: null });
  });

  // An empty file opened read-only has no tables: a describe that queries `concept` throws
  // "no such table" instead of reporting an index no ingest wrote, and an opener that writes
  // the schema or switches the journal grows the file a reader only meant to look at.
  it('reads an empty file opened read-only as an unbuilt index and leaves it empty', () => {
    const path = join(tmp, 'empty.db');
    writeFileSync(path, '');
    const db = openMemoryDb({ path, readOnly: true });
    opened.push(db);

    expect(describeMemoryIndex({ db })).toEqual({ documents: 0, ingestedAt: null });
    db.close();
    expect(statSync(path).size).toBe(0);
  });

  // A count over `section` reports 3 for two documents; a stamp written in local time or
  // as epoch milliseconds fails the ISO/UTC shape; a stamp taken from the file mtimes or
  // from a clock other than the ingest's own falls outside the call's window.
  it('counts concept rows and stamps the committed ingest with a UTC instant inside the call window', () => {
    writeDoc('notes/alpha.md', page('Alpha', 'alpha one.', 'alpha two.'));
    writeDoc('notes/beta.md', page('Beta', 'beta one.'));
    const db = open('stamp.db');

    const before = Date.now();
    ingestMemory({ db, root, config: BASE_CONFIG });
    const after = Date.now();

    const state = describeMemoryIndex({ db });
    expect(state.documents).toBe(2);
    expect(state.ingestedAt).toMatch(ISO_UTC);
    const stamped = Date.parse(state.ingestedAt as string);
    // Whole-second stamps truncate, so the lower bound is the call's start rounded down.
    expect(stamped).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(stamped).toBeLessThanOrEqual(after);
    expect(storedStamp(db)).toEqual({ value: state.ingestedAt });
  });

  // An ingest that returns before its transaction when every document's hash is unchanged
  // never restamps, so a reader keeps seeing the first build's time after every later run.
  it('restamps an ingest that changes no document', async () => {
    writeDoc('notes/alpha.md', page('Alpha', 'alpha one.'));
    const db = open('restamp.db');
    ingestMemory({ db, root, config: BASE_CONFIG });
    const first = describeMemoryIndex({ db }).ingestedAt as string;

    await new Promise((resolve) => setTimeout(resolve, 1_100));
    ingestMemory({ db, root, config: BASE_CONFIG });

    const second = describeMemoryIndex({ db }).ingestedAt as string;
    expect(Date.parse(second)).toBeGreaterThan(Date.parse(first));
    expect(describeMemoryIndex({ db }).documents).toBe(1);
  });

  // An ingest over globs that reach nothing deletes every document and still commits, so
  // the stamp moves while the count drops to zero; a stamp written only when a document
  // was written leaves the old time on an index that no longer holds those documents.
  it('reports zero documents and a stamp at or after the previous one once the globs reach nothing', () => {
    writeDoc('notes/alpha.md', page('Alpha', 'alpha one.'));
    const db = open('emptied.db');
    ingestMemory({ db, root, config: BASE_CONFIG });
    const first = describeMemoryIndex({ db });
    expect(first.documents).toBe(1);

    ingestMemory({ db, root, config: { include: ['nothing/**/*.md'] } });

    const emptied = describeMemoryIndex({ db });
    expect(emptied.documents).toBe(0);
    expect(emptied.ingestedAt).toMatch(ISO_UTC);
    expect(Date.parse(emptied.ingestedAt as string)).toBeGreaterThanOrEqual(
      Date.parse(first.ingestedAt as string),
    );
  });

  // A stamp written outside the write transaction — before BEGIN, or in its own autocommit
  // statement — survives the rollback and dates an index whose rows are still the old ones.
  // The sentinel is far from the clock, so a stamp at second precision cannot collide with it.
  it('keeps the previous stamp and count when the ingest rolls back', () => {
    writeDoc('notes/alpha.md', page('Alpha', 'alpha one.'));
    const db = open('rollback.db');
    ingestMemory({ db, root, config: BASE_CONFIG });
    db.exec(`UPDATE meta SET value = '${SENTINEL_STAMP}' WHERE key = 'ingested_at'`);
    const before = describeMemoryIndex({ db });
    expect(before).toEqual({ documents: 1, ingestedAt: SENTINEL_STAMP });

    for (let n = 0; n < 300; n++) {
      writeDoc(`notes/doc-${n}.md`, page(`Note ${n}`, `section-body note ${n}.`.repeat(40)));
    }
    const { page_count } = db.prepare('PRAGMA page_count').get() as { page_count: number };
    db.exec(`PRAGMA max_page_count = ${page_count + 2}`);

    expect(() => ingestMemory({ db, root, config: BASE_CONFIG })).toThrow(/full/);
    expect(describeMemoryIndex({ db })).toEqual(before);
    expect(storedStamp(db)).toEqual({ value: SENTINEL_STAMP });
  });
});
