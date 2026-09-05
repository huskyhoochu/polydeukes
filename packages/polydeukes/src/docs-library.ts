import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { buildDocs as buildDocsImpl, loadDocsBundle } from './docs-catalog.ts';
import { type DocsLanguage, type LoadedDocsDocument, DOCS_TOPICS as topics } from './docs-types.ts';

/** Inputs for one query against the installed documentation bundle. */
export type RunDocsSpec = {
  docsRoot: string;
  args: string[];
  version: string;
};

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
  schemaVersion: 1;
  packageVersion: string;
  language: DocsLanguage;
  query: string;
  count: number;
  results: SearchResult[];
};

type ShowJson = {
  schemaVersion: 1;
  packageVersion: string;
  language: DocsLanguage;
  documentId: string;
  sectionId: string | null;
  source: string;
  markdown: string;
};

/** Complete stdout, returned only after validation and reading succeed. */
export type RunDocsOutcome = { text: string };

const rootHelp = `pdks docs\nUsage: pdks docs [topic]\n       pdks docs search <query> [--lang en|ko] [--limit N] [--json]\n       pdks docs show <document-id> [--lang en|ko] [--section <section-id>] [--json]\n\nTopics:\n${topics.map((topic) => `  ${topic}`).join('\n')}\n`;

function fail(message: string): never {
  throw new Error(message);
}

function isDocumentId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function isSectionId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(value);
}

function quoteShellWord(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'"'"'`)}'`;
}

function shellCommand(parts: string[]): string {
  return parts.map(quoteShellWord).join(' ');
}

function languageFrom(value: string | undefined): DocsLanguage {
  if (value === 'en' || value === 'ko') return value;
  fail(`unsupported language: ${value ?? '(missing)'}`);
}

function sectionSource(path: string, sectionId?: string): string {
  return sectionId ? `${path}#${sectionId}` : path;
}

function normalizeQuery(value: string): string {
  const query = value.trim();
  if (query === '') fail('empty search query');
  return query;
}

function excerptFor(markdown: string, query: string): string {
  const needle = query.toLowerCase();
  const haystack = markdown.toLowerCase();
  const at = haystack.indexOf(needle);
  if (at === -1) return markdown.slice(0, 160);
  const start = Math.max(0, at - 40);
  const end = Math.min(markdown.length, at + query.length + 80);
  return markdown.slice(start, end);
}

function scoreField(field: string, query: string, weight: number): number {
  const lowerField = field.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (!lowerField.includes(lowerQuery)) return 0;
  if (lowerField === lowerQuery) return weight * 4;
  if (lowerField.startsWith(lowerQuery) || lowerField.endsWith(lowerQuery)) return weight * 3;
  return weight * 2;
}

function sectionScore(
  document: LoadedDocsDocument,
  language: DocsLanguage,
  sectionMarkdown: string,
  query: string,
  sectionTitle: string,
): number {
  const translation = document.translations[language];
  const tokens = [...new Set(query.normalize('NFC').toLowerCase().split(/\s+/u))];
  let score = 0;
  for (const token of tokens) {
    const tokenScore =
      scoreField(sectionTitle, token, 100) +
      scoreField(translation.title, token, 30) +
      scoreField(translation.summary, token, 20) +
      scoreField((translation.terms ?? []).join(' '), token, 15) +
      scoreField(sectionMarkdown, token, 10);
    if (tokenScore === 0) return 0;
    score += tokenScore;
  }
  return score;
}

function sectionFromDocument(
  document: LoadedDocsDocument,
  language: DocsLanguage,
  sectionId: string | null,
): { markdown: string; source: string; title: string } {
  const translation = document.translations[language];
  if (sectionId === null) {
    return { markdown: translation.markdown, source: translation.path, title: translation.title };
  }
  const section = translation.sections.find((entry) => entry.id === sectionId);
  if (!section) fail(`unknown section: ${sectionId}`);
  return {
    markdown: section.text,
    source: sectionSource(translation.path, section.id),
    title: section.title,
  };
}

function parseSearchArgs(args: string[]): {
  query: string;
  language: DocsLanguage;
  limit: number;
  json: boolean;
} {
  if (args.length === 0) fail('missing search query');
  const query = normalizeQuery(args[0]);
  let language: DocsLanguage = 'en';
  let limit = 5;
  let json = false;
  let seenLang = false;
  let seenLimit = false;
  let seenJson = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--lang') {
      if (seenLang) fail('duplicate --lang');
      seenLang = true;
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) fail('missing --lang value');
      language = languageFrom(value);
      index += 1;
      continue;
    }
    if (arg === '--limit') {
      if (seenLimit) fail('duplicate --limit');
      seenLimit = true;
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) fail('missing --limit value');
      if (!/^[1-9]\d*$/.test(value)) fail(`invalid limit: ${value}`);
      const parsed = Number(value);
      if (parsed < 1 || parsed > 50) fail(`invalid limit: ${value}`);
      limit = parsed;
      index += 1;
      continue;
    }
    if (arg === '--json') {
      if (seenJson) fail('duplicate --json');
      seenJson = true;
      json = true;
      continue;
    }
    if (arg.startsWith('--')) fail(`unknown search flag: ${arg}`);
    fail(`unexpected search argument: ${arg}`);
  }
  return { query, language, limit, json };
}

function parseShowArgs(args: string[]): {
  documentId: string;
  language: DocsLanguage;
  sectionId: string | null;
  json: boolean;
} {
  if (args.length === 0) fail('missing document id');
  const documentId = args[0];
  if (!isDocumentId(documentId)) fail(`invalid document id: ${documentId}`);
  let language: DocsLanguage = 'en';
  let sectionId: string | null = null;
  let json = false;
  let seenLang = false;
  let seenSection = false;
  let seenJson = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--lang') {
      if (seenLang) fail('duplicate --lang');
      seenLang = true;
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) fail('missing --lang value');
      language = languageFrom(value);
      index += 1;
      continue;
    }
    if (arg === '--section') {
      if (seenSection) fail('duplicate --section');
      seenSection = true;
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) fail('missing --section value');
      if (!isSectionId(value)) fail(`invalid section id: ${value}`);
      sectionId = value;
      index += 1;
      continue;
    }
    if (arg === '--json') {
      if (seenJson) fail('duplicate --json');
      seenJson = true;
      json = true;
      continue;
    }
    if (arg.startsWith('--')) fail(`unknown show flag: ${arg}`);
    fail(`unexpected show argument: ${arg}`);
  }
  return { documentId, language, sectionId, json };
}

function parseTopicArgs(args: string[]): { topic: string; language: DocsLanguage } {
  if (args.length === 0) fail('missing docs topic');
  const topic = args[0];
  if (!topics.includes(topic as (typeof topics)[number])) fail(`unknown docs topic: ${topic}`);
  let language: DocsLanguage = 'en';
  let seenLang = false;
  for (let index = 1; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--lang') {
      if (seenLang) fail('duplicate --lang');
      seenLang = true;
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) fail('missing --lang value');
      language = languageFrom(value);
      index += 1;
      continue;
    }
    if (arg.startsWith('--')) fail(`unknown docs flag: ${arg}`);
    fail(`unexpected docs argument: ${arg}`);
  }
  return { topic, language };
}

function loadBundleRoot(docsRoot: string) {
  if (!existsSync(join(docsRoot, 'catalog.json')) || !existsSync(join(docsRoot, 'index.json'))) {
    fail('missing docs bundle');
  }
  return loadDocsBundle(docsRoot);
}

function searchBundle(
  bundleRoot: string,
  query: string,
  language: DocsLanguage,
  limit: number,
  version: string,
): SearchJson {
  const bundle = loadBundleRoot(bundleRoot);
  const results: SearchResult[] = [];
  for (const document of bundle.documents.values()) {
    if (!document.bundled) continue;
    const translation = document.translations[language];
    for (const section of translation.sections) {
      const markdown = section.text;
      const score = sectionScore(document, language, markdown, query, section.title);
      if (score <= 0) continue;
      results.push({
        documentId: document.id,
        sectionId: section.id,
        title: section.title,
        excerpt: excerptFor(markdown, query),
        source: sectionSource(translation.path, section.id),
        command: shellCommand([
          'pdks',
          'docs',
          'show',
          document.id,
          '--lang',
          language,
          '--section',
          section.id,
        ]),
        score,
      });
    }
  }
  results.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (left.documentId !== right.documentId) return left.documentId < right.documentId ? -1 : 1;
    return left.sectionId < right.sectionId ? -1 : left.sectionId > right.sectionId ? 1 : 0;
  });
  return {
    schemaVersion: 1,
    packageVersion: version,
    language,
    query,
    count: Math.min(results.length, limit),
    results: results.slice(0, limit),
  };
}

function renderSearchResultText(search: SearchJson): string {
  if (search.results.length === 0) {
    return `0 results for ${search.query}\n[]\n`;
  }
  const lines = [
    `${search.count} results for ${search.query} (${search.language})`,
    ...search.results.map((result, index) =>
      [
        `${index + 1}. ${result.documentId}#${result.sectionId} ${result.title} [${result.score}]`,
        `   ${result.excerpt}`,
        `   ${result.source}`,
        `   ${result.command}`,
      ].join('\n'),
    ),
  ];
  return `${lines.join('\n\n')}\n`;
}

function renderTopic(bundleRoot: string, topic: string, language: DocsLanguage): string {
  const bundle = loadBundleRoot(bundleRoot);
  const entry = bundle.topics[topic];
  if (!entry) fail(`unknown docs topic: ${topic}`);
  const parts: string[] = [];
  for (const reference of entry.references) {
    const document = bundle.documents.get(reference.documentId);
    if (!document) fail(`unknown topic document: ${reference.documentId}`);
    const section = sectionFromDocument(document, language, reference.sectionId ?? null);
    parts.push(section.markdown);
  }
  parts.push(
    `See also: ${shellCommand(['pdks', 'docs', 'show', entry.seeAlso, '--lang', language])}`,
  );
  return `${parts.join('\n\n')}\n`;
}

/** Source catalog and destination for a reproducible documentation build. */
export type BuildDocsSpec = { sourceRoot: string; outputRoot: string; catalogPath?: string };
/** Documents and sections included in a successful bundle. */
export type BuildDocsOutcome = ReturnType<typeof buildDocsImpl>;

/** Validate the source collection and replace the bundle, removing retired files. */
export function buildDocs(spec: BuildDocsSpec): BuildDocsOutcome {
  return buildDocsImpl(spec);
}

/** Answer a docs-only command without loading project configuration or the judge. */
export function runDocs(spec: RunDocsSpec): RunDocsOutcome {
  const args = spec.args;
  if (args.length === 0) return { text: rootHelp };
  if (args.length === 1 && args[0] === '--help') return { text: rootHelp };
  if (args[0] === 'search') {
    if (args.length === 2 && args[1] === '--help') return { text: rootHelp };
    const { query, language, limit, json } = parseSearchArgs(args.slice(1));
    const search = searchBundle(spec.docsRoot, query, language, limit, spec.version);
    return { text: json ? `${JSON.stringify(search)}\n` : renderSearchResultText(search) };
  }
  if (args[0] === 'show') {
    if (args.length === 2 && args[1] === '--help') return { text: rootHelp };
    const { documentId, language, sectionId, json } = parseShowArgs(args.slice(1));
    const bundle = loadBundleRoot(spec.docsRoot);
    const document = bundle.documents.get(documentId);
    if (!document) fail(`unknown document: ${documentId}`);
    const section = sectionFromDocument(document, language, sectionId);
    if (json) {
      const payload: ShowJson = {
        schemaVersion: 1,
        packageVersion: spec.version,
        language,
        documentId,
        sectionId,
        source: section.source,
        markdown: section.markdown,
      };
      return { text: `${JSON.stringify(payload)}\n` };
    }
    return { text: section.markdown };
  }
  if (topics.includes(args[0] as (typeof topics)[number])) {
    const { topic, language } = parseTopicArgs(args);
    return { text: renderTopic(spec.docsRoot, topic, language) };
  }
  fail(`unknown docs command: ${args[0]}`);
}
