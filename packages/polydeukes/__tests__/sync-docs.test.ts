import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const script = resolve(import.meta.dirname, '../../documentation/scripts/sync-docs.mjs');
const roots: string[] = [];

interface Page {
  path: string;
  en: string;
  ko: string;
  category?: string;
  order?: number;
}

function write(root: string, relativePath: string, content: string): void {
  const destination = join(root, relativePath);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

function fixture(pages: Page[]): string {
  const root = mkdtempSync(join(tmpdir(), 'pdks-sync-docs-'));
  roots.push(root);
  const copiedScript = join(root, 'packages/documentation/scripts/sync-docs.mjs');
  mkdirSync(dirname(copiedScript), { recursive: true });
  copyFileSync(script, copiedScript);
  write(
    root,
    'docs/catalog.json',
    JSON.stringify({
      schemaVersion: 1,
      documents: pages.map((page, index) => ({
        id: `page-${index}`,
        category: page.category ?? 'reference',
        order: page.order ?? index,
        bundled: true,
        en: { path: page.path, title: `Page ${index}`, summary: 'English summary.' },
        ko: {
          path: page.path.replace(/\.md$/, '.ko.md'),
          title: `문서 ${index}`,
          summary: '한국어 요약.',
        },
      })),
      topics: {},
      redirects: [],
    }),
  );
  for (const page of pages) {
    write(root, join('docs', page.path), page.en);
    write(root, join('docs', page.path.replace(/\.md$/, '.ko.md')), page.ko);
  }
  return root;
}

function sync(root: string): void {
  const result = spawnSync(
    process.execPath,
    [join(root, 'packages/documentation/scripts/sync-docs.mjs')],
    { cwd: tmpdir(), encoding: 'utf8', timeout: 15_000 },
  );
  expect(result.status, result.stderr).toBe(0);
}

function generated(root: string, locale: 'en' | 'ko', relativePath: string): string {
  return readFileSync(
    join(
      root,
      'packages/documentation/src/content/docs',
      locale === 'en' ? 'docs' : 'ko/docs',
      relativePath,
    ),
    'utf8',
  );
}

function sidebar(root: string): unknown {
  return JSON.parse(
    readFileSync(join(root, 'packages/documentation/src/generated/sidebar.json'), 'utf8'),
  );
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('documentation site sync', () => {
  it('removes only the title H1 with or without a leading comment', () => {
    // An anchored first-line match misses comments; a global H1 match destroys body examples.
    const body = [
      '# Document title',
      '',
      'Opening prose stays.',
      '',
      '## Body section',
      '',
      '# A body heading',
      '',
      '```markdown',
      '# A code sample heading',
      '```',
      '',
    ].join('\n');
    const root = fixture([
      { path: 'guide.md', en: body, ko: `\n  \n<!--\nEditorial metadata.\n-->\n\n${body}` },
    ]);
    sync(root);
    for (const locale of ['en', 'ko'] as const) {
      const markdown = generated(root, locale, 'guide.md');
      expect(markdown).not.toContain('# Document title');
      expect(markdown).toContain(body.slice(body.indexOf('Opening prose stays.')));
    }
  });

  it('removes all three repository language switch forms before rewriting their links', () => {
    // Rewriting .md links first makes the switch line unrecognizable to its remover.
    const root = fixture([
      {
        path: 'english-first.md',
        en: '# Title\n\n**English** · [한국어](./english-first.ko.md)\n\nPage body.\n',
        ko: '# 제목\n\n[English](./english-first.md) · **한국어**\n\nPage body.\n',
      },
      {
        path: 'korean-first.md',
        en: '# Title\n\n**English** · [한국어](./korean-first.ko.md)\n\nPage body.\n',
        ko: '# 제목\n\n**한국어** · [English](./korean-first.md)\n\nPage body.\n',
      },
    ]);
    sync(root);
    for (const relativePath of ['english-first.md', 'korean-first.md']) {
      for (const locale of ['en', 'ko'] as const) {
        const markdown = generated(root, locale, relativePath);
        expect(markdown).not.toContain('**English**');
        expect(markdown).not.toContain('**한국어**');
        expect(markdown).toContain('Page body.');
      }
    }
  });

  it('preserves body language links, target locales, fragments, and dotted version slugs', () => {
    // Caller-locale routing silently turns a body translation link into a link to the same language.
    const body = [
      '# Title',
      '',
      'Read [한국어](../releases/v0.6.1.ko.md#details) and [English](../releases/v0.6.1.md#details).',
      '',
      '[English](../releases/v0.6.1.md#details) explains the release in detail.',
      '',
      'See [repository](../../README.md#development), [local](#local), and [external](https://example.com/reference.md#part).',
      '',
      '<a id="local"></a>',
      '## Local section',
      '',
    ].join('\n');
    const root = fixture([
      { path: 'guides/guide.md', en: body, ko: body },
      {
        path: 'releases/v0.6.1.md',
        en: '# Release\n\n<a id="details"></a>\n## Details\n',
        ko: '# 릴리스\n\n<a id="details"></a>\n## 세부 내용\n',
      },
    ]);
    write(root, 'README.md', '# Project\n\n## Development\n');
    sync(root);
    for (const locale of ['en', 'ko'] as const) {
      const markdown = generated(root, locale, 'guides/guide.md');
      expect(markdown).toContain(
        '[English](/docs/releases/v0.6.1/#details) explains the release in detail.',
      );
      expect(markdown).toContain(
        'Read [한국어](/ko/docs/releases/v0.6.1/#details) and [English](/docs/releases/v0.6.1/#details).',
      );
      expect(markdown).toContain(
        '[repository](https://github.com/huskyhoochu/polydeukes/blob/main/README.md#development)',
      );
      expect(markdown).toContain('[local](#local)');
      expect(markdown).toContain('[external](https://example.com/reference.md#part)');
      expect(generated(root, locale, 'releases/v0.6.1.md')).toContain(
        `slug: "${locale === 'ko' ? 'ko/' : ''}docs/releases/v0.6.1"`,
      );
    }
  });

  it('groups reference commands and packages at their first ordered member while retaining other links', () => {
    // Interleaved members catch fixed group ordering, duplicate links, and lost direct reference pages.
    const pages = [
      { path: 'reference/packages/sdk-ts.md', order: 70 },
      { path: 'reference/cli/explain.md', order: 40 },
      { path: 'reference/configuration/index.md', order: 10 },
      { path: 'reference/declaration-language/index.md', order: 35 },
      { path: 'reference/cli/covenant-check.md', order: 30 },
      { path: 'reference/packages/core.md', order: 20 },
      { path: 'reference/other.md', order: 60 },
      { path: 'how-to/configure-project.md', order: 80, category: 'how-to' },
      { path: 'how-to/get-started.md', order: 5, category: 'how-to' },
    ];
    const root = fixture(
      pages.map((page) => ({ ...page, en: '# Title\n\nBody.\n', ko: '# 제목\n\n본문.\n' })),
    );
    sync(root);
    const item = (index: number, link: string) => ({
      label: `Page ${index}`,
      translations: { ko: `문서 ${index}` },
      link,
    });

    expect.soft(sidebar(root)).toEqual([
      {
        label: 'How-to guides',
        translations: { ko: '실행 안내' },
        items: [item(8, '/docs/how-to/get-started/'), item(7, '/docs/how-to/configure-project/')],
      },
      {
        label: 'Reference',
        translations: { ko: '참조' },
        items: [
          item(2, '/docs/reference/configuration/'),
          {
            label: 'Packages',
            translations: { ko: '패키지' },
            items: [
              item(5, '/docs/reference/packages/core/'),
              item(0, '/docs/reference/packages/sdk-ts/'),
            ],
          },
          {
            label: 'CLI commands',
            translations: { ko: 'CLI 명령어' },
            items: [
              item(4, '/docs/reference/cli/covenant-check/'),
              item(1, '/docs/reference/cli/explain/'),
            ],
          },
          item(3, '/docs/reference/declaration-language/'),
          item(6, '/docs/reference/other/'),
        ],
      },
    ]);

    const singlePageCases = [
      {
        path: 'reference/cli/explain.md',
        items: [
          {
            label: 'CLI commands',
            translations: { ko: 'CLI 명령어' },
            items: [item(0, '/docs/reference/cli/explain/')],
          },
        ],
      },
      {
        path: 'reference/packages/core.md',
        items: [
          {
            label: 'Packages',
            translations: { ko: '패키지' },
            items: [item(0, '/docs/reference/packages/core/')],
          },
        ],
      },
      {
        path: 'reference/configuration/index.md',
        items: [item(0, '/docs/reference/configuration/')],
      },
    ];
    for (const singlePage of singlePageCases) {
      const singleRoot = fixture([
        { path: singlePage.path, en: '# Title\n\nBody.\n', ko: '# 제목\n\n본문.\n' },
      ]);
      sync(singleRoot);
      expect.soft(sidebar(singleRoot), singlePage.path).toEqual([
        {
          label: 'Reference',
          translations: { ko: '참조' },
          items: singlePage.items,
        },
      ]);
    }
  });
});
