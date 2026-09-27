import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chunkSpans } from '../src/chunk-body.ts';
import { ingestMemory } from '../src/ingest-memory.ts';
import type { MemoryConfig } from '../src/memory-config.ts';
import { normalizeQuery } from '../src/normalize-query.ts';
import { parseDocument } from '../src/parse-document.ts';
import { replaceDocument } from '../src/replace-document.ts';
import { openMemoryDb, optimizeMemoryDb } from '../src/schema.ts';
import { searchMemory } from '../src/search-memory.ts';

// The longest body one chunk may hold; a chunk made of one whitespace-free run is the exception.
const MAX_CHUNK = 2000;
// Six-letter filler words: a six-letter query term replaces one without changing any length,
// so two sections that differ only in where the term sits stay the same total length.
const FILLER = ['venoms', 'portal', 'silver', 'timber', 'meadow', 'harbor'];
// Globs are fixture values: the ingest learns every path from `root` and `include`.
const CONFIG: MemoryConfig = { include: ['notes/**/*.md'] };

let tmp: string;
const opened: DatabaseSync[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pdks-search-chunks-'));
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
  const db = openMemoryDb({ path: join(tmp, name) });
  opened.push(db);
  return db;
}

type Source = { id: string; text: string };

function ingest(db: DatabaseSync, sources: Source[]): void {
  db.exec('BEGIN');
  for (const source of sources) replaceDocument({ db, document: parseDocument(source) });
  optimizeMemoryDb({ db });
  db.exec('COMMIT');
}

/** `count` filler words, with the words at the given indexes replaced, joined by one space. */
function paragraph(count: number, placed: Record<number, string> = {}): string {
  return Array.from(
    { length: count },
    (_, i) => placed[i] ?? (FILLER[i % FILLER.length] as string),
  ).join(' ');
}

/** Appends filler words until the space-joined text is at least `length` long. */
function fillTo(words: string[], length: number): void {
  while (words.join(' ').length < length)
    words.push(FILLER[words.length % FILLER.length] as string);
}

function tableNames(db: DatabaseSync): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE name IN ('chunk', 'chunk_fts', 'section_fts', 'section_ai', 'section_ad') ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
}

type ChunkRow = { id: string; start: number; end: number };

function chunkRows(db: DatabaseSync): ChunkRow[] {
  return db
    .prepare(
      'SELECT s.id, c.start, c.end FROM chunk AS c JOIN section AS s ON s.rowid = c.section_rowid ORDER BY s.id, c.start',
    )
    .all() as ChunkRow[];
}

function sectionsWithoutChunks(db: DatabaseSync): string[] {
  return (
    db
      .prepare(
        'SELECT s.id FROM section AS s WHERE NOT EXISTS (SELECT 1 FROM chunk AS c WHERE c.section_rowid = s.rowid) ORDER BY s.id',
      )
      .all() as { id: string }[]
  ).map((row) => row.id);
}

function ftsMatchCount(db: DatabaseSync, term: string): number {
  const { n } = db
    .prepare('SELECT count(*) AS n FROM chunk_fts WHERE chunk_fts MATCH ?')
    .get(`"${term}"`) as { n: number };
  return n;
}

describe('chunkSpans', () => {
  // `<` in place of `<=` at the limit splits a body that fits, and a split of a short body
  // costs it the whole-section bm25 it had before.
  it('keeps a body of exactly the limit in one span', () => {
    const body = `${'x'.repeat(MAX_CHUNK - 1)} `;
    expect(chunkSpans(body)).toEqual([{ start: 0, end: MAX_CHUNK }]);
    expect(chunkSpans('short body')).toEqual([{ start: 0, end: 10 }]);
  });

  // Splitting at every blank line, rather than packing pieces up to the limit, makes five
  // chunks of five paragraphs; splitting at the last space before the limit ignores the
  // blank line and lands inside a paragraph.
  it('packs blank-line pieces greedily, the separator staying with the preceding piece', () => {
    // 800-character paragraphs: pieces of 802, 802, 802, 802, 800; two fit, three do not.
    const body = Array.from({ length: 5 }, () => 'a'.repeat(800)).join('\n\n');
    expect(chunkSpans(body)).toEqual([
      { start: 0, end: 1604 },
      { start: 1604, end: 3208 },
      { start: 3208, end: 4008 },
    ]);
  });

  // A blank line is `\n`, optional spaces or tabs, `\n`. Recognising only `\n\n` drops to the
  // newline split, which packs four lines (1805) into the first chunk instead of one piece.
  it('treats a line of spaces or a tab as a blank line and leaves a piece under the limit unsplit', () => {
    const piece = `${'a'.repeat(600)}\n${'b'.repeat(600)}`;
    for (const separator of ['\n \n', '\n\t\n']) {
      const body = [piece, piece, piece].join(separator);
      expect(chunkSpans(body), JSON.stringify(separator)).toEqual([
        { start: 0, end: 1204 },
        { start: 1204, end: 2408 },
        { start: 2408, end: 3609 },
      ]);
    }
  });

  // The second line alone exceeds the limit, so its whitespace split starts at offset 2000.
  // Positions reported relative to the line instead of the body overlap the first span; a
  // split that stops at the newline level cuts the line itself at 2000, inside a word.
  it('descends from newlines to whitespace inside a line that starts past offset zero', () => {
    const line = Array.from({ length: 600 }, () => 'abcd').join(' ');
    const body = `${'a'.repeat(1999)}\n${line}`;
    expect(body).toHaveLength(4999);
    const spans = chunkSpans(body);
    expect(spans).toEqual([
      { start: 0, end: 2000 },
      { start: 2000, end: 4000 },
      { start: 4000, end: 4999 },
    ]);
    for (const span of spans.slice(0, -1)) expect(body[span.end - 1]).toMatch(/\s/u);
    expect(spans.map((span) => body.slice(span.start, span.end)).join('')).toBe(body);
  });

  // A piece re-split for exceeding the limit is packed within itself; its sub-pieces never
  // merge with a neighbouring piece. Packing the flattened leaves would end the first span at
  // 1996 and the second at 3801; filling a 2,000-character window and cutting at the best
  // boundary inside it would merge the line's remainder with the 300-character tail.
  it('packs the sub-pieces of a re-split piece only among themselves', () => {
    const line = Array.from({ length: 600 }, () => 'abcd').join(' ');
    const body = `${'a'.repeat(500)}\n${line}\n${'b'.repeat(300)}`;
    expect(body).toHaveLength(3801);
    expect(chunkSpans(body)).toEqual([
      { start: 0, end: 501 },
      { start: 501, end: 2501 },
      { start: 2501, end: 3501 },
      { start: 3501, end: 3801 },
    ]);
  });

  // With no blank line, the split is at newlines before spaces: a whitespace-first split ends
  // the first chunk at the last space before the limit, not at the second newline.
  it('splits an over-long piece at newlines before whitespace runs', () => {
    const line = Array.from({ length: 150 }, () => 'abcde').join(' ');
    const body = [line, line, line].join('\n');
    expect(line).toHaveLength(899);
    expect(chunkSpans(body)).toEqual([
      { start: 0, end: 1800 },
      { start: 1800, end: 2699 },
    ]);
  });

  // Every word ends on a multiple of five, so a boundary at exactly the limit is legal; an
  // off-by-one stops one word short. A boundary inside a word would lose that word's trigrams.
  it('splits a single long paragraph at whitespace with each span at most the limit', () => {
    const body = Array.from({ length: 1000 }, () => 'abcd').join(' ');
    const spans = chunkSpans(body);
    expect(spans[0]).toEqual({ start: 0, end: MAX_CHUNK });
    expect(spans.length).toBeGreaterThan(2);
    for (const span of spans) expect(span.end - span.start).toBeLessThanOrEqual(MAX_CHUNK);
    for (const span of spans.slice(0, -1)) expect(body[span.end - 1]).toMatch(/\s/u);
    expect(spans.map((span) => body.slice(span.start, span.end)).join('')).toBe(body);
  });

  // A run with no whitespace cannot be split at whitespace; cutting it at the limit anyway
  // puts a boundary inside a token, and dropping it loses the text.
  it('keeps a whitespace-free run longer than the limit whole in one span', () => {
    expect(chunkSpans('y'.repeat(3000))).toEqual([{ start: 0, end: 3000 }]);
    const body = `word ${'y'.repeat(2500)} word`;
    expect(chunkSpans(body)).toEqual([
      { start: 0, end: 5 },
      { start: 5, end: 2506 },
      { start: 2506, end: 2510 },
    ]);
  });

  // Spans that overlap, leave a gap, or come back in a different order on a second call
  // index text twice or not at all, and rebuild determinism (AC-3) rests on this.
  it('covers the body contiguously and returns the same spans for the same body', () => {
    const body = [paragraph(300), paragraph(300, { 7: 'quartz' }), paragraph(300)].join('\n\n');
    const spans = chunkSpans(body);
    expect(spans[0]?.start).toBe(0);
    expect(spans.at(-1)?.end).toBe(body.length);
    for (let i = 1; i < spans.length; i++) expect(spans[i]?.start).toBe(spans[i - 1]?.end);
    expect(spans.map((span) => body.slice(span.start, span.end)).join('')).toBe(body);
    expect(chunkSpans(body)).toEqual(spans);
  });
});

describe('searchMemory ranks a section by its best chunk', () => {
  // Four 1,399-character paragraphs: each is one chunk. The dense section and the spread
  // section hold the same four occurrences in the same total length, so a section-level
  // bm25 ties them and the identifier puts the spread one first; a chunk with four
  // occurrences scores better than any with one.
  it('puts occurrences concentrated in one chunk above the same count spread over chunks', async () => {
    const db = open('memory.db');
    const dense = [
      paragraph(200, { 10: 'needle', 50: 'needle', 100: 'needle', 150: 'needle' }),
      paragraph(200),
      paragraph(200),
      paragraph(200),
    ].join('\n\n');
    const spread = Array.from({ length: 4 }, () => paragraph(200, { 10: 'needle' })).join('\n\n');
    expect(dense).toHaveLength(spread.length);
    ingest(db, [
      { id: 'notes/z-dense', text: `---\ntitle: Doc D\n---\n## Topic\n\n${dense}\n` },
      { id: 'notes/a-spread', text: `---\ntitle: Doc S\n---\n## Topic\n\n${spread}\n` },
      // Chunks without the term keep its idf positive.
      {
        id: 'notes/filler',
        text: `---\ntitle: Doc F\n---\n## Topic\n\n${Array.from({ length: 8 }, () => paragraph(200)).join('\n\n')}\n`,
      },
    ]);

    const results = await searchMemory({ db, query: 'needle' });
    expect(results.map((row) => row.id)).toEqual(['notes/z-dense#topic', 'notes/a-spread#topic']);
  });

  // The section whose one chunk holds both terms outscores the section that holds each term
  // in a different chunk. Adding each term's best chunk instead of taking the best chunk of
  // the summed terms ties them, and the identifier then puts the split one first.
  it('sums the terms matched inside one chunk before choosing the best chunk', async () => {
    const db = open('memory.db');
    const split = [
      paragraph(200, { 10: 'quartz', 50: 'quartz', 90: 'quartz' }),
      paragraph(200, { 10: 'zephyr', 50: 'zephyr', 90: 'zephyr' }),
    ].join('\n\n');
    const joined = [
      paragraph(200, {
        10: 'quartz',
        50: 'quartz',
        90: 'quartz',
        20: 'zephyr',
        60: 'zephyr',
        100: 'zephyr',
      }),
      paragraph(200),
    ].join('\n\n');
    expect(split).toHaveLength(joined.length);
    ingest(db, [
      { id: 'notes/a-split', text: `---\ntitle: Doc A\n---\n## Topic\n\n${split}\n` },
      { id: 'notes/z-joined', text: `---\ntitle: Doc Z\n---\n## Topic\n\n${joined}\n` },
      {
        id: 'notes/filler',
        text: `---\ntitle: Doc F\n---\n## Topic\n\n${Array.from({ length: 6 }, () => paragraph(200)).join('\n\n')}\n`,
      },
    ]);

    const results = await searchMemory({ db, query: 'quartz zephyr' });
    expect(results.map((row) => [row.id, row.matchPath])).toEqual([
      ['notes/z-joined#topic', 'and'],
      ['notes/a-split#topic', 'and'],
    ]);
  });

  // The weight comes off a section once, after its best chunk is chosen. Read from
  // bm25(chunk_fts), the fixture keeps three orders apart: with no weight the four-chunk
  // section leads; with the weight taken once the one-chunk section leads; with the weight
  // taken from every matching chunk and the chunks summed the four-chunk section leads again.
  it('subtracts the doc_type weight once from the best chunk score', async () => {
    const db = open('memory.db');
    const many = Array.from({ length: 4 }, () => paragraph(200, { 10: 'needle' })).join('\n\n');
    ingest(db, [
      { id: 'notes/many', text: `---\ntitle: Doc M\n---\n## Topic\n\n${many}\n` },
      // A longer chunk with the same one occurrence scores a little worse than each of the four.
      {
        id: 'notes/one',
        text: `---\ntitle: Doc O\ntype: prd\n---\n## Topic\n\n${paragraph(260, { 10: 'needle' })}\n`,
      },
      {
        id: 'notes/filler',
        text: `---\ntitle: Doc F\n---\n## Topic\n\n${Array.from({ length: 6 }, () => paragraph(200)).join('\n\n')}\n`,
      },
    ]);
    const scores = db
      .prepare(
        `SELECT s.id, bm25(chunk_fts) AS score
         FROM chunk_fts JOIN chunk ON chunk.rowid = chunk_fts.rowid
         JOIN section AS s ON s.rowid = chunk.section_rowid
         WHERE chunk_fts MATCH '"needle"'`,
      )
      .all() as { id: string; score: number }[];
    const manyScores = scores.filter((row) => row.id === 'notes/many#topic').map((r) => r.score);
    const one = scores.find((row) => row.id === 'notes/one#topic')?.score as number;
    expect(manyScores).toHaveLength(4);
    const best = Math.min(...manyScores);
    const summed = manyScores.reduce((sum, score) => sum + score, 0);
    expect(one).toBeGreaterThan(best);
    const weight = (one - best + (one - summed)) / 2;
    expect(one - weight).toBeLessThan(best);
    expect(summed).toBeLessThan(one - weight);

    const order = async (config?: MemoryConfig) =>
      (await searchMemory({ db, query: 'needle', config })).map((row) => row.id);
    expect(await order()).toEqual(['notes/many#topic', 'notes/one#topic']);
    expect(await order({ include: [], weights: { prd: weight } })).toEqual([
      'notes/one#topic',
      'notes/many#topic',
    ]);
  });
});

describe('searchMemory returns the section-level match set unchanged', () => {
  let db: DatabaseSync;

  // The long-alpha body is one paragraph, so its first boundary is the last space at or
  // before the limit and its second the last space before twice that: the `edge` and `rim`
  // tokens are laid over both regions so that a boundary inside a token loses one of them.
  const EDGE_TOKENS = Array.from({ length: 30 }, (_, i) => `edge${String(i).padStart(2, '0')}`);
  const RIM_TOKENS = Array.from({ length: 30 }, (_, i) => `rim${String(i).padStart(2, '0')}`);

  function longAlphaBody(): string {
    const words: string[] = ['quartz'];
    fillTo(words, 1880);
    words.push(...EDGE_TOKENS);
    words.push('zephyr');
    fillTo(words, 3860);
    words.push(...RIM_TOKENS);
    words.push('quartz');
    fillTo(words, 4600);
    words.push('스냅샷');
    fillTo(words, 5000);
    return words.join(' ');
  }

  beforeEach(() => {
    db = open('memory.db');
    ingest(db, [
      {
        id: 'notes/long-alpha',
        text: `---\ntitle: Falcon guide\n---\n## Kestrel notes\n\n${longAlphaBody()}\n\n## Short\n\nkite here.\n`,
      },
      {
        id: 'notes/long-beta',
        text: `---\ntitle: Beta\n---\n## Topic\n\n${[
          paragraph(200),
          paragraph(200, { 120: '검증' }),
          paragraph(200, { 30: 'zephyr', 150: 'quartz' }),
        ].join('\n\n')}\n\n## Tail\n\nquartz zephyr together.\n`,
      },
      {
        id: 'notes/preamble-only',
        text: `# Preamble doc\n\n${[
          paragraph(200),
          paragraph(200, { 90: '스냅' }),
          paragraph(200, { 40: 'needle' }),
        ].join('\n\n')}\n`,
      },
      { id: 'MQ-77', text: '# Ticket\n\n## One\n\nkite and quartz.\n' },
      { id: 'notes/short', text: '# Short\n\n## Only\n\nmeadow kite.\n' },
    ]);
  });

  const escapeLike = (term: string): string =>
    term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_');

  /**
   * The (section id, match path) set from a full scan of the `section` rows: per term, the
   * sections whose title, document title, or body contains it, or whose id or document id
   * starts with it; every term for a literal query when any section holds them all, any term
   * otherwise. A term of one or two characters, or an id-prefix hit, marks the scan path.
   */
  async function oracle(query: string): Promise<string[]> {
    const raw = query.trim().split(/\s+/u).filter(Boolean);
    const normalized = await normalizeQuery(query);
    const literal =
      normalized.length === 0 ||
      (normalized.length === raw.length && normalized.every((term, i) => term === raw[i]));
    const terms = literal ? raw : normalized;
    const hits = terms.map((term) => {
      const pattern = `%${escapeLike(term)}%`;
      const prefix = `${escapeLike(term)}%`;
      const content = (
        db
          .prepare(
            "SELECT id FROM section WHERE doc_title LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'",
          )
          .all(pattern, pattern, pattern) as { id: string }[]
      ).map((row) => row.id);
      const byId = (
        db
          .prepare(
            "SELECT id FROM section WHERE id LIKE ? ESCAPE '\\' OR concept_id LIKE ? ESCAPE '\\'",
          )
          .all(prefix, prefix) as { id: string }[]
      ).map((row) => row.id);
      const found = new Map<string, boolean>();
      for (const id of content) found.set(id, [...term].length < 3);
      for (const id of byId) found.set(id, true);
      return found;
    });
    const all = new Set(hits.flatMap((set) => [...set.keys()]));
    const every = [...all].filter((id) => hits.every((set) => set.has(id)));
    const ids = literal && every.length > 0 ? every : [...all];
    return ids
      .map((id) => {
        const own = hits.filter((set) => set.has(id));
        const path =
          own.length < hits.length ? 'or' : own.some((set) => set.get(id)) ? 'like' : 'and';
        return `${id} ${path}`;
      })
      .sort();
  }

  async function found(query: string): Promise<string[]> {
    return (await searchMemory({ db, query, limit: 1000 }))
      .map((row) => `${row.id} ${row.matchPath}`)
      .sort();
  }

  // A chunk boundary inside a token, a term found only in a section's first chunk, a title
  // column missing from the chunk index, or an id-prefix match applied per chunk each change
  // one of these sets; the oracle never reads a chunk.
  it('matches the full-scan oracle for every query, including the terms laid over the boundaries', async () => {
    const queries = [
      'quartz',
      'zephyr',
      'kite',
      'needle',
      '스냅',
      '검증',
      '스냅샷',
      'kestrel',
      'falcon',
      'quartz zephyr',
      'needle kite',
      'MQ-7',
      'notes/lo',
      'nomatchword',
      ...EDGE_TOKENS,
      ...RIM_TOKENS,
    ];
    const paths = new Set<string>();
    for (const query of queries) {
      const expected = await oracle(query);
      expect(await found(query), query).toEqual(expected);
      for (const entry of expected) paths.add(entry.split(' ')[1] as string);
    }
    expect(await oracle('nomatchword')).toEqual([]);
    expect(await oracle('needle')).toEqual(['notes/preamble-only# and']);
    expect([...paths].sort()).toEqual(['and', 'like', 'or']);
    // The stored body is `\n` + paragraph + `\n`: the newline split leaves the leading `\n`
    // as a piece of its own, then the paragraph packs into 1995, 1995, and 1017.
    expect(chunkRows(db).filter((row) => row.id === 'notes/long-alpha#kestrel-notes').length).toBe(
      4,
    );
  });
});

describe('searchMemory over text outside the Basic Multilingual Plane', () => {
  const k1 = 1.2;
  const b = 0.75;
  const foldAscii = (text: string) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const occurrences = (text: string, term: string) => foldAscii(text).split(term).length - 1;
  // Trigram tokens per column: characters, not UTF-16 units, minus two.
  const tokens = (text: string) => Math.max([...text].length - 2, 0);

  // An emoji is two UTF-16 units in JavaScript and one character to SQLite. Fifty of them in
  // the first chunk put the second chunk's start 50 units past its character index, so a
  // span applied in the wrong unit hands the first 50 characters of every later chunk to the
  // chunk before it. No character is lost, so the match set stays the same; what moves is
  // the chunk a term is scored in: `검증` opens the 1,401-character second chunk, and read in
  // the wrong unit it sits in a first chunk of 1,202. The control section's one chunk of
  // 1,303 lies between the two, so the shorter chunk decides the order either way.
  it('scores a two-character term in the chunk the split put it in after fifty emoji, and indexes each chunk as the split produced it', async () => {
    const db = open('memory.db');
    const emoji = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [i * 3, '😀']));
    ingest(db, [
      {
        id: 'notes/emoji',
        text: `---\ntitle: Quartz guide\n---\n## Topic\n\n${[
          paragraph(200, emoji),
          paragraph(200, { 0: '검증', 1: 'quartz' }),
          paragraph(200, { 199: '스냅' }),
        ].join('\n\n')}\n`,
      },
      {
        id: 'notes/control',
        text: `---\ntitle: Quartz notes\n---\n## Topic\n\n${paragraph(186, { 90: '검증' })}\n`,
      },
      {
        id: 'notes/filler',
        text: `---\ntitle: Doc F\n---\n## Topic\n\n${Array.from({ length: 8 }, () => paragraph(200)).join('\n\n')}\n`,
      },
    ]);

    for (const query of ['검증', 'quartz', '스냅']) {
      const pattern = `%${query}%`;
      const expected = (
        db
          .prepare(
            'SELECT id FROM section WHERE doc_title LIKE ? OR title LIKE ? OR body LIKE ? ORDER BY id',
          )
          .all(pattern, pattern, pattern) as { id: string }[]
      ).map((row) => row.id);
      expect(expected, query).toContain('notes/emoji#topic');
      expect(
        (await searchMemory({ db, query, limit: 100 })).map((row) => row.id).sort(),
        query,
      ).toEqual(expected);
    }
    expect((await searchMemory({ db, query: '검증' })).map((row) => row.id)).toEqual([
      'notes/control#topic',
      'notes/emoji#topic',
    ]);

    // Every chunk of the three documents, with the text the split gives it in JavaScript.
    const sections = db
      .prepare('SELECT id, doc_title, title, body FROM section ORDER BY id')
      .all() as { id: string; doc_title: string; title: string; body: string }[];
    const chunks = sections.flatMap((section) =>
      chunkSpans(section.body).map((span) => {
        const columns = [
          section.doc_title,
          section.title,
          section.body.slice(span.start, span.end),
        ];
        return {
          id: section.id,
          len: columns.reduce((sum, column) => sum + tokens(column), 0),
          tf: columns.reduce((sum, column) => sum + occurrences(column, 'quartz'), 0),
        };
      }),
    );
    expect(chunks.filter((chunk) => chunk.id === 'notes/emoji#topic')).toHaveLength(3);
    const N = chunks.length;
    const avglen = chunks.reduce((sum, chunk) => sum + chunk.len, 0) / N;
    const matched = chunks.filter((chunk) => chunk.tf > 0);
    const idf = Math.log((N - matched.length + 0.5) / (matched.length + 0.5));
    expect(idf).toBeGreaterThan(0);
    const expected = matched.map(
      ({ tf, len }) => (-idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * len) / avglen)),
    );
    const actual = (
      db
        .prepare(
          `SELECT bm25(chunk_fts) AS score
           FROM chunk_fts JOIN chunk ON chunk.rowid = chunk_fts.rowid
           JOIN section AS s ON s.rowid = chunk.section_rowid
           WHERE chunk_fts MATCH '"quartz"' ORDER BY s.id, chunk.start`,
        )
        .all() as { score: number }[]
    ).map((row) => row.score);
    expect(actual).toHaveLength(expected.length);
    for (const [i, score] of expected.entries()) {
      expect(actual[i], `chunk ${i}`).toBeCloseTo(score, 6);
    }
  });
});

describe('chunk rows and the chunk index follow the section rows', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmp, 'tree');
    mkdirSync(join(root, 'notes'), { recursive: true });
  });

  function writeDoc(name: string, text: string): void {
    writeFileSync(join(root, 'notes', `${name}.md`), text);
  }

  const longText = (title: string, placed: Record<number, string>): string =>
    `---\ntitle: ${title}\n---\n## Topic\n\n${[
      paragraph(200, placed),
      paragraph(200),
      paragraph(200, placed),
    ].join('\n\n')}\n\n## Tail\n\nshort tail.\n`;

  // A section with an empty body still carries its titles: a split that yields no span for
  // an empty body leaves the section without a chunk row, and its title is never found.
  it('gives a section with an empty body one chunk and finds it by its title', async () => {
    const db = open('memory.db');
    ingest(db, [{ id: 'notes/doc', text: '# Doc\n\n## Alpha\n## Beta\n\nbeta body.\n' }]);
    expect(sectionsWithoutChunks(db)).toEqual([]);
    expect((await searchMemory({ db, query: 'alpha' })).map((row) => row.id)).toEqual([
      'notes/doc#alpha',
    ]);
  });

  // A replace that appends chunk rows beside the old ones, a delete that leaves chunk rows
  // or index entries behind, or a split that depends on ingest order, separates the edited
  // database from the one built once from the final texts.
  it('leaves the same chunk rows and search results as a fresh database after a replace and a delete', async () => {
    writeDoc('a', longText('Alpha', { 5: 'oldterm', 60: 'quartz' }));
    writeDoc('b', longText('Beta', { 5: 'onlyinb', 60: 'quartz' }));
    writeDoc('c', '# C\n\n## Topic\n\nquartz once.\n');
    const edited = open('edited.db');
    ingestMemory({ db: edited, root, config: CONFIG });
    expect(ftsMatchCount(edited, 'onlyinb')).toBeGreaterThan(0);
    expect(ftsMatchCount(edited, 'oldterm')).toBeGreaterThan(0);

    writeDoc('a', longText('Alpha', { 5: 'newterm', 90: 'quartz', 130: 'quartz' }));
    rmSync(join(root, 'notes', 'b.md'));
    ingestMemory({ db: edited, root, config: CONFIG });
    const fresh = open('fresh.db');
    ingestMemory({ db: fresh, root, config: CONFIG });

    const freshRows = chunkRows(fresh);
    expect(freshRows.filter((row) => row.id === 'notes/a#topic').length).toBeGreaterThan(1);
    expect(chunkRows(edited)).toEqual(freshRows);
    for (const query of ['quartz', 'newterm', 'quartz tail']) {
      expect(await searchMemory({ db: edited, query, limit: 100 }), query).toEqual(
        await searchMemory({ db: fresh, query, limit: 100 }),
      );
    }
    expect(ftsMatchCount(edited, 'onlyinb')).toBe(0);
    expect(ftsMatchCount(edited, 'oldterm')).toBe(0);

    ingestMemory({ db: edited, root, config: CONFIG, rebuild: true });
    expect(chunkRows(edited)).toEqual(freshRows);
  });
});

describe('openMemoryDb schema', () => {
  // A chunk row without a foreign key, or without the cascade, outlives its section on a
  // replace or a delete; a chunk index entry that stays behind fails FTS5's own check.
  it('keeps the chunk index consistent through replacements and deletions', () => {
    const db = open('memory.db');
    const long = (placed: Record<number, string>) =>
      `# Doc\n\n## Topic\n\n${[paragraph(200, placed), paragraph(200), paragraph(200)].join('\n\n')}\n`;
    ingest(db, [
      { id: 'notes/a', text: long({ 1: 'first' }) },
      { id: 'notes/b', text: long({ 1: 'second' }) },
    ]);
    ingest(db, [{ id: 'notes/a', text: long({ 1: 'third' }) }]);
    db.exec('BEGIN');
    db.prepare('DELETE FROM concept WHERE id = ?').run('notes/b');
    optimizeMemoryDb({ db });
    db.exec('COMMIT');

    expect(() =>
      db.exec("INSERT INTO chunk_fts(chunk_fts, rank) VALUES ('integrity-check', 1)"),
    ).not.toThrow();
    const { orphans } = db
      .prepare(
        'SELECT count(*) AS orphans FROM chunk WHERE section_rowid NOT IN (SELECT rowid FROM section)',
      )
      .get() as { orphans: number };
    expect(orphans).toBe(0);
    const { chunks } = db.prepare('SELECT count(*) AS chunks FROM chunk').get() as {
      chunks: number;
    };
    const { indexed } = db.prepare('SELECT count(*) AS indexed FROM chunk_fts').get() as {
      indexed: number;
    };
    expect(chunks).toBeGreaterThan(1);
    expect(indexed).toBe(chunks);
    expect(ftsMatchCount(db, 'first')).toBe(0);
    expect(ftsMatchCount(db, 'second')).toBe(0);
  });
});

describe('upgrading a database the previous schema wrote', () => {
  // The schema the previous version wrote, as a literal: an external-content FTS table over
  // `section` kept by two triggers.
  const PREVIOUS_SCHEMA = `
CREATE TABLE IF NOT EXISTS concept (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  metadata    TEXT NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'stable',
  stale_after TEXT,
  doc_type    TEXT,
  ticket      TEXT,
  content_hash TEXT NOT NULL DEFAULT ''
) STRICT;

CREATE TABLE IF NOT EXISTS section (
  rowid      INTEGER PRIMARY KEY,
  id         TEXT NOT NULL UNIQUE,
  concept_id TEXT NOT NULL REFERENCES concept(id) ON DELETE CASCADE,
  ord        INTEGER NOT NULL,
  doc_title  TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL
) STRICT;
CREATE INDEX IF NOT EXISTS section_concept ON section(concept_id);

CREATE TABLE IF NOT EXISTS edge (
  src_section TEXT NOT NULL REFERENCES section(id) ON DELETE CASCADE,
  form        TEXT NOT NULL,
  raw_target  TEXT NOT NULL,
  dst_concept TEXT,
  dst_section TEXT,
  PRIMARY KEY (src_section, form, raw_target)
) STRICT;

CREATE TABLE IF NOT EXISTS obligation (
  section_id TEXT NOT NULL REFERENCES section(id) ON DELETE CASCADE,
  ord        INTEGER NOT NULL,
  key        TEXT NOT NULL,
  text       TEXT NOT NULL,
  PRIMARY KEY (section_id, ord, key)
) STRICT;

CREATE VIRTUAL TABLE IF NOT EXISTS section_fts USING fts5(
  doc_title, title, body,
  content='section', content_rowid='rowid', tokenize='trigram'
);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TRIGGER IF NOT EXISTS section_ai AFTER INSERT ON section BEGIN
  INSERT INTO section_fts(rowid, doc_title, title, body)
  VALUES (NEW.rowid, NEW.doc_title, NEW.title, NEW.body);
END;

CREATE TRIGGER IF NOT EXISTS section_ad AFTER DELETE ON section BEGIN
  INSERT INTO section_fts(section_fts, rowid, doc_title, title, body)
  VALUES ('delete', OLD.rowid, OLD.doc_title, OLD.title, OLD.body);
END;
`;

  /** The content hash the previous version stored for a text under settings with no derived columns. */
  const previousHash = (text: string): string =>
    createHash('sha256').update('{"derivation":2}').update(text).digest('hex');

  // An ingest that trusts the stored hash skips every unchanged document and leaves the
  // sections without chunks, so the chunk index finds nothing; a schema open that leaves
  // `section_fts` behind keeps a table nothing maintains.
  it('drops section_fts and its triggers on open, then fills every section with chunks on the next ingest', async () => {
    const root = join(tmp, 'tree');
    mkdirSync(join(root, 'notes'), { recursive: true });
    const sources: Source[] = [
      {
        id: 'notes/long',
        text: `---\ntitle: Long\n---\n## Topic\n\n${[
          paragraph(200),
          paragraph(200, { 40: 'quartz' }),
          paragraph(200),
        ].join('\n\n')}\n`,
      },
      { id: 'notes/short', text: '# Short\n\n## Topic\n\nmeadow kite.\n' },
    ];
    const path = join(tmp, 'memory.db');
    const previous = new DatabaseSync(path);
    previous.exec(PREVIOUS_SCHEMA);
    previous
      .prepare("INSERT INTO meta (key, value) VALUES ('ingested_at', ?)")
      .run('2026-01-01T00:00:00.000Z');
    const insertSection = previous.prepare(
      'INSERT INTO section (id, concept_id, ord, doc_title, title, body) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (const source of sources) {
      writeFileSync(join(root, `${source.id}.md`), source.text);
      const document = parseDocument(source);
      previous
        .prepare('INSERT INTO concept (id, title, content_hash) VALUES (?, ?, ?)')
        .run(document.id, document.title, previousHash(source.text));
      for (const section of document.sections)
        insertSection.run(
          `${document.id}#${section.anchor}`,
          document.id,
          section.ord,
          document.title,
          section.title,
          section.body,
        );
    }
    previous.close();

    const db = open('memory.db');
    expect(tableNames(db)).toEqual(['chunk', 'chunk_fts']);
    expect(
      (
        db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'section_fts%'").all() as {
          name: string;
        }[]
      ).map((row) => row.name),
    ).toEqual([]);
    // Without chunks every query would find nothing, so the stamp that says an ingest completed
    // leaves with the old index.
    const stamp = () => db.prepare("SELECT value FROM meta WHERE key = 'ingested_at'").get();
    expect(stamp()).toBeUndefined();

    ingestMemory({ db, root, config: CONFIG });
    expect(stamp()).toBeDefined();
    expect(sectionsWithoutChunks(db)).toEqual([]);
    expect(chunkRows(db).filter((row) => row.id === 'notes/long#topic').length).toBeGreaterThan(1);
    expect((await searchMemory({ db, query: 'quartz' })).map((row) => row.id)).toEqual([
      'notes/long#topic',
    ]);
  });
});
