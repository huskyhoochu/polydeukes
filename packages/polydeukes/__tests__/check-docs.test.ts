import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, '../../../scripts/check-docs.mjs');
const roots: string[] = [];

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'pdks-check-docs-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function write(root: string, rel: string, content: string): void {
  const path = join(root, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function writePair(root: string, englishRel: string, content: string): void {
  write(root, join('docs', englishRel), content);
  write(root, join('docs', englishRel.replace(/\.md$/, '.ko.md')), content);
}

function page(body = ''): string {
  return `# Title\n\n<a id="intro"></a>\n## Intro\n\n${body}`;
}

function writeCatalog(
  root: string,
  catalog: {
    documents?: unknown[];
    topics?: Record<string, { references: unknown[]; seeAlso: string }>;
    redirects?: unknown[];
  },
): void {
  write(
    root,
    join('docs', 'catalog.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        documents: catalog.documents ?? [],
        topics: catalog.topics ?? {},
        redirects: catalog.redirects ?? [],
      },
      null,
      2,
    )}\n`,
  );
}

function documentEntry(id: string, path = `${id}.md`) {
  return {
    id,
    category: 'how-to',
    order: 1,
    bundled: true,
    en: { path, title: id, summary: id },
    ko: { path: path.replace(/\.md$/, '.ko.md'), title: id, summary: id },
  };
}

function listedGuide(root: string, body = page()): void {
  writePair(root, 'guide.md', body);
  writeCatalog(root, { documents: [documentEntry('guide', 'guide.md')] });
}

function run(root: string, argv = ['--root', root]) {
  return spawnSync(process.execPath, [script, ...argv], {
    encoding: 'utf8',
    timeout: 15_000,
  });
}

describe('check-docs usage', () => {
  it('exits 2 for argv other than --root directory', () => {
    const root = fixture();
    writePair(root, 'guide.md', page());
    const result = run(root, ['--help']);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Usage: node scripts/check-docs.mjs [--root directory]');
  });
});

describe('inline and fenced code are not links', () => {
  it('does not treat a markdown link inside inline code as a link', () => {
    const root = fixture();
    writePair(root, 'guide.md', page('See `[한국어](./X.ko.md)` in the sentence.\n'));
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('X.ko.md');
  });

  it('does not treat a markdown link inside double-backtick inline code as a link', () => {
    const root = fixture();
    writePair(
      root,
      'guide.md',
      page(`See ${'``'} \`[한국어](./X.ko.md)\` ${'``'} in the sentence.\n`),
    );
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('X.ko.md');
  });

  it('does not treat a markdown link inside a fenced code block as a link', () => {
    const root = fixture();
    writePair(
      root,
      'guide.md',
      [
        '# Title',
        '',
        '<a id="intro"></a>',
        '## Intro',
        '',
        '```',
        '[missing](./gone.md)',
        '```',
        '',
        '~~~',
        '[missing](./gone.md)',
        '~~~',
        '',
      ].join('\n'),
    );
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('gone.md');
  });

  it('still checks a link that sits next to inline code', () => {
    const root = fixture();
    writePair(root, 'guide.md', page('See `ok` [missing](./gone.md).\n'));
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing target: ./gone.md');
  });

  it('does not extract CommonMark autolinks, images, or HTML hrefs (declared limit)', () => {
    const root = fixture();
    writePair(
      root,
      'guide.md',
      page(
        'See <https://example.invalid/missing> and <a href="./gone.md">html</a> and ![img](./gone.png).\n',
      ),
    );
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
  });
});

describe('reference-style links are checked', () => {
  it('reports a reference definition whose target file is missing', () => {
    const root = fixture();
    writePair(root, 'guide.md', page('See [here][ref].\n\n[ref]: ./gone.md\n'));
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing target: ./gone.md');
  });

  it('accepts a reference definition whose target file exists', () => {
    const root = fixture();
    writePair(root, 'guide.md', page('See [here][ref].\n\n[ref]: ./other.md\n'));
    writePair(root, 'other.md', page());
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
  });
});

describe('anchors', () => {
  it('reports a duplicate explicit id', () => {
    const root = fixture();
    writePair(
      root,
      'guide.md',
      [
        '# Title',
        '',
        '<a id="intro"></a>',
        '## Intro',
        '',
        '<a id="intro"></a>',
        '## Other',
        '',
      ].join('\n'),
    );
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('duplicate explicit anchor intro');
  });

  it('gives duplicate headings distinct slug ids so a link to slug-1 resolves', () => {
    const root = fixture();
    writePair(
      root,
      'guide.md',
      ['# Title', '', '## Twin', '', '## Twin', '', 'See [second](#twin-1).', ''].join('\n'),
    );
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
  });

  it('reports a fragment that matches no explicit anchor and no heading slug', () => {
    const root = fixture();
    writePair(root, 'guide.md', page('See [missing](#no-such).\n'));
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing anchor: #no-such');
  });

  it('accepts a fragment that matches an explicit anchor', () => {
    const root = fixture();
    writePair(root, 'guide.md', page('See [here](#intro).\n'));
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
  });
});

describe('language pairs and file targets', () => {
  it('reports a docs file whose language sibling is missing', () => {
    const root = fixture();
    write(root, join('docs', 'guide.md'), page());
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing language pair');
    expect(result.stderr).toContain('guide.ko.md');
  });

  it('reports a missing file target', () => {
    const root = fixture();
    writePair(root, 'guide.md', page('See [missing](./gone.md).\n'));
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing target: ./gone.md');
  });

  it('accepts a local file target that exists', () => {
    const root = fixture();
    writePair(root, 'guide.md', page('See [other](./other.md).\n'));
    writePair(root, 'other.md', page());
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
  });
});

describe('catalog, redirects, and topics', () => {
  it('reports a docs markdown file that is neither a catalog document nor a redirect', () => {
    const root = fixture();
    listedGuide(root);
    writePair(root, 'extra.md', page());
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('docs/extra.md');
    expect(result.stderr).toContain('not in catalog documents or redirects');
  });

  it('does not report a redirect path as an unlisted document', () => {
    const root = fixture();
    writePair(root, 'guide.md', page());
    writePair(root, 'old.md', page());
    writeCatalog(root, {
      documents: [documentEntry('guide', 'guide.md')],
      redirects: [
        { path: 'old.md', target: 'guide.md' },
        { path: 'old.ko.md', target: 'guide.ko.md' },
      ],
    });
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
  });

  it('reports a catalog document path that does not exist', () => {
    const root = fixture();
    writePair(root, 'present.md', page());
    writeCatalog(root, {
      documents: [documentEntry('present', 'present.md'), documentEntry('gone', 'gone.md')],
    });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing document path gone.md');
  });

  it('reports a redirect whose target does not exist', () => {
    const root = fixture();
    writePair(root, 'guide.md', page());
    writePair(root, 'old.md', page());
    writeCatalog(root, {
      documents: [documentEntry('guide', 'guide.md')],
      redirects: [
        { path: 'old.md', target: 'gone.md' },
        { path: 'old.ko.md', target: 'gone.ko.md' },
      ],
    });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing redirect target gone.md');
  });

  it('reports a topic sectionId that matches only a heading slug, not an explicit anchor', () => {
    const root = fixture();
    writePair(root, 'guide.md', '# Title\n\n## Intro\n\nBody.\n');
    writeCatalog(root, {
      documents: [documentEntry('guide', 'guide.md')],
      topics: {
        install: {
          references: [{ documentId: 'guide', sectionId: 'intro' }],
          seeAlso: 'guide',
        },
      },
    });
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('sectionId intro is not an explicit anchor');
  });

  it('accepts a topic sectionId that is an explicit anchor', () => {
    const root = fixture();
    listedGuide(root);
    writeCatalog(root, {
      documents: [documentEntry('guide', 'guide.md')],
      topics: {
        install: {
          references: [{ documentId: 'guide', sectionId: 'intro' }],
          seeAlso: 'guide',
        },
      },
    });
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
  });

  it('skips catalog checks when catalog.json is absent', () => {
    const root = fixture();
    writePair(root, 'guide.md', page());
    writePair(root, 'extra.md', page());
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('not in catalog');
  });
});

describe('exit codes', () => {
  it('exits 0 on a clean tree', () => {
    const root = fixture();
    listedGuide(root);
    const result = run(root);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('exits 1 when it reports an error', () => {
    const root = fixture();
    writePair(root, 'guide.md', page('See [missing](./gone.md).\n'));
    const result = run(root);
    expect(result.status).toBe(1);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
