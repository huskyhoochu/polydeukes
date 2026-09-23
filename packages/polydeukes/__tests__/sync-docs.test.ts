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
        category: 'reference',
        order: index,
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
});
