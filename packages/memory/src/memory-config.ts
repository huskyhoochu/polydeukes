/** The validated data consumed by document replacement and search. */
export type MemoryConfig = {
  include: string[];
  typeMap?: Record<string, string>;
  ticket?: (
    | { type?: string; from: 'title'; pattern?: string }
    | { type?: string; from: 'frontmatter'; key: string; pattern?: string }
  )[];
  weights?: Record<string, number>;
};
