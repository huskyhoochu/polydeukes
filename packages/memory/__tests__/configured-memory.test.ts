import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MemoryConfig } from '../src/memory-config.ts';
import { parseDocument } from '../src/parse-document.ts';
import { replaceDocument } from '../src/replace-document.ts';
import { openMemoryDb } from '../src/schema.ts';
import { searchMemory } from '../src/search-memory.ts';

let root: string;
let db: DatabaseSync;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdks-configured-memory-'));
  db = openMemoryDb({ path: join(root, 'memory.db') });
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

function ingest(id: string, text: string, config?: MemoryConfig): void {
  db.exec('BEGIN');
  replaceDocument({ db, document: parseDocument({ id, text }), config });
  db.exec('COMMIT');
}

function concept(id: string): { doc_type: string | null; ticket: string | null; metadata: string } {
  return db.prepare('SELECT doc_type, ticket, metadata FROM concept WHERE id = ?').get(id) as {
    doc_type: string | null;
    ticket: string | null;
    metadata: string;
  };
}

describe('configured document replacement', () => {
  it('maps declared types, preserves unmapped types, and retains source metadata', () => {
    const config = { include: ['notes/**/*.md'], typeMap: { decision: 'reference' } };
    ingest(
      'notes/mapped',
      '---\ntitle: Mapped\ntype: decision\nextra: retained\n---\n## Topic\n\nText.\n',
      config,
    );
    ingest('notes/unmapped', '---\ntype: guide\n---\n## Topic\n\nText.\n', config);
    ingest('notes/plain', '## Topic\n\nText.\n', config);

    expect(concept('notes/mapped').doc_type).toBe('reference');
    expect(JSON.parse(concept('notes/mapped').metadata)).toEqual({
      title: 'Mapped',
      type: 'decision',
      extra: 'retained',
    });
    expect(concept('notes/unmapped').doc_type).toBe('guide');
    expect(concept('notes/plain').doc_type).toBeNull();
  });

  it('takes the first matching ticket rule after type filtering and remains stable on replacement', () => {
    const config: MemoryConfig = {
      include: ['notes/**/*.md'],
      ticket: [
        { type: 'decision', from: 'frontmatter', key: 'issue', pattern: '[A-Z]+-[0-9]+' },
        { from: 'title', pattern: '[A-Z]+-[0-9]+' },
        { from: 'frontmatter', key: 'fallback' },
        { from: 'frontmatter', key: 'numeric' },
      ],
    };
    const docs = [
      [
        'notes/front',
        '---\ntitle: PR-12 summary\ntype: decision\nissue: BK-34 extra\n---\n## Topic\nText.\n',
        'BK-34',
      ],
      [
        'notes/title',
        '---\ntitle: PR-12 summary\ntype: guide\nissue: BK-34\n---\n## Topic\nText.\n',
        'PR-12',
      ],
      [
        'notes/no-pattern-match',
        '---\ntitle: PR-12 summary\ntype: decision\nissue: no identifier here\n---\n## Topic\nText.\n',
        'PR-12',
      ],
      [
        'notes/nonstring-issue',
        '---\ntitle: PR-12 summary\ntype: decision\nissue: 42\n---\n## Topic\nText.\n',
        'PR-12',
      ],
      ['notes/fallback', '---\ntitle: Untitled\nfallback: Q-7\n---\n## Topic\nText.\n', 'Q-7'],
      ['notes/numeric', '---\ntitle: Untitled\nnumeric: 42\n---\n## Topic\nText.\n', null],
      ['notes/none', '---\ntitle: Untitled\n---\n## Topic\nText.\n', null],
    ] as const;
    for (const [id, text, expected] of docs) {
      ingest(id, text, config);
      expect(concept(id).ticket).toBe(expected);
      ingest(id, text, config);
      expect(concept(id).ticket).toBe(expected);
    }
  });
});

describe('configured search ranking', () => {
  it('uses only declared map keys for a document type that names an Object prototype member', () => {
    const config = {
      include: ['notes/**/*.md'],
      typeMap: { decision: 'reference' },
      weights: { reference: 4 },
    };
    ingest('notes/a', '---\ntype: toString\n---\n## Topic\nneedleword.\n', config);
    ingest('notes/z', '---\ntype: decision\n---\n## Topic\nneedleword.\n', config);

    expect(concept('notes/a').doc_type).toBe('toString');
    expect(searchMemory({ db, query: 'needleword', config }).map((row) => row.id)).toEqual([
      'notes/z#topic',
      'notes/a#topic',
    ]);
  });

  it('weights stored document types within status without changing hits or paths', () => {
    const config = {
      include: ['notes/**/*.md'],
      typeMap: { decision: 'reference', guide: 'howto' },
      weights: { reference: 4 },
    };
    ingest('notes/a', '---\ntitle: A\ntype: guide\n---\n## Topic\nneedleword.\n', config);
    ingest('notes/z', '---\ntitle: Z\ntype: decision\n---\n## Topic\nneedleword.\n', config);
    ingest(
      'notes/deprecated',
      '---\ntitle: D\ntype: decision\nstatus: deprecated\n---\n## Topic\nneedleword.\n',
      config,
    );

    const baseline = searchMemory({ db, query: 'needleword' });
    const weighted = searchMemory({ db, query: 'needleword', config });
    expect(baseline.map((row) => row.id)).toEqual([
      'notes/a#topic',
      'notes/z#topic',
      'notes/deprecated#topic',
    ]);
    expect(weighted.map((row) => row.id)).toEqual([
      'notes/z#topic',
      'notes/a#topic',
      'notes/deprecated#topic',
    ]);
    expect(weighted.map((row) => [row.id, row.matchPath]).sort()).toEqual(
      baseline.map((row) => [row.id, row.matchPath]).sort(),
    );
  });
});
