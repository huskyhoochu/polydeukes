import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDocs, runDocs } from '../src/docs-library.ts';

const version = '0.6.1-test';
const topics = ['install', 'config', 'discipline', 'covenant', 'witness'] as const;
type Translation = { path: string; title: string; summary: string; terms?: string[] };
type Document = {
  id: string;
  category: string;
  order: number;
  bundled: boolean;
  en: Translation;
  ko?: Translation;
};
type Catalog = {
  schemaVersion: number;
  documents: Document[];
  topics: Record<
    string,
    {
      references: { documentId: string; sectionId?: string }[];
      seeAlso: string;
    }
  >;
  redirects: { path: string; target: string }[];
};
type Fixture = { root: string; sourceRoot: string; outputRoot: string; catalog: Catalog };
type SearchResult = {
  documentId: string;
  sectionId: string;
  title: string;
  excerpt: string;
  source: string;
  command: string;
  score: number;
};
type SearchJson = {
  schemaVersion: number;
  packageVersion: string;
  language: string;
  query: string;
  count: number;
  results: SearchResult[];
};

const roots: string[] = [];
const anchor = (id: string) => `<a id="${id}"></a>\n`;
const section = (id: string, title: string, body: string, level = 2) =>
  `${anchor(id)}${'#'.repeat(level)} ${title}\n\n${body}\n\n`;
const englishInstall = section(
  'install',
  'Install',
  'englishneedle: keep  **two spaces**.\nSecond line.',
);
const koreanInstall = section('install', '설치', '한국어전용 설치 설명입니다.\n둘째 줄입니다.');
const english =
  '# Manual\n\n' +
  englishInstall +
  section('config', 'Configuration', 'Inspect --worktree before continuing.') +
  section('discipline', 'Discipline', 'Declare a practice.') +
  section('covenant', 'Covenant', 'Read the judgment.') +
  section('witness', 'Witness', 'Supply a token.');
const korean =
  '# 안내서\n\n' +
  koreanInstall +
  section('config', '설정', '작업 트리를 검사합니다.') +
  section('discipline', '규율', '규율을 선언합니다.') +
  section('covenant', '약속', '판정 결과를 읽습니다.') +
  section('witness', '증인', '토큰을 제공합니다.');

function write(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function document(id: string, stem: string): Document {
  return {
    id,
    category: 'reference',
    order: 1,
    bundled: true,
    en: { path: `${stem}.md`, title: 'Manual', summary: 'A small reference.' },
    ko: { path: `${stem}.ko.md`, title: '안내서', summary: '짧은 참고 문서입니다.' },
  };
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'polydeukes-docs-'));
  roots.push(root);
  const value: Fixture = {
    root,
    sourceRoot: join(root, 'source'),
    outputRoot: join(root, 'bundle'),
    catalog: {
      schemaVersion: 1,
      documents: [document('alpha', 'manual')],
      topics: Object.fromEntries(
        topics.map((name) => [
          name,
          {
            references: [{ documentId: 'alpha', sectionId: name }],
            seeAlso: 'alpha',
          },
        ]),
      ),
      redirects: [],
    },
  };
  write(join(value.sourceRoot, 'manual.md'), english);
  write(join(value.sourceRoot, 'manual.ko.md'), korean);
  return value;
}

async function build(value: Fixture) {
  write(join(value.sourceRoot, 'catalog.json'), JSON.stringify(value.catalog));
  return await buildDocs({ sourceRoot: value.sourceRoot, outputRoot: value.outputRoot });
}

async function run(value: Fixture, args: string[]) {
  return await runDocs({ docsRoot: value.outputRoot, args, version });
}

async function search(value: Fixture, args: string[]): Promise<SearchJson> {
  return JSON.parse((await run(value, ['search', ...args, '--json'])).text);
}

function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  function visit(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else files[relative(root, path)] = readFileSync(path).toString('base64');
    }
  }
  visit(root);
  return files;
}

function bundledFile(value: Fixture, contents: string): string {
  const bytes = Buffer.from(contents).toString('base64');
  const matches = Object.entries(snapshot(value.outputRoot)).filter(([, body]) => body === bytes);
  expect(matches).toHaveLength(1);
  return join(value.outputRoot, matches[0][0]);
}

async function rejectArgs(value: Fixture, cases: string[][]) {
  for (const args of cases) {
    await expect(
      Promise.resolve().then(() => run(value, args)),
      JSON.stringify(args),
    ).rejects.toThrow();
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('documentation bundle validation', () => {
  it('builds a bilingual catalog and serves its raw Markdown', async () => {
    const value = fixture();
    const outcome = await build(value);
    expect(outcome).toHaveProperty('documents');
    expect(outcome).toHaveProperty('sections');
    expect((await run(value, ['show', 'alpha'])).text).toBe(english);
    expect((await run(value, ['show', 'alpha', '--lang', 'ko'])).text).toBe(korean);
  });

  it('rejects duplicate document IDs and duplicate section IDs', async () => {
    const duplicateDocument = fixture();
    duplicateDocument.catalog.documents.push(document('alpha', 'other'));
    write(join(duplicateDocument.sourceRoot, 'other.md'), english);
    write(join(duplicateDocument.sourceRoot, 'other.ko.md'), korean);
    await expect(build(duplicateDocument)).rejects.toThrow();
    const duplicateSection = fixture();
    write(join(duplicateSection.sourceRoot, 'manual.md'), english + englishInstall);
    write(join(duplicateSection.sourceRoot, 'manual.ko.md'), korean + koreanInstall);
    await expect(build(duplicateSection)).rejects.toThrow();
  });

  it('rejects missing language metadata and missing translated source files', async () => {
    for (const language of ['en', 'ko'] as const) {
      const metadata = fixture();
      Reflect.deleteProperty(metadata.catalog.documents[0], language);
      await expect(build(metadata)).rejects.toThrow();
      const missing = fixture();
      rmSync(join(missing.sourceRoot, language === 'en' ? 'manual.md' : 'manual.ko.md'));
      await expect(build(missing)).rejects.toThrow();
    }
  });

  it('requires the same section IDs in both languages, not merely the same count', async () => {
    const value = fixture();
    write(join(value.sourceRoot, 'manual.ko.md'), korean.replace('id="install"', 'id="different"'));
    await expect(build(value)).rejects.toThrow();
  });

  it('rejects escaping source paths and path-shaped document IDs', async () => {
    for (const path of ['../outside.md', '/tmp/outside.md']) {
      const value = fixture();
      write(join(value.root, 'outside.md'), english);
      value.catalog.documents[0].en.path =
        path === '/tmp/outside.md' ? join(value.root, 'outside.md') : path;
      await expect(build(value)).rejects.toThrow();
    }
    const value = fixture();
    value.catalog.documents[0].id = '../alpha';
    for (const topic of Object.values(value.catalog.topics)) {
      topic.references[0].documentId = '../alpha';
      topic.seeAlso = '../alpha';
    }
    await expect(build(value)).rejects.toThrow();
  });

  it('removes deleted documents from both copied files and the rebuilt search index', async () => {
    const value = fixture();
    value.catalog.documents.push(document('zeta', 'other'));
    const removedEn = english.replace('englishneedle', 'retiredneedle');
    const removedKo = korean.replace('한국어전용', '제거된문서');
    write(join(value.sourceRoot, 'other.md'), removedEn);
    write(join(value.sourceRoot, 'other.ko.md'), removedKo);
    await build(value);
    const stalePaths = [bundledFile(value, removedEn), bundledFile(value, removedKo)];
    expect((await search(value, ['retiredneedle'])).count).toBeGreaterThan(0);
    value.catalog.documents.pop();
    rmSync(join(value.sourceRoot, 'other.md'));
    rmSync(join(value.sourceRoot, 'other.ko.md'));
    await build(value);
    const files = snapshot(value.outputRoot);
    for (const path of stalePaths)
      expect(Object.keys(files)).not.toContain(relative(value.outputRoot, path));
    expect((await search(value, ['retiredneedle'])).results).toEqual([]);
    await rejectArgs(value, [['show', 'zeta']]);
  });

  it('excludes public essays and relocation notices from both bundle and search', async () => {
    const value = fixture();
    value.catalog.documents.push({ ...document('essay', 'essay'), bundled: false });
    write(join(value.sourceRoot, 'essay.md'), english.replace('englishneedle', 'essayneedle'));
    write(join(value.sourceRoot, 'essay.ko.md'), korean);
    value.catalog.redirects.push({ path: 'old.md', target: 'manual.md' });
    write(join(value.sourceRoot, 'old.md'), '# Moved\n\nrelocationneedle [Manual](manual.md)\n');
    await build(value);
    expect(Object.keys(snapshot(value.outputRoot))).not.toContain('essay.md');
    expect(Object.keys(snapshot(value.outputRoot))).not.toContain('old.md');
    expect((await search(value, ['essayneedle'])).results).toEqual([]);
    expect((await search(value, ['relocationneedle'])).results).toEqual([]);
    await rejectArgs(value, [['show', 'essay']]);
  });

  it('rejects unregistered source documents and headings without stable anchors', async () => {
    const unregistered = fixture();
    write(join(unregistered.sourceRoot, 'forgotten.md'), '# Forgotten\n');
    await expect(build(unregistered)).rejects.toThrow();
    const unanchored = fixture();
    write(join(unanchored.sourceRoot, 'manual.md'), english.replace(anchor('install'), ''));
    await expect(build(unanchored)).rejects.toThrow();
  });

  it('produces identical bundle bytes across rebuilds and different absolute roots', async () => {
    const left = fixture();
    const right = fixture();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
      await build(left);
      const initial = snapshot(left.outputRoot);
      vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
      await build(left);
      await build(right);
      expect(snapshot(left.outputRoot)).toEqual(initial);
      expect(snapshot(right.outputRoot)).toEqual(initial);
      expect(Object.keys(initial).some((path) => path.endsWith('.json'))).toBe(true);
      for (const body of Object.values(initial)) {
        const text = Buffer.from(body, 'base64').toString();
        expect(text).not.toContain(left.root);
        expect(text).not.toContain(right.root);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('documentation retrieval', () => {
  it('returns exact full and section Markdown with complete JSON identity metadata', async () => {
    const value = fixture();
    await build(value);
    for (const [language, markdown, part, source] of [
      ['en', english, englishInstall, 'manual.md'],
      ['ko', korean, koreanInstall, 'manual.ko.md'],
    ] as const) {
      for (const sectionId of [null, 'install'] as const) {
        const args = ['show', 'alpha', '--lang', language];
        if (sectionId) args.push('--section', sectionId);
        const expected = sectionId ? part : markdown;
        expect((await run(value, args)).text).toBe(expected);
        expect(JSON.parse((await run(value, [...args, '--json'])).text)).toEqual({
          schemaVersion: 1,
          packageVersion: version,
          language,
          documentId: 'alpha',
          sectionId,
          source: source + (sectionId ? `#${sectionId}` : ''),
          markdown: expected,
        });
      }
    }
  });

  it('ignores headings and apparent anchors inside backtick and tilde fences', async () => {
    const value = fixture();
    const fenced = section(
      'install',
      'Install',
      [
        'Before.',
        '````markdown',
        '# Not a boundary',
        '<a id="phantom"></a>',
        '## Not a section',
        '```',
        '## Still in the longer fence',
        '````',
        '~~~markdown',
        '## Also not a boundary',
        '~~~',
        'After.',
      ].join('\n'),
    );
    for (const [path, body, original] of [
      ['manual.md', english, englishInstall],
      ['manual.ko.md', korean, koreanInstall],
    ])
      write(join(value.sourceRoot, path), body.replace(original, fenced));
    await build(value);
    expect((await run(value, ['show', 'alpha', '--section', 'install'])).text).toBe(fenced);
    await rejectArgs(value, [['show', 'alpha', '--section', 'phantom']]);
  });

  it('includes nested sections but stops before sibling or higher headings and their anchors', async () => {
    const value = fixture();
    const child = section('child', 'Child', 'Child body.', 3);
    const sibling = section('sibling', 'Sibling', 'Sibling body.', 3);
    const parent = section('install', 'Install', 'Parent body.') + child + sibling;
    write(join(value.sourceRoot, 'manual.md'), english.replace(englishInstall, parent));
    write(join(value.sourceRoot, 'manual.ko.md'), korean.replace(koreanInstall, parent));
    await build(value);
    for (const [id, expected] of [
      ['install', parent],
      ['child', child],
      ['sibling', sibling],
    ]) {
      expect((await run(value, ['show', 'alpha', '--section', id])).text).toBe(expected);
    }
  });

  it('keeps section lookup stable when visible headings change', async () => {
    const value = fixture();
    await build(value);
    const renamed = englishInstall.replace('## Install', '## A completely different heading');
    write(join(value.sourceRoot, 'manual.md'), english.replace(englishInstall, renamed));
    await build(value);
    expect((await run(value, ['show', 'alpha', '--section', 'install'])).text).toBe(renamed);
    expect((await search(value, ['englishneedle'])).results[0].sectionId).toBe('install');
  });

  it('resolves all five legacy topics through the catalog in both languages', async () => {
    const value = fixture();
    // Rotating destinations distinguishes catalog routing from a hard-coded topic table.
    topics.forEach((topic, index) => {
      value.catalog.topics[topic].references[0].sectionId = topics[(index + 1) % topics.length];
    });
    await build(value);
    for (const language of ['en', 'ko'] as const) {
      for (const topic of topics) {
        const id = value.catalog.topics[topic].references[0].sectionId as string;
        const raw = (await run(value, ['show', 'alpha', '--section', id, '--lang', language])).text;
        const text = (await run(value, [topic, '--lang', language])).text;
        expect(text).toContain(raw);
        for (const other of topics.filter((candidate) => candidate !== id)) {
          const unselected = (
            await run(value, ['show', 'alpha', '--section', other, '--lang', language])
          ).text;
          expect(text).not.toContain(unselected);
        }
      }
    }
  });

  it('preserves the order of multiple topic references and gives a usable see-also command', async () => {
    const value = fixture();
    value.catalog.topics.witness.references = [
      { documentId: 'alpha', sectionId: 'witness' },
      { documentId: 'alpha', sectionId: 'config' },
    ];
    await build(value);
    const text = (await run(value, ['witness', '--lang', 'ko'])).text;
    const first = (await run(value, ['show', 'alpha', '--lang', 'ko', '--section', 'witness']))
      .text;
    const second = (await run(value, ['show', 'alpha', '--lang', 'ko', '--section', 'config']))
      .text;
    expect(text.indexOf(first)).toBeGreaterThanOrEqual(0);
    expect(text.indexOf(second)).toBeGreaterThan(text.indexOf(first));
    expect(text).toContain('pdks docs show alpha --lang ko');
  });

  it('lists available topics and offers root and subcommand help', async () => {
    const value = fixture();
    await build(value);
    const listing = (await run(value, [])).text;
    for (const topic of topics) expect(listing).toContain(topic);
    for (const args of [['--help'], ['search', '--help'], ['show', '--help']]) {
      expect((await run(value, args)).text).toMatch(/pdks docs/);
    }
  });
});

describe('documentation search', () => {
  it('defaults to English and never silently searches the other language', async () => {
    const value = fixture();
    await build(value);
    const en = await search(value, ['englishneedle']);
    expect(en.language).toBe('en');
    expect(en.results.map((result) => result.sectionId)).toContain('install');
    expect((await search(value, ['한국어전용'])).results).toEqual([]);
    const ko = await search(value, ['한국어전용', '--lang', 'ko']);
    expect(ko.language).toBe('ko');
    expect(ko.results.map((result) => result.sectionId)).toContain('install');
    expect((await search(value, ['englishneedle', '--lang', 'ko'])).results).toEqual([]);
  });

  it('accepts a literal flag-shaped query and retains its punctuation', async () => {
    const value = fixture();
    await build(value);
    const result = await search(value, ['--worktree']);
    expect(result.query).toBe('--worktree');
    expect(result.results[0]).toMatchObject({ documentId: 'alpha', sectionId: 'config' });
    expect(result.results[0].excerpt).toContain('--worktree');
  });

  it('breaks equal-score ties by ASCII document and section IDs and applies result limits', async () => {
    const value = fixture();
    value.catalog.documents.unshift(document('zeta', 'other'));
    const tied =
      '# Manual\n\n' +
      [...topics]
        .reverse()
        .map((id) => section(id, 'Same', 'tieprobe.'))
        .join('');
    for (const stem of ['manual', 'other']) {
      write(join(value.sourceRoot, `${stem}.md`), tied);
      write(join(value.sourceRoot, `${stem}.ko.md`), tied);
    }
    await build(value);
    const result = await search(value, ['tieprobe', '--limit', '50']);
    const expected = ['alpha', 'zeta'].flatMap((id) =>
      [...topics].sort().map((part) => `${id}/${part}`),
    );
    expect(result.results.map((item) => `${item.documentId}/${item.sectionId}`)).toEqual(expected);
    expect(new Set(result.results.map((item) => item.score)).size).toBe(1);
    expect(result.count).toBe(10);
    expect((await search(value, ['tieprobe'])).results).toEqual(result.results.slice(0, 5));
    expect((await search(value, ['tieprobe', '--limit', '1'])).results).toEqual(
      result.results.slice(0, 1),
    );
    expect(await search(value, ['tieprobe', '--limit', '50'])).toEqual(result);
  });

  it('searches localized terms and ranks a title match ahead of a body-only match', async () => {
    const value = fixture();
    value.catalog.documents[0].en.terms = ['terminologyneedle'];
    value.catalog.documents[0].ko!.terms = ['현지화검색어'];
    write(
      join(value.sourceRoot, 'manual.md'),
      english.replace('## Install', '## rankneedle').replace('Declare a practice.', 'rankneedle'),
    );
    await build(value);
    expect((await search(value, ['terminologyneedle'])).count).toBeGreaterThan(0);
    expect((await search(value, ['현지화검색어', '--lang', 'ko'])).count).toBeGreaterThan(0);
    expect((await search(value, ['현지화검색어'])).count).toBe(0);
    expect((await search(value, ['rankneedle'])).results[0].sectionId).toBe('install');
  });

  it('returns an explicit empty result without treating a valid unmatched query as an error', async () => {
    const value = fixture();
    await build(value);
    expect(await search(value, ['unfindablezz'])).toEqual({
      schemaVersion: 1,
      packageVersion: version,
      language: 'en',
      query: 'unfindablezz',
      count: 0,
      results: [],
    });
    expect((await run(value, ['search', 'unfindablezz'])).text).toMatch(
      /no results|0 results|\[\]/i,
    );
  });

  it('emits search metadata, source excerpts and runnable explicit-language retrieval commands', async () => {
    const value = fixture();
    await build(value);
    for (const [language, query, source, raw] of [
      ['en', 'englishneedle', 'manual.md#install', englishInstall],
      ['ko', '한국어전용', 'manual.ko.md#install', koreanInstall],
    ] as const) {
      const result = await search(value, [query, '--lang', language]);
      expect(result).toMatchObject({ schemaVersion: 1, packageVersion: version, language, query });
      expect(result.count).toBe(result.results.length);
      expect(result.count).toBeGreaterThan(0);
      const first = result.results[0];
      expect(first).toEqual({
        documentId: 'alpha',
        sectionId: 'install',
        title: expect.any(String),
        excerpt: expect.any(String),
        source,
        command: expect.any(String),
        score: expect.any(Number),
      });
      expect(first.title.length).toBeGreaterThan(0);
      expect(first.excerpt.length).toBeGreaterThan(0);
      expect(raw).toContain(first.excerpt);
      expect(Number.isFinite(first.score)).toBe(true);
      // These IDs need no escaping; optional quotes still represent the same safe shell words.
      const command = first.command.replace(/'([a-z-]+)'|"([a-z-]+)"/g, '$1$2').split(/\s+/);
      expect(command).toEqual([
        'pdks',
        'docs',
        'show',
        'alpha',
        '--lang',
        language,
        '--section',
        'install',
      ]);
      expect((await run(value, command.slice(2))).text).toBe(raw);
    }
  });
});

describe('catalog and bundle consistency', () => {
  it('does not read source files through a symlink outside the source root', async () => {
    const value = fixture();
    const external = join(value.root, 'external.md');
    write(external, english);
    rmSync(join(value.sourceRoot, 'manual.md'));
    symlinkSync(external, join(value.sourceRoot, 'manual.md'));
    await expect(build(value)).rejects.toThrow();
  });

  it('rejects physically overlapping roots before removing an output directory', async () => {
    const value = fixture();
    await build(value);
    const aliasRoot = mkdtempSync(join(tmpdir(), 'pdks-docs-alias-'));
    roots.push(aliasRoot);
    const alias = join(aliasRoot, 'alias');
    symlinkSync(value.root, alias, 'dir');
    await expect(
      Promise.resolve().then(() =>
        buildDocs({
          sourceRoot: join(alias, 'source'),
          outputRoot: value.root,
        }),
      ),
    ).rejects.toThrow(/overlap/);
    expect(readFileSync(join(value.sourceRoot, 'manual.md'), 'utf8')).toBe(english);
  });

  it('ends a section before a new top-level heading', async () => {
    const value = fixture();
    write(join(value.sourceRoot, 'manual.md'), `${english}\n# Appendix\nOutside the section.\n`);
    write(join(value.sourceRoot, 'manual.ko.md'), `${korean}\n# 부록\n절 밖입니다.\n`);
    await build(value);
    expect((await run(value, ['show', 'alpha', '--section', 'witness'])).text).not.toContain(
      '# Appendix',
    );
  });

  it('rejects topic references to missing sections or excluded documents at build time', async () => {
    for (const damage of ['section', 'excluded', 'see-also']) {
      const value = fixture();
      if (damage === 'section') value.catalog.topics.install.references[0].sectionId = 'absent';
      else {
        const excluded = document('history', 'history');
        excluded.bundled = false;
        value.catalog.documents.push(excluded);
        write(join(value.sourceRoot, 'history.md'), '# History\n');
        write(join(value.sourceRoot, 'history.ko.md'), '# 기록\n');
        if (damage === 'see-also') value.catalog.topics.install.seeAlso = 'history';
        else value.catalog.topics.install.references = [{ documentId: 'history' }];
      }
      await expect(build(value)).rejects.toThrow();
    }
  });

  it('rejects duplicate document paths and a redirect with an absent destination', async () => {
    const duplicate = fixture();
    duplicate.catalog.documents.push(document('beta', 'manual'));
    await expect(build(duplicate)).rejects.toThrow();
    const redirect = fixture();
    redirect.catalog.redirects.push({ path: 'old.md', target: 'absent.md' });
    write(join(redirect.sourceRoot, 'old.md'), '# Moved\n');
    await expect(build(redirect)).rejects.toThrow();
  });

  it('rejects invalid document identifiers and mistyped catalog fields', async () => {
    for (const [key, invalid] of [
      ['id', 'Upper Case'],
      ['bundled', 'true'],
      ['order', '1'],
    ]) {
      const value = fixture();
      Reflect.set(value.catalog.documents[0], key, invalid);
      await expect(build(value)).rejects.toThrow();
    }
  });

  it('rejects structurally valid JSON with an incomplete or inconsistent index', async () => {
    for (const damage of ['documents', 'sections', 'metadata']) {
      const value = fixture();
      await build(value);
      const path = join(value.outputRoot, 'index.json');
      const index = JSON.parse(readFileSync(path, 'utf8'));
      if (damage === 'documents') index.documents = [];
      else if (damage === 'sections') index.sections = [];
      else index.documents[0].translations.en.title = 'False title';
      write(path, JSON.stringify(index));
      await rejectArgs(value, [
        ['search', 'englishneedle'],
        ['show', 'alpha'],
      ]);
    }
  });

  it('matches separate words in one section without requiring an exact phrase', async () => {
    const value = fixture();
    await build(value);
    const answer = await search(value, ['Second englishneedle']);
    expect(answer.results.map((entry) => entry.sectionId)).toEqual(['install']);
    expect((await search(value, ['absentword englishneedle'])).results).toEqual([]);
  });

  it('reports the number of returned results when the limit truncates matches', async () => {
    const value = fixture();
    await build(value);
    const answer = await search(value, ['Manual', '--limit', '1']);
    expect(answer.results).toHaveLength(1);
    expect(answer.count).toBe(1);
  });
});

describe('documentation input and integrity errors', () => {
  it('rejects duplicate flags even when their values agree', async () => {
    const value = fixture();
    await build(value);
    await rejectArgs(value, [
      ['search', 'x', '--json', '--json'],
      ['search', 'x', '--limit', '2', '--limit', '2'],
      ['show', 'alpha', '--lang', 'en', '--lang', 'en'],
      ['show', 'alpha', '--section', 'install', '--section', 'install'],
      ['install', '--lang', 'ko', '--lang', 'ko'],
    ]);
  });

  it('rejects unknown and command-inappropriate flags', async () => {
    const value = fixture();
    await build(value);
    await rejectArgs(value, [
      ['--unknown'],
      ['install', '--json'],
      ['search', 'x', '--unknown'],
      ['search', 'x', '--worktree'],
      ['search', 'x', '--section', 'install'],
      ['show', 'alpha', '--limit', '2'],
      ['show', 'alpha', '--unknown'],
    ]);
  });

  it('rejects missing flag values rather than consuming another flag as the value', async () => {
    const value = fixture();
    await build(value);
    await rejectArgs(value, [
      ['install', '--lang'],
      ['search', 'x', '--limit'],
      ['search', 'x', '--lang'],
      ['show', 'alpha', '--section'],
      ['show', 'alpha', '--lang'],
      ['search', 'x', '--limit', '--json'],
      ['show', 'alpha', '--section', '--json'],
    ]);
  });

  it('rejects positional extras instead of joining them into a query or ignoring them', async () => {
    const value = fixture();
    await build(value);
    await rejectArgs(value, [
      ['install', 'extra'],
      ['show', 'alpha', 'extra'],
      ['search', 'one', 'two'],
    ]);
  });

  it('rejects absent, empty and whitespace-only search queries', async () => {
    const value = fixture();
    await build(value);
    await rejectArgs(value, [['search'], ['search', ''], ['search', ' \t\n ']]);
  });

  it('requires integer limits in the inclusive range one through fifty', async () => {
    const value = fixture();
    await build(value);
    await rejectArgs(
      value,
      ['0', '51', '-1', '1.5', '2x', 'NaN', 'Infinity', ''].map((limit) => [
        'search',
        'englishneedle',
        '--limit',
        limit,
      ]),
    );
  });

  it('rejects unsupported languages on topics, search and show', async () => {
    const value = fixture();
    await build(value);
    await rejectArgs(
      value,
      ['fr', 'EN', ''].flatMap((language) => [
        ['install', '--lang', language],
        ['search', 'x', '--lang', language],
        ['show', 'alpha', '--lang', language],
      ]),
    );
  });

  it('rejects unknown or path-shaped document and section IDs and unknown topics', async () => {
    const value = fixture();
    await build(value);
    await rejectArgs(value, [
      ['unknown-topic'],
      ['show'],
      ['show', 'unknown'],
      ['show', '../manual.md'],
      ['show', join(value.sourceRoot, 'manual.md')],
      ['show', 'alpha', '--section', 'missing'],
      ['show', 'alpha', '--section', '../install'],
      ['show', 'alpha', '--section', ''],
    ]);
  });

  it('rejects missing bundles and missing or malformed bundle metadata', async () => {
    for (const damage of ['directory', 'missing-json', 'corrupt-json']) {
      const value = fixture();
      await build(value);
      if (damage === 'directory') rmSync(value.outputRoot, { recursive: true });
      else {
        const jsonPaths = Object.keys(snapshot(value.outputRoot)).filter((path) =>
          path.endsWith('.json'),
        );
        expect(jsonPaths.length).toBeGreaterThan(0);
        for (const path of jsonPaths) {
          if (damage === 'missing-json') rmSync(join(value.outputRoot, path));
          else write(join(value.outputRoot, path), '{not valid JSON');
        }
      }
      await rejectArgs(value, [
        ['search', 'englishneedle'],
        ['show', 'alpha'],
      ]);
    }
  });

  it('rejects missing raw Markdown during search and show instead of serving cached results', async () => {
    const value = fixture();
    await build(value);
    rmSync(bundledFile(value, english));
    await rejectArgs(value, [
      ['search', 'englishneedle', '--json'],
      ['show', 'alpha', '--json'],
    ]);
  });

  it('rejects parseable but tampered Markdown through its integrity hash', async () => {
    const value = fixture();
    await build(value);
    // Same-length valid Markdown defeats existence-only, parser-only and size-only checks.
    write(bundledFile(value, english), english.replace('englishneedle', 'changedneedle'));
    await rejectArgs(value, [
      ['search', 'englishneedle', '--json'],
      ['show', 'alpha', '--section', 'install'],
    ]);
  });
});
