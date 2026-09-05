import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { hashMarkdown, parseSections } from './docs-markdown.ts';
import type {
  DocsBundleDocument,
  DocsBundleSection,
  DocsCatalog,
  DocsDocument,
  DocsIndex,
  DocsLanguage,
  LoadedDocsBundle,
  LoadedDocsDocument,
} from './docs-types.ts';

const catalogSchemaVersion = 1;
const supportedLanguages: DocsLanguage[] = ['en', 'ko'];
const markdownPattern = /\.md$/i;

function fail(message: string): never {
  throw new Error(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertString(value: unknown, message: string): string {
  if (typeof value !== 'string' || value === '') fail(message);
  return value;
}

function assertOptionalTerms(value: unknown, message: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry === '')) {
    fail(message);
  }
  return value;
}

function assertTranslation(
  value: unknown,
  label: string,
): { path: string; title: string; summary: string; terms?: string[] } {
  if (!isPlainObject(value)) fail(`invalid ${label} translation`);
  return {
    path: assertString(value.path, `invalid ${label} path`),
    title: assertString(value.title, `invalid ${label} title`),
    summary: assertString(value.summary, `invalid ${label} summary`),
    terms: assertOptionalTerms(value.terms, `invalid ${label} terms`),
  };
}

function assertReference(value: unknown): { documentId: string; sectionId?: string } {
  if (!isPlainObject(value)) fail('invalid topic reference');
  const documentId = assertString(value.documentId, 'invalid topic documentId');
  const sectionId = value.sectionId;
  if (sectionId !== undefined && (typeof sectionId !== 'string' || sectionId === '')) {
    fail('invalid topic sectionId');
  }
  return { documentId, ...(sectionId === undefined ? {} : { sectionId }) };
}

function assertDocument(value: unknown): DocsDocument {
  if (!isPlainObject(value)) fail('invalid document entry');
  if (typeof value.bundled !== 'boolean') fail('invalid bundled flag');
  if (typeof value.order !== 'number') fail('invalid document order');
  const document: DocsDocument = {
    id: assertString(value.id, 'invalid document id'),
    category: assertString(value.category, 'invalid document category'),
    order: Number(value.order),
    bundled: value.bundled === true,
    en: assertTranslation(value.en, 'en'),
  };
  if (!Number.isInteger(document.order)) fail(`invalid order for ${document.id}`);
  if (value.ko !== undefined) document.ko = assertTranslation(value.ko, 'ko');
  return document;
}

function assertCatalog(value: unknown): DocsCatalog {
  if (!isPlainObject(value)) fail('invalid catalog json');
  const schemaVersion = value.schemaVersion;
  if (schemaVersion !== catalogSchemaVersion) fail('unsupported catalog schema version');
  if (!Array.isArray(value.documents)) fail('invalid documents list');
  if (!isPlainObject(value.topics)) fail('invalid topics map');
  const redirects = value.redirects === undefined ? [] : value.redirects;
  if (!Array.isArray(redirects)) fail('invalid redirects list');

  const catalog: DocsCatalog = {
    schemaVersion: catalogSchemaVersion,
    documents: value.documents.map(assertDocument),
    topics: Object.fromEntries(
      Object.entries(value.topics).map(([topicId, topic]) => {
        if (!isPlainObject(topic)) fail(`invalid topic ${topicId}`);
        return [
          topicId,
          {
            references: Array.isArray(topic.references)
              ? topic.references.map(assertReference)
              : fail(`invalid topic references for ${topicId}`),
            seeAlso: assertString(topic.seeAlso, `invalid seeAlso for ${topicId}`),
          },
        ];
      }),
    ),
    redirects: redirects.map((entry) => {
      if (!isPlainObject(entry)) fail('invalid redirect entry');
      return {
        path: assertString(entry.path, 'invalid redirect path'),
        target: assertString(entry.target, 'invalid redirect target'),
      };
    }),
  };

  return catalog;
}

function safeRelativePath(path: string): string {
  if (isAbsolute(path) || path.includes('\\') || /^[A-Za-z]:/.test(path)) {
    fail(`absolute or non-portable path rejected: ${path}`);
  }
  const segments = path.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(`escaping path rejected: ${path}`);
  }
  const normalized = normalize(path).replace(/\\/g, '/');
  if (normalized === '.' || normalized === '') fail('invalid empty path');
  return normalized;
}

function physicalPath(path: string): string {
  const absolute = resolve(path);
  if (existsSync(absolute)) return realpathSync(absolute);
  const parent = dirname(absolute);
  if (parent === absolute) return absolute;
  return join(physicalPath(parent), relative(parent, absolute));
}

function contains(root: string, path: string): boolean {
  const distance = relative(root, path);
  return distance !== '..' && !distance.startsWith(`..${sep}`) && !isAbsolute(distance);
}

function validateDocsRootOverlap(sourceRoot: string, outputRoot: string): void {
  const source = physicalPath(sourceRoot);
  const output = physicalPath(outputRoot);
  if (contains(source, output) || contains(output, source)) fail('source and output roots overlap');
}

function walkMarkdown(root: string): string[] {
  const result: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) stack.push(path);
      else if (markdownPattern.test(entry.name))
        result.push(relative(root, path).replace(/\\/g, '/'));
    }
  }
  return result.sort((left, right) => left.localeCompare(right));
}

function readMarkdown(root: string, path: string): string {
  const absolute = resolve(root, path);
  if (!contains(resolve(root), absolute)) fail(`path escapes source root: ${path}`);
  if (!existsSync(absolute)) fail(`missing source markdown: ${path}`);
  if (!contains(realpathSync(root), realpathSync(absolute)))
    fail(`source symlink escapes root: ${path}`);
  return readFileSync(absolute, 'utf8');
}

function validateDocumentPaths(document: DocsDocument): void {
  for (const [language, translation] of Object.entries({ en: document.en, ko: document.ko })) {
    if (!translation) fail(`missing ${language} translation for ${document.id}`);
    safeRelativePath(translation.path);
    if (
      !translation.path.endsWith(language === 'en' ? '.md' : '.ko.md') ||
      (language === 'en' && translation.path.endsWith('.ko.md'))
    ) {
      fail(`translation path suffix mismatch for ${document.id}:${language}`);
    }
  }
}

function validateDocumentIds(documents: DocsDocument[]): void {
  const ids = new Set<string>();
  for (const document of documents) {
    if (ids.has(document.id)) fail(`duplicate document id: ${document.id}`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(document.id)) {
      fail(`invalid document id: ${document.id}`);
    }
    ids.add(document.id);
  }
}

function validateTopicMap(catalog: DocsCatalog): void {
  for (const [topicId, topic] of Object.entries(catalog.topics)) {
    if (topic.references.length === 0) fail(`empty topic references: ${topicId}`);
    if (typeof topic.seeAlso !== 'string' || topic.seeAlso === '')
      fail(`invalid seeAlso: ${topicId}`);
  }
}

function validateRedirects(catalog: DocsCatalog): void {
  const paths = new Set<string>();
  for (const redirect of catalog.redirects ?? []) {
    safeRelativePath(redirect.path);
    safeRelativePath(redirect.target);
    if (paths.has(redirect.path)) fail(`duplicate redirect path: ${redirect.path}`);
    paths.add(redirect.path);
  }
}

function assertAllSourceMarkdownRegistered(catalog: DocsCatalog, sourceRoot: string): void {
  const registered = new Set<string>();
  const register = (path: string) => {
    const safe = safeRelativePath(path);
    if (registered.has(safe)) fail(`duplicate document path: ${path}`);
    registered.add(safe);
  };
  for (const document of catalog.documents) {
    register(document.en.path);
    if (document.ko) register(document.ko.path);
  }
  for (const redirect of catalog.redirects ?? []) {
    if (!registered.has(redirect.target)) fail(`unknown redirect target: ${redirect.target}`);
    readMarkdown(sourceRoot, redirect.path);
  }
  for (const redirect of catalog.redirects ?? []) register(redirect.path);
  for (const path of walkMarkdown(sourceRoot)) {
    if (!registered.has(safeRelativePath(path))) {
      fail(`unregistered source markdown: ${path}`);
    }
  }
}

function validateTopicsAgainstDocuments(catalog: DocsCatalog): void {
  const ids = new Set(
    catalog.documents.filter((document) => document.bundled).map((document) => document.id),
  );
  for (const [topicId, topic] of Object.entries(catalog.topics)) {
    if (!ids.has(topic.seeAlso)) fail(`unknown seeAlso for ${topicId}: ${topic.seeAlso}`);
    for (const reference of topic.references) {
      if (!ids.has(reference.documentId))
        fail(`unknown topic reference for ${topicId}: ${reference.documentId}`);
    }
  }
}

function validateBundledDocument(document: DocsDocument, sourceRoot: string): LoadedDocsDocument {
  const enMarkdown = readMarkdown(sourceRoot, document.en.path);
  const ko = document.ko;
  if (!ko) fail(`missing ko translation for ${document.id}`);
  const koMarkdown = readMarkdown(sourceRoot, ko.path);
  const enSections = document.bundled ? parseSections(enMarkdown, { requireAnchors: true }) : [];
  const koSections = document.bundled ? parseSections(koMarkdown, { requireAnchors: true }) : [];

  if (document.bundled) {
    const enIds = enSections.map((section) => section.id).sort();
    const koIds = koSections.map((section) => section.id).sort();
    if (enIds.length !== koIds.length || enIds.some((id, index) => id !== koIds[index])) {
      fail(`bundled section set mismatch for ${document.id}`);
    }
  }

  return {
    id: document.id,
    bundled: document.bundled,
    category: document.category,
    order: document.order,
    translations: {
      en: {
        ...document.en,
        terms: document.en.terms ?? [],
        markdown: enMarkdown,
        hash: hashMarkdown(enMarkdown),
        sections: enSections,
      },
      ko: {
        ...ko,
        terms: ko.terms ?? [],
        markdown: koMarkdown,
        hash: hashMarkdown(koMarkdown),
        sections: koSections,
      },
    },
  };
}

function buildIndexDocument(document: LoadedDocsDocument): DocsIndex['documents'][number] {
  return {
    id: document.id,
    bundled: document.bundled,
    category: document.category,
    order: document.order,
    translations: {
      en: {
        path: document.translations.en.path,
        title: document.translations.en.title,
        summary: document.translations.en.summary,
        ...(document.translations.en.terms.length > 0
          ? { terms: document.translations.en.terms }
          : {}),
      },
      ko: {
        path: document.translations.ko.path,
        title: document.translations.ko.title,
        summary: document.translations.ko.summary,
        ...(document.translations.ko.terms.length > 0
          ? { terms: document.translations.ko.terms }
          : {}),
      },
    },
    hashes: {
      en: document.translations.en.hash,
      ko: document.translations.ko.hash,
    },
  };
}

function buildIndexSections(document: LoadedDocsDocument): DocsBundleSection[] {
  if (!document.bundled) return [];
  const sections: DocsBundleSection[] = [];
  for (const language of supportedLanguages) {
    const translation = document.translations[language];
    for (const section of translation.sections) {
      sections.push({
        documentId: document.id,
        language,
        sectionId: section.id,
        title: section.title,
        level: section.level,
        path: translation.path,
        hash: translation.hash,
      });
    }
  }
  return sections;
}

function copyBundleDocuments(outputRoot: string, documents: LoadedDocsBundle['documents']): void {
  for (const document of documents.values()) {
    for (const language of supportedLanguages) {
      const translation = document.translations[language];
      if (!document.bundled) continue;
      const destination = resolve(outputRoot, translation.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, translation.markdown, 'utf8');
    }
  }
}

function validateTopicSections(catalog: DocsCatalog, documents: LoadedDocsDocument[]): void {
  for (const [topic, entry] of Object.entries(catalog.topics)) {
    for (const reference of entry.references) {
      const document = documents.find((candidate) => candidate.id === reference.documentId);
      if (!document?.bundled) fail(`topic ${topic} references an excluded document`);
      if (
        reference.sectionId !== undefined &&
        !document.translations.en.sections.some((section) => section.id === reference.sectionId)
      )
        fail(`unknown topic section: ${topic}/${reference.sectionId}`);
    }
  }
}

function createIndex(documents: LoadedDocsDocument[]): DocsIndex {
  const bundled = documents.filter((document) => document.bundled);
  return {
    schemaVersion: catalogSchemaVersion,
    documents: bundled
      .sort((left, right) => left.order - right.order || compare(left.id, right.id))
      .map(buildIndexDocument),
    sections: bundled
      .flatMap(buildIndexSections)
      .sort(
        (left, right) =>
          compare(left.documentId, right.documentId) ||
          compare(left.language, right.language) ||
          compare(left.sectionId, right.sectionId),
      ),
  };
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function loadBundle(outputRoot: string): LoadedDocsBundle {
  const catalogPath = join(outputRoot, 'catalog.json');
  const indexPath = join(outputRoot, 'index.json');
  if (!existsSync(catalogPath) || !existsSync(indexPath)) fail('missing docs bundle metadata');
  const catalog = assertCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')));
  validateDocumentIds(catalog.documents);
  for (const document of catalog.documents) validateDocumentPaths(document);
  validateTopicMap(catalog);
  validateTopicsAgainstDocuments(catalog);
  const loaded = catalog.documents
    .filter((document) => document.bundled)
    .map((document) => validateBundledDocument(document, outputRoot));
  validateTopicSections(catalog, loaded);
  const index = createIndex(loaded);
  const stored: unknown = JSON.parse(readFileSync(indexPath, 'utf8'));
  if (!isDeepStrictEqual(stored, index)) fail('docs bundle index or integrity hash mismatch');
  const documents = new Map(loaded.map((document) => [document.id, document]));
  return { catalog, index, documents, topics: catalog.topics };
}

/**
 * Validate the source collection before replacing the output with bundled Markdown and metadata.
 *
 * @param spec - Source and non-overlapping output roots, with an optional catalog file path.
 * @returns Metadata for bundled documents and sections; excluded documents are not copied.
 * @throws If the roots overlap or the catalog, source files, or topic references fail validation.
 */
export function buildDocs(spec: { sourceRoot: string; outputRoot: string; catalogPath?: string }): {
  documents: DocsBundleDocument[];
  sections: DocsBundleSection[];
} {
  const catalogPath = spec.catalogPath ?? join(spec.sourceRoot, 'catalog.json');
  validateDocsRootOverlap(spec.sourceRoot, spec.outputRoot);
  if (!existsSync(catalogPath)) fail(`missing catalog: ${catalogPath}`);

  const catalog = assertCatalog(JSON.parse(readFileSync(catalogPath, 'utf8')));
  validateDocumentIds(catalog.documents);
  for (const document of catalog.documents) validateDocumentPaths(document);
  validateTopicMap(catalog);
  validateRedirects(catalog);
  validateTopicsAgainstDocuments(catalog);
  assertAllSourceMarkdownRegistered(catalog, spec.sourceRoot);

  const documents = catalog.documents.map((document) =>
    validateBundledDocument(document, spec.sourceRoot),
  );
  validateTopicSections(catalog, documents);
  const index = createIndex(documents);

  rmSync(spec.outputRoot, { recursive: true, force: true });
  mkdirSync(spec.outputRoot, { recursive: true });
  writeJson(join(spec.outputRoot, 'catalog.json'), catalog);
  writeJson(join(spec.outputRoot, 'index.json'), index);

  const loadedBundle: LoadedDocsBundle = {
    catalog,
    index,
    documents: new Map(documents.map((document) => [document.id, document])),
    topics: catalog.topics,
  };
  copyBundleDocuments(spec.outputRoot, loadedBundle.documents);

  return {
    documents: index.documents.map((entry) => ({
      id: entry.id,
      bundled: entry.bundled,
      category: entry.category,
      order: entry.order,
      translations: entry.translations,
    })),
    sections: index.sections,
  };
}

/**
 * Load a bundle only after its stored index matches the catalog and bundled Markdown.
 *
 * @param outputRoot - Built documentation directory containing catalog.json and index.json.
 * @returns Validated metadata and bundled documents with their original Markdown and sections.
 * @throws If metadata or documents are missing, invalid, or inconsistent with the stored index.
 */
export function loadDocsBundle(outputRoot: string): LoadedDocsBundle {
  return loadBundle(outputRoot);
}

export type { DocsIndex };
