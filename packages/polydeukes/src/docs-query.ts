import { runDocs } from './docs-library.ts';

export { DOCS_TOPICS as TOPICS } from './docs-types.ts';

/** Inputs for the original five-topic query interface. */
export type QueryDocsSpec = {
  docsRoot: string;
  topic?: string;
};

/** Complete topic output, including the command for further reading. */
export type QueryDocsOutcome = { text: string };

/** Answer a legacy topic using the same catalog as search and show. */
export function queryDocs(spec: QueryDocsSpec): QueryDocsOutcome {
  return runDocs({
    docsRoot: spec.docsRoot,
    args: spec.topic === undefined ? [] : [spec.topic],
    version: '',
  });
}

/**
 * Extract a section by its exact heading, retaining the original internal helper's contract.
 * Topic retrieval uses stable IDs instead; this helper remains for existing internal callers.
 */
export function extractSection(markdown: string, heading: string): string {
  const lines = markdown.split('\n');
  const level = /^(#{1,6}) /.exec(heading)?.[1].length ?? 0;
  let fence: { marker: string; length: number } | undefined;
  let start = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = /^(`{3,}|~{3,})/.exec(line.trim())?.[1];
    if (marker) {
      if (fence === undefined) fence = { marker: marker[0], length: marker.length };
      else if (fence.marker === marker[0] && marker.length >= fence.length) fence = undefined;
      continue;
    }
    if (fence !== undefined) continue;
    if (start === -1) {
      if (line === heading) start = index;
      continue;
    }
    const nextLevel = /^(#{1,6}) /.exec(line)?.[1].length ?? 0;
    if (nextLevel > 0 && nextLevel <= level) return lines.slice(start, index).join('\n');
  }
  if (start === -1) throw new Error(`heading not found: ${heading}`);
  return lines.slice(start).join('\n');
}
