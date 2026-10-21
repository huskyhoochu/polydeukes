/** Generated from core JSON Schema. Run scripts/generate-types.mjs to regenerate. */

/**
 * What `pdks memory search --json` prints on stdout at exit 0. An empty `results` is a search that found nothing; every failure exits non-zero with nothing on stdout. Objects stay open so a host built against this schema keeps reading a newer command's output.
 */
export interface MemorySearchOutput {
  /**
   * When the index being searched was last ingested, as an ISO 8601 timestamp.
   */
  ingestedAt: string;
  /**
   * The matched sections, in the command's ranking order.
   */
  results: MemorySearchResult[];
  [k: string]: unknown;
}
/**
 * One section found in the memory index.
 *
 * This interface was referenced by `MemorySearchOutput`'s JSON-Schema
 * via the `definition` "MemorySearchResult".
 */
export interface MemorySearchResult {
  /**
   * The section id: the document id, `#`, and the heading's slug.
   */
  id: string;
  /**
   * The id of the document the section belongs to.
   */
  conceptId: string;
  /**
   * The document's title.
   */
  docTitle: string;
  /**
   * The section's heading.
   */
  sectionTitle: string;
  /**
   * The document's status as its front matter states it.
   */
  status: string;
  /**
   * Who verified the document: a human reviewer, a machine, or nobody.
   */
  trust: 'human-reviewed' | 'machine-verified' | 'unverified';
  /**
   * Whether the document's `stale_after` date has passed.
   */
  stale: boolean;
  /**
   * How the query matched: every word, some words, or a substring scan.
   */
  matchPath: 'and' | 'or' | 'like';
  /**
   * The documents that directly replace this section's document, sorted; empty when none.
   */
  supersededBy: string[];
  [k: string]: unknown;
}
