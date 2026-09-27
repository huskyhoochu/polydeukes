/** The validated data consumed by document replacement and search. */
export type MemoryConfig = {
  include: string[];
  /** globs whose matches are left out even when an include glob reaches them */
  exclude?: string[];
  typeMap?: Record<string, string>;
  /** rules tried in order; `path` reads the document id, the root-relative path without `.md` */
  ticket?: (
    | { type?: string; from: 'title'; pattern?: string }
    | { type?: string; from: 'frontmatter'; key: string; pattern?: string }
    | { type?: string; from: 'path'; pattern?: string }
  )[];
  weights?: Record<string, number>;
  /**
   * a `line` rule keys every match of `key` on a section line `line` matches; a `section` rule
   * keys the whole section whose title matches by the document's ticket
   */
  obligations?: ({ line: string; key: string } | { section: string })[];
};
