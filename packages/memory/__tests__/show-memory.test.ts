import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseDocument } from '../src/parse-document.ts';
import { replaceDocument } from '../src/replace-document.ts';
import { openMemoryDb } from '../src/schema.ts';
import { showMemory } from '../src/show-memory.ts';

let root: string;
let db: DatabaseSync;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pdks-show-'));
  db = openMemoryDb({ path: join(root, 'memory.db') });
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

function ingest(id: string, text: string): void {
  db.exec('BEGIN');
  replaceDocument({ db, document: parseDocument({ id, text }) });
  db.exec('COMMIT');
}

describe('showMemory', () => {
  it('returns the document metadata and full section bodies in source order, including the preamble', () => {
    ingest(
      'notes/example',
      '---\ntitle: Example\nstatus: draft\ncustom: retained\n---\n# Main\n\nPreamble text.\n\n## Later {#later}\n\nFirst section body.\n\n## Earlier {#earlier}\n\nSecond section body.\n',
    );

    expect(showMemory({ db, id: 'notes/example' })).toMatchObject({
      id: 'notes/example',
      title: 'Example',
      metadata: { status: 'draft', custom: 'retained' },
      sections: [
        { id: 'notes/example#', ord: 0, body: expect.stringContaining('Preamble text.') },
        {
          id: 'notes/example#later',
          ord: 1,
          title: 'Later',
          body: expect.stringContaining('First section body.'),
        },
        {
          id: 'notes/example#earlier',
          ord: 2,
          title: 'Earlier',
          body: expect.stringContaining('Second section body.'),
        },
      ],
    });
  });

  it('returns an exact section and checks a document ID containing # before section IDs', () => {
    ingest('notes/a#b', '# Hash document\n\n## Topic\n\nHash document body.\n');
    ingest('notes/a', '# Parent\n\n## B {#b}\n\nParent section body.\n');

    expect(showMemory({ db, id: 'notes/a#b' })).toMatchObject({
      id: 'notes/a#b',
      title: 'Hash document',
      sections: expect.any(Array),
    });
    expect(showMemory({ db, id: 'notes/a#b#topic' })).toMatchObject({
      id: 'notes/a#b#topic',
      docTitle: 'Hash document',
      sectionTitle: 'Topic',
      body: '\nHash document body.\n',
    });
    expect(showMemory({ db, id: 'notes/a#missing' })).toBeUndefined();
    expect(showMemory({ db, id: 'notes/missing' })).toBeUndefined();
  });
});
