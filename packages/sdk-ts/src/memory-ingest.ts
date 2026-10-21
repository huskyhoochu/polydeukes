import { failureReason, type ProcessSpec, runProcess } from './process.ts';

/** Request indexing in the supplied project root. */
export type MemoryIngestSpec = ProcessSpec & { root: string };
/** Successful indexing or an explicit execution failure. */
export type MemoryIngestOutcome =
  | { outcome: 'ingested' }
  | { outcome: 'unavailable'; reason: string };

/** Bring the project's memory index up to date through pdks. */
export async function memoryIngest(spec: MemoryIngestSpec): Promise<MemoryIngestOutcome> {
  try {
    const result = await runProcess({
      ...spec,
      args: ['memory', 'ingest'],
      stdin: () => new Uint8Array(),
    });
    if (result.status === 0) return { outcome: 'ingested' };
    return {
      outcome: 'unavailable',
      reason:
        new TextDecoder('utf-8', { ignoreBOM: true }).decode(result.stderr) ||
        `memory ingest exited with status ${result.status}`,
    };
  } catch (error) {
    return { outcome: 'unavailable', reason: failureReason(error) };
  }
}
