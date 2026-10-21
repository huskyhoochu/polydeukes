import type { MemorySearchOutput, MemorySearchResult } from './memory.ts';
import { failureReason, type ProcessSpec, runProcess } from './process.ts';

/** Search the index using one literal query argument. */
export type MemorySearchSpec = ProcessSpec & { root: string; query: string; limit?: number };
/** Ranked hits, a valid empty response, or a failed search. */
export type MemorySearchOutcome =
  | { outcome: 'found'; hits: [MemorySearchResult, ...MemorySearchResult[]] }
  | { outcome: 'empty' }
  | { outcome: 'unavailable'; reason: string };

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validOutput(value: unknown): value is MemorySearchOutput {
  return (
    object(value) &&
    typeof value.ingestedAt === 'string' &&
    Array.isArray(value.results) &&
    value.results.every(
      (hit: unknown) =>
        object(hit) &&
        ['id', 'conceptId', 'docTitle', 'sectionTitle', 'status'].every(
          (key) => typeof hit[key] === 'string',
        ) &&
        typeof hit.stale === 'boolean' &&
        ['human-reviewed', 'machine-verified', 'unverified'].includes(hit.trust as string) &&
        ['and', 'or', 'like'].includes(hit.matchPath as string) &&
        Array.isArray(hit.supersededBy) &&
        hit.supersededBy.every((entry: unknown) => typeof entry === 'string'),
    )
  );
}

/** Search memory, validating the successful CLI response before exposing hits. */
export async function memorySearch(spec: MemorySearchSpec): Promise<MemorySearchOutcome> {
  try {
    if (spec.limit !== undefined && (!Number.isSafeInteger(spec.limit) || spec.limit <= 0))
      throw new Error('limit must be a positive safe integer');
    const result = await runProcess({
      ...spec,
      args: [
        'memory',
        'search',
        spec.query,
        '--json',
        ...(spec.limit === undefined ? [] : ['--limit', String(spec.limit)]),
      ],
      stdin: () => new Uint8Array(),
    });
    if (result.status !== 0)
      return {
        outcome: 'unavailable',
        reason:
          new TextDecoder('utf-8', { ignoreBOM: true }).decode(result.stderr) ||
          `memory search exited with status ${result.status}`,
      };
    const output: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(result.stdout),
    );
    if (!validOutput(output)) throw new Error('invalid memory search response');
    if (output.results.length === 0) return { outcome: 'empty' };
    return {
      outcome: 'found',
      hits: output.results as [MemorySearchResult, ...MemorySearchResult[]],
    };
  } catch (error) {
    return { outcome: 'unavailable', reason: failureReason(error) };
  }
}
