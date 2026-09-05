/** Languages included in every bundled document. */
export type DocsLanguage = 'en' | 'ko';

/** Backward-compatible topic names; their targets belong to the catalog. */
export const DOCS_TOPICS = ['install', 'config', 'discipline', 'covenant', 'witness'] as const;

/** Source-root-relative Markdown path and localized metadata used for retrieval and ranking. */
export type DocsTranslation = {
  path: string;
  title: string;
  summary: string;
  terms?: string[];
};

/** Catalog entry identifying a document across languages and selecting it for bundling. */
export type DocsDocument = {
  id: string;
  category: string;
  order: number;
  bundled: boolean;
  en: DocsTranslation;
  ko?: DocsTranslation;
};

/** Source inventory shared by the documentation build and offline query commands. */
export type DocsCatalog = {
  schemaVersion: number;
  documents: DocsDocument[];
  topics: Record<string, DocsTopic>;
  redirects?: DocsRedirect[];
};

/** Ordered content references for a legacy topic, plus a document ID for further reading. */
export type DocsTopic = {
  references: DocsReference[];
  seeAlso: string;
};

/** Stable document ID, optionally narrowed to a section; omission selects the whole document. */
export type DocsReference = {
  documentId: string;
  sectionId?: string;
};

/** Move-notice path and canonical destination, both relative to the documentation root. */
export type DocsRedirect = {
  path: string;
  target: string;
};

/** Anchored Markdown slice with zero-based line bounds: inclusive start, exclusive end. */
export type DocsSection = {
  id: string;
  title: string;
  level: number;
  startLine: number;
  endLine: number;
  text: string;
};

/** Bilingual metadata returned for a document included in a completed build. */
export type DocsBundleDocument = {
  id: string;
  bundled: boolean;
  category: string;
  order: number;
  translations: Record<DocsLanguage, DocsTranslation>;
};

/** Indexed section location; the hash covers its entire translated document, not the section. */
export type DocsBundleSection = {
  documentId: string;
  language: DocsLanguage;
  sectionId: string;
  title: string;
  level: number;
  path: string;
  hash: string;
};

/** Persisted bundle metadata and document hashes, reconstructed on load to detect inconsistency. */
export type DocsIndex = {
  schemaVersion: 1;
  documents: Array<{
    id: string;
    bundled: boolean;
    category: string;
    order: number;
    translations: Record<DocsLanguage, DocsTranslation>;
    hashes: Record<DocsLanguage, string>;
  }>;
  sections: DocsBundleSection[];
};

/** In-memory catalog and index with loaded Markdown keyed by stable document ID. */
export type LoadedDocsBundle = {
  catalog: DocsCatalog;
  index: DocsIndex;
  documents: Map<string, LoadedDocsDocument>;
  topics: Record<string, DocsTopic>;
};

/** Loaded bilingual Markdown with parsed sections and empty search-term lists where omitted. */
export type LoadedDocsDocument = {
  id: string;
  bundled: boolean;
  category: string;
  order: number;
  translations: Record<
    DocsLanguage,
    {
      path: string;
      title: string;
      summary: string;
      terms: string[];
      markdown: string;
      hash: string;
      sections: DocsSection[];
    }
  >;
};
