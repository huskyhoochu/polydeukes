import { type CheckCovenantSpec, type CheckCovenantVerdict, runCheck } from './check-covenant.ts';

/** Judge a unified diff, preserving its exact text on stdin. */
export type CheckChangeSetSpec = Omit<CheckCovenantSpec, 'input'> & { diff: string };

/** Send a unified diff to the CLI and return its verdict. */
export async function checkChangeSet(spec: CheckChangeSetSpec): Promise<CheckCovenantVerdict> {
  return runCheck({ ...spec, diffMode: true, stdin: () => spec.diff });
}
