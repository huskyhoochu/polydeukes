/**
 * @polydeukes/memory — a derived SQLite index over a project's markdown documents.
 *
 * The index is rebuilt from the documents at any time; the documents stay the record.
 * See https://github.com/huskyhoochu/polydeukes
 */

export {
  type DescribeMemoryIndexSpec,
  describeMemoryIndex,
  type MemoryIndexState,
} from './describe-memory-index.ts';
export { type IngestMemorySpec, ingestMemory } from './ingest-memory.ts';
export {
  type LintMemorySpec,
  lintMemory,
  type MemoryLintResult,
  type MemoryViolation,
} from './lint-memory.ts';
export {
  type ListObligationsSpec,
  listObligations,
  type MemoryObligation,
} from './list-obligations.ts';
export {
  type ListSupersessionSpec,
  listSupersession,
  type MemorySupersession,
} from './list-supersession.ts';
export type { MemoryConfig } from './memory-config.ts';
export { type OpenMemoryDbSpec, openMemoryDb } from './schema.ts';
export { type MemorySearchResult, type SearchMemorySpec, searchMemory } from './search-memory.ts';
export {
  type MemoryDocument,
  type MemoryLink,
  type MemoryLinks,
  type MemorySection,
  type MemoryShownSection,
  type ShowMemorySpec,
  showMemory,
} from './show-memory.ts';
export {
  type MemoryLogEntry,
  type MemoryUsage,
  type SummarizeMemoryUsageSpec,
  summarizeMemoryUsage,
} from './summarize-memory-usage.ts';
