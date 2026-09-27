import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingestMemory } from '../src/ingest-memory.ts';
import type { MemoryConfig } from '../src/memory-config.ts';
import { openMemoryDb } from '../src/schema.ts';
import { type MemoryLogEntry, summarizeMemoryUsage } from '../src/summarize-memory-usage.ts';

// The usage summary lays the memory log — one line per query command, carrying the ids it
// answered — against the documents the index holds now. Every id below is a fixture value:
// the summary knows nothing but the `#` that separates a document id from its section.

const INCLUDE = ['notes/**/*.md'];
const CONFIG: MemoryConfig = { include: INCLUDE };
/** Five indexed documents; `alpha` has two sections so one entry can name it twice. */
const ALPHA = 'notes/alpha';
const BETA = 'notes/beta';
const GAMMA = 'notes/gamma';
const DELTA = 'notes/delta';
const ZED = 'notes/zed';
const DOCS: [string, string][] = [
  [ALPHA, '---\ntitle: Alpha\n---\n## One\n\nalpha one.\n\n## Two\n\nalpha two.\n'],
  [BETA, '---\ntitle: Beta\n---\n## One\n\nbeta one.\n'],
  [GAMMA, '---\ntitle: Gamma\n---\n## One\n\ngamma one.\n'],
  [DELTA, '---\ntitle: Delta\n---\n## One\n\ndelta one.\n'],
  [ZED, '---\ntitle: Zed\n---\n## One\n\nzed one.\n'],
];
/** A document id no ingest wrote — a renamed or deleted file whose lines are still in the log. */
const GONE = 'notes/gone';

type LogResult = MemoryLogEntry['results'][number];
const stamp = (n: number) => `2026-09-28T00:00:${String(n).padStart(2, '0')}.000Z`;
/** One log line; `n` orders the entries and fixes their `at` so from/to are pinned by value. */
const entry = (
  n: number,
  command: MemoryLogEntry['command'],
  query: string,
  results: LogResult[],
): MemoryLogEntry => ({ at: stamp(n), command, query, results });
const and = (id: string): LogResult => ({ id, matchPath: 'and' });
const or = (id: string): LogResult => ({ id, matchPath: 'or' });
const like = (id: string): LogResult => ({ id, matchPath: 'like' });

let tmp: string;
let db: DatabaseSync;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pdks-memory-usage-'));
  const root = join(tmp, 'tree');
  for (const [id, text] of DOCS) {
    const path = join(root, `${id}.md`);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text);
  }
  db = openMemoryDb({ path: join(tmp, 'memory.db') });
  ingestMemory({ db, root, config: CONFIG });
});

afterEach(() => {
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

describe('summarizeMemoryUsage — hot and dead documents', () => {
  // A count over result rows gives `alpha` 3 for two sections in one entry and ties it with
  // `beta`; a count keyed on the section id never reaches the document; a hot list in
  // first-seen order puts `gamma` before `alpha`, and one in count-ascending order puts
  // `beta` last; a dead list that omits a document the log never names, or lists it
  // under hot with count 0, hides the documents the summary exists to find; from/to read
  // from any entry but the first and last drift from the log's span.
  it('counts each document once per entry, orders hot by count desc then id asc, and lists the never-returned documents as dead in id order', () => {
    const entries = [
      entry(1, 'search', 'gamma', [and(`${GAMMA}#one`)]),
      entry(2, 'search', 'alpha', [and(`${ALPHA}#one`), and(`${ALPHA}#two`)]),
      entry(3, 'show', BETA, [{ id: BETA }]),
      entry(4, 'obligations', 'AB-1', [{ id: `${BETA}#one` }]),
      entry(5, 'search', 'both', [or(`${ALPHA}#two`), or(`${GAMMA}#one`)]),
      entry(6, 'show', `${BETA}#one`, [{ id: `${BETA}#one` }]),
    ];

    expect(summarizeMemoryUsage({ db, entries })).toEqual({
      from: stamp(1),
      to: stamp(6),
      entries: 6,
      hot: [
        { id: BETA, count: 3 },
        { id: ALPHA, count: 2 },
        { id: GAMMA, count: 2 },
      ],
      dead: [DELTA, ZED],
      misses: [{ query: 'both', count: 1 }],
    });
  });

  // An id whose document left the index counted as hot invents a document no `show` can
  // open; one that makes the whole entry fall out drops `alpha`'s hit with it; a document
  // id matched only by an exact section id misses the preamble form `notes/alpha#`.
  it('ignores ids whose document is not in the index and reads a bare or preamble id as its document', () => {
    const entries = [
      entry(1, 'search', 'moved', [and(`${GONE}#one`), and(`${ALPHA}#`)]),
      entry(2, 'show', GONE, [{ id: GONE }]),
    ];

    const summary = summarizeMemoryUsage({ db, entries });

    expect(summary.entries).toBe(2);
    expect(summary.hot).toEqual([{ id: ALPHA, count: 1 }]);
    expect(summary.dead).toEqual([BETA, DELTA, GAMMA, ZED]);
    expect(summary.misses).toEqual([]);
  });

  // A span read from `entries[0].at` without a check for no entries throws or yields `undefined`, which
  // the JSON form drops from the object; an empty string or the epoch reads as a time.
  it('returns a null span, zero entries, no hot document, and every document dead over no entries', () => {
    expect(summarizeMemoryUsage({ db, entries: [] })).toEqual({
      from: null,
      to: null,
      entries: 0,
      hot: [],
      dead: [ALPHA, BETA, DELTA, GAMMA, ZED],
      misses: [],
    });
  });
});

describe('summarizeMemoryUsage — misses', () => {
  // A miss test that reads only emptiness lets the all-`or` search through; one that reads
  // "any `or`" flags the mixed search, and one that treats `like` as a fallback flags the
  // like-only search; a miss keyed on anything but the exact query text merges or splits the
  // repeated one; an obligations entry with no row is an empty answer, not a failed search,
  // and a miss list in first-seen order puts `zzz` before `aaa`.
  it('reports a search with no result or with only or-matched results, grouped by exact query, count desc then query asc, and never a show or obligations entry', () => {
    const entries = [
      entry(1, 'search', 'zzz', []),
      entry(2, 'search', 'repeated', [or(`${ALPHA}#one`), or(`${BETA}#one`)]),
      entry(3, 'search', 'mixed', [or(`${ALPHA}#one`), and(`${BETA}#one`)]),
      entry(4, 'search', 'like only', [like(`${GAMMA}#one`)]),
      entry(5, 'search', 'aaa', []),
      entry(6, 'search', 'repeated', []),
      entry(7, 'obligations', 'AB-9', []),
      entry(8, 'show', DELTA, [{ id: DELTA }]),
    ];

    expect(summarizeMemoryUsage({ db, entries }).misses).toEqual([
      { query: 'repeated', count: 2 },
      { query: 'aaa', count: 1 },
      { query: 'zzz', count: 1 },
    ]);
  });
});
