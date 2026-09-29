/**
 * `checkChangeSet` — hand one unified diff to `pdks covenant check --diff` and read the verdict.
 *
 * The diff goes to the child's stdin verbatim; umbrella resolution, the spawn, and the
 * status → verdict mapping are the ones `checkCovenant` uses. Nothing here produces, reads,
 * or judges the diff.
 */

import { type CheckCovenantSpec, type CheckCovenantVerdict, runCheck } from './check-covenant.ts';

/** `checkChangeSet` input. */
export type CheckChangeSetSpec = {
  /** The project being judged — config discovery, the child's cwd, its working tree, and the install graph. */
  repoRoot: string;
  /** The unified diff, handed to the child's stdin unchanged. */
  diff: string;
  /** The observer's posture for the run. ABSENT is `block`. */
  enforce?: 'advise' | 'block';
  /** A config layer merged over the discovered config; the umbrella resolves it against `repoRoot`. */
  configLayer?: string;
  /** Where the child writes its telemetry rows, ahead of the config's own log path. */
  telemetryPath?: string;
  /** Injected spawn seam — the same one `checkCovenant` takes. */
  spawn?: CheckCovenantSpec['spawn'];
};

/** Judge one change set against the covenants of `repoRoot` and return the verdict as a value. */
export async function checkChangeSet(spec: CheckChangeSetSpec): Promise<CheckCovenantVerdict> {
  return runCheck({
    repoRoot: spec.repoRoot,
    subject: 'this change set',
    diffMode: true,
    enforce: spec.enforce,
    configLayer: spec.configLayer,
    telemetryPath: spec.telemetryPath,
    stdin: () => spec.diff,
    spawn: spec.spawn,
  });
}
