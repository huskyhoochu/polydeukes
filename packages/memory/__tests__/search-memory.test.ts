import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseDocument } from '../src/parse-document.ts';
import { replaceDocument } from '../src/replace-document.ts';
import { openMemoryDb } from '../src/schema.ts';
import { searchMemory } from '../src/search-memory.ts';

let root: string;
let db: DatabaseSync;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdks-search-'));
  db = openMemoryDb({ path: join(root, 'memory.db') });
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

function ingest(sources: { id: string; text: string }[]): void {
  db.exec('BEGIN');
  for (const source of sources) replaceDocument({ db, document: parseDocument(source) });
  db.exec('COMMIT');
}

async function ids(query: string): Promise<string[]> {
  return (await searchMemory({ db, query, limit: 100 })).map((result) => result.id).sort();
}

function contentLikeIds(term: string): string[] {
  const pattern = `%${term.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
  return (
    db
      .prepare(
        "SELECT id FROM section WHERE doc_title LIKE ? ESCAPE '\\' OR title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' ORDER BY id",
      )
      .all(pattern, pattern, pattern) as { id: string }[]
  ).map((row) => row.id);
}

describe('searchMemory loads the analyzer silently', () => {
  // This block runs before every other Hangul query in the file, so its search is the one
  // that loads the analyzer, whose loader prints a deprecation line through `console.warn`.
  // A search that lets it through writes to stderr once per process; one that swaps
  // `console.warn` and never swaps it back leaves every later caller with a foreign function.
  it('keeps the loader line off console.warn and hands console.warn back after the load', async () => {
    ingest([{ id: 'notes/a', text: '# A\n\n## Topic\n\ncognee 제거 결정.\n' }]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const found = await searchMemory({ db, query: '왜 cognee를 제거했나' });
      expect(found.map((row) => row.id)).toEqual(['notes/a#topic']);
      expect(warn).not.toHaveBeenCalled();
      expect(console.warn).toBe(warn);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('searchMemory', () => {
  it('recalls six long terms and the two-term query against their full-scan oracles', async () => {
    ingest([
      {
        id: 'notes/first',
        text: '---\ntitle: 게이트 roadmap\n---\n## Setup\n\n워크트리와 스냅샷. T-260901.\n\n## Criteria\n\n수용 기준과 MQ-568.\n',
      },
      {
        id: 'notes/second',
        text: '---\ntitle: Search guide\n---\n## 게이트\n\nT-260901와 roadmap.\n\n## Snapshot\n\n스냅샷을 수용 기준으로 검토.\n',
      },
      { id: 'notes/third', text: '# Other\n\n## Topic\n\n관련 없는 본문.\n' },
    ]);

    for (const term of ['게이트', '워크트리', '스냅샷', 'T-260901', 'MQ-568', 'roadmap']) {
      const expected = contentLikeIds(term);
      expect(expected.length, term).toBeGreaterThan(0);
      expect(await ids(term), term).toEqual(expected);
    }
    const twoTermExpected = db
      .prepare(
        "SELECT id FROM section WHERE (doc_title LIKE '%수용%' OR title LIKE '%수용%' OR body LIKE '%수용%') AND (doc_title LIKE '%기준%' OR title LIKE '%기준%' OR body LIKE '%기준%') ORDER BY id",
      )
      .all() as { id: string }[];
    expect(await ids('수용 기준')).toEqual(twoTermExpected.map((row) => row.id));
  });

  it('finds short text and identifier prefixes literally and labels the scan path', async () => {
    ingest([
      { id: 'T-260901', text: '# Topic\n\n## Alpha\n\n스냅샷 검증 알림.\n' },
      { id: 'MQ-568', text: '# Other\n\n## Beta\n\n스냅 검증.\n' },
      { id: 'notes/third', text: '# Last\n\n## Gamma\n\n알림.\n' },
    ]);

    const cases: [string, string[]][] = [
      ['스냅', ['MQ-568#beta', 'T-260901#alpha']],
      ['검증', ['MQ-568#beta', 'T-260901#alpha']],
      ['알림', ['T-260901#alpha', 'notes/third#gamma']],
      ['림', ['T-260901#alpha', 'notes/third#gamma']],
      ['T-260', ['T-260901#', 'T-260901#alpha']],
      ['MQ-5', ['MQ-568#', 'MQ-568#beta']],
    ];
    for (const [query, expected] of cases) {
      expect(await ids(query), query).toEqual(expected);
      expect(
        (await searchMemory({ db, query })).every((result) => result.matchPath === 'like'),
        query,
      ).toBe(true);
    }
  });

  it('uses AND before OR, deduplicates sections, and treats query syntax as text', async () => {
    ingest([
      { id: 'notes/a', text: '# A\n\n## Both\n\nalpha beta 100% ready.\n' },
      { id: 'notes/b', text: '# B\n\n## One\n\nalpha literal_x and a "quote".\n' },
      { id: 'notes/c', text: '# C\n\n## Other\n\ngamma.\n' },
    ]);

    const andResults = await searchMemory({ db, query: 'alpha beta' });
    expect(andResults.map((result) => result.id)).toEqual(['notes/a#both']);
    expect(andResults[0]?.matchPath).toBe('and');

    const orResults = await searchMemory({ db, query: 'alpha beta gamma' });
    expect(orResults.map((result) => result.id).sort()).toEqual([
      'notes/a#both',
      'notes/b#one',
      'notes/c#other',
    ]);
    expect(orResults.every((result) => result.matchPath === 'or')).toBe(true);
    expect(new Set(orResults.map((result) => result.id)).size).toBe(orResults.length);

    expect(await ids('%')).toEqual(['notes/a#both']);
    expect(await ids('_')).toEqual(['notes/b#one']);
    expect(await ids('"quote"')).toEqual(['notes/b#one']);
    expect(await ids('')).toEqual([]);
  });

  it('puts deprecated documents last and breaks equal-score ties by section ID', async () => {
    ingest([
      {
        id: 'notes/z',
        text: '---\ntitle: Z document\nstatus: deprecated\n---\n## Same\n\nsharedphrase.\n',
      },
      { id: 'notes/b', text: '---\ntitle: B document\n---\n## Same\n\nsharedphrase.\n' },
      { id: 'notes/a', text: '---\ntitle: A document\n---\n## Same\n\nsharedphrase.\n' },
    ]);

    expect(await searchMemory({ db, query: 'sharedphrase' })).toMatchObject([
      { id: 'notes/a#same', docTitle: 'A document', sectionTitle: 'Same', status: 'stable' },
      { id: 'notes/b#same', docTitle: 'B document', sectionTitle: 'Same', status: 'stable' },
      { id: 'notes/z#same', docTitle: 'Z document', sectionTitle: 'Same', status: 'deprecated' },
    ]);
  });

  it('ranks a stronger FTS hit before the ID tie break and applies a caller limit', async () => {
    ingest([
      { id: 'notes/a', text: '## Topic\n\nneedleword plain text.\n' },
      { id: 'notes/z', text: '## Topic\n\nneedleword needleword needleword.\n' },
    ]);
    expect((await searchMemory({ db, query: 'needleword' })).map((row) => row.id)).toEqual([
      'notes/z#topic',
      'notes/a#topic',
    ]);
    expect(
      (await searchMemory({ db, query: 'needleword', limit: 1 })).map((row) => row.id),
    ).toEqual(['notes/z#topic']);
  });

  it('returns the default limit when a short query matches more rows than SQLite can bind', async () => {
    db.exec('BEGIN');
    db.prepare('INSERT INTO concept (id, title) VALUES (?, ?)').run('many', 'Many');
    const insert = db.prepare(
      'INSERT INTO section (id, concept_id, ord, doc_title, title, body) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (let i = 0; i < 32_767; i++) {
      insert.run(`many#${i}`, 'many', i, '', '', 'x');
    }
    db.exec('COMMIT');

    const results = await searchMemory({ db, query: 'x' });
    expect(results).toHaveLength(20);
    expect(new Set(results.map((row) => row.id)).size).toBe(20);
  });

  it('preserves metadata and reports freshness and the three trust grades', async () => {
    ingest([
      { id: 'notes/plain', text: '# Plain\n\n## Topic\n\nneedleword.\n' },
      {
        id: 'notes/broken',
        text: '---\ntitle: [unclosed\n---\n# Broken\n\n## Topic\n\nneedleword.\n',
      },
      {
        id: 'notes/generated',
        text: '---\ntitle: Generated\nstatus: draft\nstale_after: 2026-09-01T00:00:00Z\ngenerated:\n  by: agent\nextra_key: retained\n---\n## Topic\n\nneedleword.\n',
      },
      {
        id: 'notes/machine',
        text: '---\ntitle: Machine\nstale_after: 2026-12-01T00:00:00Z\nverified:\n  by: agent\n---\n## Topic\n\nneedleword.\n',
      },
      {
        id: 'notes/human',
        text: '---\ntitle: Human\nverified:\n  - by: human:alice\n---\n## Topic\n\nneedleword.\n',
      },
    ]);

    const found = await searchMemory({
      db,
      query: 'needleword',
      now: new Date('2026-09-24T00:00:00Z'),
    });
    const byId = new Map(found.map((result) => [result.id, result]));
    expect(byId.get('notes/plain#topic')).toMatchObject({ status: 'stable', trust: 'unverified' });
    expect(byId.get('notes/broken#topic')).toMatchObject({ status: 'stable', trust: 'unverified' });
    expect(byId.get('notes/generated#topic')).toMatchObject({
      status: 'draft',
      trust: 'unverified',
      stale: true,
    });
    const atBoundary = await searchMemory({
      db,
      query: 'needleword',
      now: new Date('2026-09-01T00:00:00Z'),
    });
    expect(atBoundary.find((result) => result.id === 'notes/generated#topic')?.stale).toBe(true);
    expect(byId.get('notes/machine#topic')).toMatchObject({
      trust: 'machine-verified',
      stale: false,
    });
    expect(byId.get('notes/human#topic')).toMatchObject({ trust: 'human-reviewed' });
  });
});

describe('searchMemory ranks LIKE-path (1–2 char) terms by bm25', () => {
  // Every document shares one doc_title so the two candidates differ only in body; the third
  // document adds non-matching rows so N > 2n keeps the IDF positive rather than floored.
  const doc = (id: string, body: string) => ({
    id,
    text: `---\ntitle: Same doc\n---\n## Topic\n\n${body}\n`,
  });
  const filler = [
    {
      id: 'notes/filler',
      text: '# Filler\n\n## One\n\nnothing here.\n\n## Two\n\nnothing here.\n',
    },
  ];
  const order = async (query: string) => (await searchMemory({ db, query })).map((row) => row.id);

  it('ranks more occurrences of a 2-char term first at equal length, counted ASCII case-insensitively', async () => {
    // Catches a LIKE path that scores every match 0 (ID order), and a tf that counts only the
    // query's own case: the `QZ Qz qZ` row would then tie at 0 and lose. The uppercase query
    // catches a fold applied to the rows but not to the term.
    ingest([doc('notes/a', 'qz aa aa aa aa.'), doc('notes/z', 'QZ Qz qZ aa aa.'), ...filler]);
    expect(await order('qz')).toEqual(['notes/z#topic', 'notes/a#topic']);
    expect(await order('QZ')).toEqual(['notes/z#topic', 'notes/a#topic']);
  });

  it('keeps tf ahead of ID order when the term matches over half the sections (IDF floored)', async () => {
    // N = 2, n = 2 makes the raw IDF negative. A missing floor gives positive scores and puts
    // the higher-tf row last; a floor at 0 ties both rows and falls back to ID order.
    ingest([doc('notes/a', 'qz aa aa aa aa.'), doc('notes/z', 'qz qz qz aa aa.')]);
    expect(await order('qz')).toEqual(['notes/z#topic', 'notes/a#topic']);
  });

  it('keeps type weights when every column is under three characters', async () => {
    // No column reaches a trigram, so the mean length is 0; the length ratio must not turn
    // every score into NaN, which would drop the weight and fall back to ID order.
    ingest([
      { id: 'notes/b', text: '---\ntitle: qz\ntype: prd\n---\n## B\n' },
      { id: 'notes/a', text: '---\ntitle: qz\n---\n## B\n' },
    ]);
    const config = { include: [], weights: { prd: 5 } };
    expect((await searchMemory({ db, query: 'qz', config })).map((row) => row.id)).toEqual([
      'notes/b#b',
      'notes/a#b',
    ]);
  });

  it('counts occurrences in doc_title and title, not only in body', async () => {
    // Each row holds the term in one column only. Counting body alone leaves y and z at 0;
    // counting title and body alone leaves y at 0. Same tf between y and z, y is shorter.
    ingest([
      doc('notes/a', 'qz aa aa aa aa.'),
      { id: 'notes/y', text: '---\ntitle: qz qz qz\n---\n## Topic\n\naa aa aa aa aa.\n' },
      { id: 'notes/z', text: '---\ntitle: Same doc\n---\n## qz qz qz\n\naa aa aa aa aa.\n' },
      ...filler,
    ]);
    expect(await order('qz')).toEqual(['notes/y#topic', 'notes/z#qz-qz-qz', 'notes/a#topic']);
  });

  it('ranks the shorter section first at equal occurrences of a 2-char term', async () => {
    // Catches a score without length normalisation (b = 0) — equal tf would tie by ID.
    ingest([doc('notes/a', 'qz aa aa aa aa aa aa aa.'), doc('notes/z', 'qz.'), ...filler]);
    expect(await order('qz')).toEqual(['notes/z#topic', 'notes/a#topic']);
  });

  it('lets a 2-char term break the tie of a mixed query whose long term scores equally', async () => {
    // Bodies are the same length and hold `needleword` once each, so the FTS contribution is
    // identical; catches a mixed query that sums only the FTS-path score.
    ingest([
      doc('notes/a', 'needleword qz aa aa.'),
      doc('notes/z', 'needleword qz qz qz.'),
      ...filler,
    ]);
    const results = await searchMemory({ db, query: 'needleword qz' });
    expect(results.map((row) => row.id)).toEqual(['notes/z#topic', 'notes/a#topic']);
    // A result with any LIKE-path hit is labelled `like`; the new score does not relabel it.
    expect(results.every((row) => row.matchPath === 'like')).toBe(true);
  });

  it('keeps identifier-prefix-only hits at score 0: after text hits, among themselves by ID', async () => {
    // Catches a prefix hit scored as if it were a text match, and a text hit that no longer
    // outranks an ID-only hit whose section ID sorts earlier.
    ingest([
      doc('qz-b', 'nothing here.'),
      doc('qz-a', 'nothing here.'),
      doc('zz-text', 'qz appears.'),
      ...filler,
    ]);
    expect(await order('qz')).toEqual(['zz-text#topic', 'qz-a#topic', 'qz-b#topic']);
  });

  it('keeps the LIKE score of a section matched by both its ID prefix and its text', async () => {
    // qz-b matches by prefix and by body (tf 1); dropping its text score to 0 would put it
    // behind nothing but tie it with qz-a and lose to it by ID. zz-text has tf 3 at the same
    // length.
    ingest([
      doc('qz-a', 'nothing here.'),
      doc('qz-b', 'qz aa aa aa.'),
      doc('zz-text', 'qz qz qz aa.'),
      ...filler,
    ]);
    expect(await order('qz')).toEqual(['zz-text#topic', 'qz-b#topic', 'qz-a#topic']);
  });
});

describe('the LIKE-path bm25 formula reproduces FTS5 bm25() on the same rows', () => {
  const k1 = 1.2;
  const b = 0.75;
  // ASCII-only case folding, the same fold SQLite LIKE applies.
  const foldAscii = (text: string) => text.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const occurrences = (text: string, term: string) => foldAscii(text).split(term).length - 1;

  type Row = { rowid: number; doc_title: string; title: string; body: string };

  function insertRows(rows: [string, string, string][]): void {
    db.exec('BEGIN');
    db.prepare('INSERT INTO concept (id, title) VALUES (?, ?)').run('c', 'C');
    const insert = db.prepare(
      'INSERT INTO section (id, concept_id, ord, doc_title, title, body) VALUES (?, ?, ?, ?, ?, ?)',
    );
    rows.forEach(([docTitle, title, body], i) => {
      insert.run(`c#${i}`, 'c', i, docTitle, title, body);
    });
    db.exec('COMMIT');
  }

  // len is the trigram token count per column, max(chars − 2, 0), summed over the three columns.
  const LEN =
    'max(length(doc_title) - 2, 0) + max(length(title) - 2, 0) + max(length(body) - 2, 0)';

  const RAW_LEN = 'length(doc_title) + length(title) + length(body)';
  const MATCHES = 'doc_title LIKE ? OR title LIKE ? OR body LIKE ?';

  // `lenExpr` and `avgOverMatched` select a wrong length unit or a wrong avglen population, so
  // a test can show which of them a fixture rejects.
  function handScores(
    term: string,
    { lenExpr = LEN, avgOverMatched = false }: { lenExpr?: string; avgOverMatched?: boolean } = {},
  ): Map<number, number> {
    const pattern = `%${term}%`;
    const { N } = db.prepare('SELECT count(*) AS N FROM section').get() as { N: number };
    const { avglen } = (
      avgOverMatched
        ? db
            .prepare(`SELECT avg(${lenExpr}) AS avglen FROM section WHERE ${MATCHES}`)
            .get(pattern, pattern, pattern)
        : db.prepare(`SELECT avg(${lenExpr}) AS avglen FROM section`).get()
    ) as { avglen: number };
    const matched = db
      .prepare(`SELECT rowid, doc_title, title, body FROM section WHERE ${MATCHES}`)
      .all(pattern, pattern, pattern) as Row[];
    const n = matched.length;
    const rawIdf = Math.log((N - n + 0.5) / (n + 0.5));
    const idf = rawIdf <= 0 ? 1e-6 : rawIdf;
    const scores = new Map<number, number>();
    for (const row of matched) {
      const tf = [row.doc_title, row.title, row.body].reduce(
        (sum, column) => sum + occurrences(column, term),
        0,
      );
      const { len } = db
        .prepare(`SELECT ${lenExpr} AS len FROM section WHERE rowid = ?`)
        .get(row.rowid) as { len: number };
      scores.set(row.rowid, (-idf * tf * (k1 + 1)) / (tf + k1 * (1 - b + (b * len) / avglen)));
    }
    return scores;
  }

  const rowidOf = (id: string) =>
    (db.prepare('SELECT rowid FROM section WHERE id = ?').get(id) as { rowid: number }).rowid;

  function ftsScores(term: string): Map<number, number> {
    const rows = db
      .prepare(
        'SELECT rowid, bm25(section_fts) AS score FROM section_fts WHERE section_fts MATCH ?',
      )
      .all(`"${term}"`) as { rowid: number; score: number }[];
    return new Map(rows.map((row) => [row.rowid, row.score]));
  }

  it('matches bm25() to six decimals with a positive IDF, including columns under 3 chars', () => {
    // Pins the formula against SQLite's own bm25(): the hand computation agrees only when a
    // column of 0–2 chars counts 0 tokens (max(chars − 2, 0), not raw chars) and when
    // uppercase `ABC` is counted, as the trigram tokenizer folds case.
    insertRows([
      ['Abc guide', '', 'abc once.'],
      ['ab', 'Abc', 'abc abc abc here.'],
      ['Other', 'Two', 'ABC in capitals.'],
      ['Other', 'Long', 'nothing matching at all in this longer body 한국어 본문.'],
      ['x', 'y', 'z'],
      ['Other', 'Five', 'still nothing.'],
      ['Other', 'Six', 'still nothing.'],
      ['Other', 'Seven', 'still nothing.'],
    ]);
    const expected = handScores('abc');
    const actual = ftsScores('abc');
    expect([...actual.keys()].sort()).toEqual([...expected.keys()].sort());
    expect(expected.size).toBe(3);
    for (const [rowid, score] of expected) {
      expect(score).toBeLessThan(0);
      expect(actual.get(rowid), `rowid ${rowid}`).toBeCloseTo(score, 6);
    }
    // The three matching rows must not tie: tf and len both move the score.
    expect(new Set([...expected.values()]).size).toBe(3);
  });

  it('floors a non-positive IDF at 1e-6 instead of 0, as bm25() does', () => {
    // N = 5, n = 3 makes ln((N − n + 0.5)/(n + 0.5)) negative; the hand formula agrees with
    // bm25() only with the 1e-6 floor — a floor at 0 gives 0, no floor gives positive scores.
    insertRows([
      ['Abc guide', '', 'abc once.'],
      ['ab', 'Abc', 'abc abc abc here.'],
      ['Other', 'Two', 'ABC in capitals.'],
      ['Other', 'Long', 'nothing matching at all.'],
      ['x', 'y', 'z'],
    ]);
    const expected = handScores('abc');
    const actual = ftsScores('abc');
    expect(expected.size).toBe(3);
    for (const [rowid, score] of expected) {
      expect(score).toBeLessThan(0);
      expect(score).toBeGreaterThan(-1e-4);
      expect((actual.get(rowid) ?? Number.NaN) / score, `rowid ${rowid}`).toBeCloseTo(1, 6);
    }
  });

  it('orders a LIKE-path hit against an FTS-path hit on one scale in an OR fallback', async () => {
    // `qz needleword` has no section with both terms, so both rows come back and their order
    // is decided by a LIKE score against an FTS5 score. The fixture is tuned so the correct
    // LIKE score (trigram-token len, avglen over every row) ranks z first, while len counted
    // in raw characters or avglen taken over the matched rows alone would rank y first — the
    // three assertions on the hand scores keep the fixture discriminating. z sorts after y
    // by ID, so ID order cannot produce the expected result either.
    const filler = (i: number) => ({
      id: `notes/f${i}`,
      text: `# F\n\n## One\n\n${'filler '.repeat(10)}\n`,
    });
    // z's doc_title and title are under 3 chars: 0 trigram tokens each, 3 raw chars together.
    ingest([
      { id: 'notes/y', text: '## Y\n\nneedleword needleword\n' },
      { id: 'notes/z', text: '---\ntitle: Sd\n---\n## X\n\nqz aa.\n' },
      filler(1),
      filler(2),
      filler(3),
    ]);
    const z = rowidOf('notes/z#x');
    const y = ftsScores('needleword').get(rowidOf('notes/y#y')) as number;
    const correct = handScores('qz').get(z) as number;
    expect(correct).toBeLessThan(y);
    expect(handScores('qz', { lenExpr: RAW_LEN }).get(z) as number).toBeGreaterThan(y);
    expect(handScores('qz', { avgOverMatched: true }).get(z) as number).toBeGreaterThan(y);

    const results = await searchMemory({ db, query: 'qz needleword' });
    expect(results.map((row) => row.id)).toEqual(['notes/z#x', 'notes/y#y']);
  });
});

describe('searchMemory over a query normalization changes', () => {
  const doc = (id: string, body: string) => ({
    id,
    text: `---\ntitle: Same doc\n---\n## Topic\n\n${body}\n`,
  });
  // Non-matching rows keep every term's IDF positive, so scores differ by term rather than
  // sitting at the floor.
  const filler = [
    {
      id: 'notes/filler',
      text: '# Filler\n\n## One\n\nnothing here.\n\n## Two\n\nnothing here.\n',
    },
  ];

  it('finds every section a Korean question names once its particles and endings are off, and tags each row by its own hits', async () => {
    // `왜 cognee를 제거했나` normalizes to `cognee` · `제거`. Taken literally no section holds
    // `cognee를` or `제거했나`, so a search without normalization answers nothing; one that keeps
    // the AND gate answers `a` alone; one that tags the whole answer by one path labels `b`
    // and `c` `like` or `a` `or`. `제거` is two characters, so `a`'s full match is a LIKE hit.
    ingest([
      doc('notes/a', 'cognee 제거 결정.'),
      doc('notes/b', 'cognee 도입.'),
      doc('notes/c', '제거 대상.'),
      ...filler,
    ]);
    const results = await searchMemory({ db, query: '왜 cognee를 제거했나' });
    expect(results.map((row) => row.id).sort()).toEqual([
      'notes/a#topic',
      'notes/b#topic',
      'notes/c#topic',
    ]);
    expect(results[0]?.id).toBe('notes/a#topic');
    expect(new Map(results.map((row) => [row.id, row.matchPath]))).toEqual(
      new Map([
        ['notes/a#topic', 'like'],
        ['notes/b#topic', 'or'],
        ['notes/c#topic', 'or'],
      ]),
    );
  });

  it('tags a row matched on every normalized term through FTS alone as and', async () => {
    // `the drift snapshot` normalizes to `drift` · `snapshot`, both three characters or more,
    // so `a` is matched twice through FTS and nothing through LIKE; a tag that says `like`
    // for any union row, or `or` for every union row, is wrong here.
    ingest([doc('notes/a', 'drift snapshot here.'), doc('notes/b', 'snapshot only here.')]);
    const results = await searchMemory({ db, query: 'the drift snapshot' });
    expect(new Map(results.map((row) => [row.id, row.matchPath]))).toEqual(
      new Map([
        ['notes/a#topic', 'and'],
        ['notes/b#topic', 'or'],
      ]),
    );
  });

  it('ranks a section matched on two normalized terms ahead of one matched on a single term', async () => {
    // Both bodies hold `drift` once at the same length, so the `drift` score ties and ID
    // order would put `a` first; only the summed `snapshot` score moves `z` ahead.
    ingest([doc('notes/a', 'drift aa aa aa aa.'), doc('notes/z', 'drift snapshot aa.'), ...filler]);
    expect((await searchMemory({ db, query: 'the drift snapshot' })).map((row) => row.id)).toEqual([
      'notes/z#topic',
      'notes/a#topic',
    ]);
  });

  it('tags a row whose normalized term is matched by its ID prefix as like', async () => {
    // `제거-note` holds `cognee` in its body and `제거` only as the start of its section ID, so
    // every term is matched and one of them by ID prefix; `b` is matched on `cognee` alone. A
    // tag that counts only text hits labels `제거-note` `or`; one that reads an ID hit as FTS
    // labels it `and`.
    ingest([doc('제거-note', 'cognee here.'), doc('notes/b', 'cognee 도입.'), ...filler]);
    const results = await searchMemory({ db, query: '왜 cognee를 제거했나' });
    const paths = new Map(results.map((row) => [row.id, row.matchPath]));
    expect(paths.get('제거-note#topic')).toBe('like');
    expect(paths.get('notes/b#topic')).toBe('or');
  });

  it('subtracts a configured document-type weight in the normalized path', async () => {
    // Both bodies are identical, so the summed term scores tie and ID order would put `a`
    // first; only the weight on `z`'s type moves it ahead.
    ingest([
      { id: 'notes/a', text: '---\ntitle: Same doc\n---\n## Topic\n\ncognee 제거 결정.\n' },
      {
        id: 'notes/z',
        text: '---\ntitle: Same doc\ntype: prd\n---\n## Topic\n\ncognee 제거 결정.\n',
      },
      ...filler,
    ]);
    const config = { include: [], weights: { prd: 5 } };
    const results = await searchMemory({ db, query: '왜 cognee를 제거했나', config });
    expect(results.map((row) => row.id)).toEqual(['notes/z#topic', 'notes/a#topic']);
  });

  it('puts a deprecated row after every other row in the normalized path', async () => {
    // Identical bodies tie on score and `a` sorts first by ID; a union that sorts by score
    // and ID alone puts the deprecated row first.
    ingest([
      {
        id: 'notes/a',
        text: '---\ntitle: Same doc\nstatus: deprecated\n---\n## Topic\n\ncognee 제거 결정.\n',
      },
      { id: 'notes/z', text: '---\ntitle: Same doc\n---\n## Topic\n\ncognee 제거 결정.\n' },
      ...filler,
    ]);
    const results = await searchMemory({ db, query: '왜 cognee를 제거했나' });
    expect(results.map((row) => [row.id, row.status])).toEqual([
      ['notes/z#topic', 'stable'],
      ['notes/a#topic', 'deprecated'],
    ]);
  });
});

describe('searchMemory keeps a query on the literal path when normalization drops every word', () => {
  const doc = (id: string, body: string) => ({
    id,
    text: `---\ntitle: Same doc\n---\n## Topic\n\n${body}\n`,
  });

  // `why` and `the` are function words and `얼마` · `다시` are an interrogative and an adverb,
  // so normalization leaves nothing; the search then runs the words as written. A search
  // over the empty list answers nothing; one that unions the original words answers `b` too.
  // Each fixture holds both words in `a` and one in `b`, so the AND answer is `a` alone.
  it.each([
    { query: 'why the', bodyA: 'why the drift.', bodyB: 'the only.', path: 'and' },
    { query: '얼마 다시', bodyA: '얼마 다시 시도.', bodyB: '다시 하나.', path: 'like' },
  ])(
    '$query: answers the AND result of the words as written',
    async ({ query, bodyA, bodyB, path }) => {
      ingest([doc('notes/a', bodyA), doc('notes/b', bodyB)]);
      const results = await searchMemory({ db, query });
      expect(results.map((row) => [row.id, row.matchPath])).toEqual([['notes/a#topic', path]]);
    },
  );

  // The literal path is chosen by comparing lists; a normalization that trims or collapses
  // the whitespace before comparing sees a changed list and sends the identifiers to the
  // union, which answers `b` as well.
  it('keeps an identifier query with surrounding and repeated whitespace on the AND path', async () => {
    ingest([doc('notes/a', 'T-260901 and MQ-568 both.'), doc('notes/b', 'T-260901 alone.')]);
    const results = await searchMemory({ db, query: '  T-260901   MQ-568 ' });
    expect(results.map((row) => [row.id, row.matchPath])).toEqual([['notes/a#topic', 'and']]);
  });
});
