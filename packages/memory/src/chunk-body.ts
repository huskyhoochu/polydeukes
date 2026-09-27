/** A half-open range of a section body, in JavaScript string offsets. */
export type ChunkSpan = { start: number; end: number };

const MAX_CHUNK = 2000;
// Blank lines, then line breaks, then whitespace runs: each level is tried only on a piece the
// level before left longer than the limit.
const SEPARATORS = [/\n[ \t]*\n/g, /\n/g, /\s+/g];

/**
 * Splits a body into contiguous spans of at most 2,000 characters, cutting after a separator
 * and packing pieces greedily. A piece over the limit is re-split at the next level and its
 * parts are packed among themselves only; a whitespace-free run over the limit stays whole.
 * An empty body yields one empty span.
 */
export function chunkSpans(body: string): ChunkSpan[] {
  const spans: ChunkSpan[] = [];
  const place = (start: number, end: number, level: number): void => {
    const separator = SEPARATORS[level];
    if (end - start <= MAX_CHUNK || separator === undefined) {
      spans.push({ start, end });
      return;
    }
    const cuts = [...body.slice(start, end).matchAll(separator)].map(
      (match) => start + match.index + match[0].length,
    );
    if (cuts.at(-1) !== end) cuts.push(end);
    let from = start;
    let packed = start;
    for (const cut of cuts) {
      if (packed > from && cut - from > MAX_CHUNK) {
        place(from, packed, level + 1);
        from = packed;
      }
      packed = cut;
    }
    place(from, packed, level + 1);
  };
  place(0, body.length, 0);
  return spans;
}
