import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

function ids(query: string): string[] {
  return searchMemory({ db, query, limit: 100 })
    .map((result) => result.id)
    .sort();
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

describe('searchMemory', () => {
  it('recalls six long terms and the two-term query against their full-scan oracles', () => {
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
      expect(ids(term), term).toEqual(expected);
    }
    const twoTermExpected = db
      .prepare(
        "SELECT id FROM section WHERE (doc_title LIKE '%수용%' OR title LIKE '%수용%' OR body LIKE '%수용%') AND (doc_title LIKE '%기준%' OR title LIKE '%기준%' OR body LIKE '%기준%') ORDER BY id",
      )
      .all() as { id: string }[];
    expect(ids('수용 기준')).toEqual(twoTermExpected.map((row) => row.id));
  });

  it('finds short text and identifier prefixes literally and labels the scan path', () => {
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
      expect(ids(query), query).toEqual(expected);
      expect(
        searchMemory({ db, query }).every((result) => result.matchPath === 'like'),
        query,
      ).toBe(true);
    }
  });

  it('uses AND before OR, deduplicates sections, and treats query syntax as text', () => {
    ingest([
      { id: 'notes/a', text: '# A\n\n## Both\n\nalpha beta 100% ready.\n' },
      { id: 'notes/b', text: '# B\n\n## One\n\nalpha literal_x and a "quote".\n' },
      { id: 'notes/c', text: '# C\n\n## Other\n\ngamma.\n' },
    ]);

    const andResults = searchMemory({ db, query: 'alpha beta' });
    expect(andResults.map((result) => result.id)).toEqual(['notes/a#both']);
    expect(andResults[0]?.matchPath).toBe('and');

    const orResults = searchMemory({ db, query: 'alpha beta gamma' });
    expect(orResults.map((result) => result.id).sort()).toEqual([
      'notes/a#both',
      'notes/b#one',
      'notes/c#other',
    ]);
    expect(orResults.every((result) => result.matchPath === 'or')).toBe(true);
    expect(new Set(orResults.map((result) => result.id)).size).toBe(orResults.length);

    expect(ids('%')).toEqual(['notes/a#both']);
    expect(ids('_')).toEqual(['notes/b#one']);
    expect(ids('"quote"')).toEqual(['notes/b#one']);
    expect(ids('')).toEqual([]);
  });

  it('puts deprecated documents last and breaks equal-score ties by section ID', () => {
    ingest([
      {
        id: 'notes/z',
        text: '---\ntitle: Z document\nstatus: deprecated\n---\n## Same\n\nsharedphrase.\n',
      },
      { id: 'notes/b', text: '---\ntitle: B document\n---\n## Same\n\nsharedphrase.\n' },
      { id: 'notes/a', text: '---\ntitle: A document\n---\n## Same\n\nsharedphrase.\n' },
    ]);

    expect(searchMemory({ db, query: 'sharedphrase' })).toMatchObject([
      { id: 'notes/a#same', docTitle: 'A document', sectionTitle: 'Same', status: 'stable' },
      { id: 'notes/b#same', docTitle: 'B document', sectionTitle: 'Same', status: 'stable' },
      { id: 'notes/z#same', docTitle: 'Z document', sectionTitle: 'Same', status: 'deprecated' },
    ]);
  });

  it('ranks a stronger FTS hit before the ID tie break and applies a caller limit', () => {
    ingest([
      { id: 'notes/a', text: '## Topic\n\nneedleword plain text.\n' },
      { id: 'notes/z', text: '## Topic\n\nneedleword needleword needleword.\n' },
    ]);
    expect(searchMemory({ db, query: 'needleword' }).map((row) => row.id)).toEqual([
      'notes/z#topic',
      'notes/a#topic',
    ]);
    expect(searchMemory({ db, query: 'needleword', limit: 1 }).map((row) => row.id)).toEqual([
      'notes/z#topic',
    ]);
  });

  it('returns the default limit when a short query matches more rows than SQLite can bind', () => {
    db.exec('BEGIN');
    db.prepare('INSERT INTO concept (id, title) VALUES (?, ?)').run('many', 'Many');
    const insert = db.prepare(
      'INSERT INTO section (id, concept_id, ord, doc_title, title, body) VALUES (?, ?, ?, ?, ?, ?)',
    );
    for (let i = 0; i < 32_767; i++) {
      insert.run(`many#${i}`, 'many', i, '', '', 'x');
    }
    db.exec('COMMIT');

    const results = searchMemory({ db, query: 'x' });
    expect(results).toHaveLength(20);
    expect(new Set(results.map((row) => row.id)).size).toBe(20);
  });

  it('preserves metadata and reports freshness and the three trust grades', () => {
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

    const found = searchMemory({ db, query: 'needleword', now: new Date('2026-09-24T00:00:00Z') });
    const byId = new Map(found.map((result) => [result.id, result]));
    expect(byId.get('notes/plain#topic')).toMatchObject({ status: 'stable', trust: 'unverified' });
    expect(byId.get('notes/broken#topic')).toMatchObject({ status: 'stable', trust: 'unverified' });
    expect(byId.get('notes/generated#topic')).toMatchObject({
      status: 'draft',
      trust: 'unverified',
      stale: true,
    });
    const atBoundary = searchMemory({
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
