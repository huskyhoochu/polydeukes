/**
 * @polydeukes/adapter-git — up-translates a git staged diff into the agent-neutral
 * covenant input IR at commit time.
 *
 * Pre-alpha.
 */

export {
  type CollectRangeChangesSpec,
  type CollectStagedChangesSpec,
  type CollectWorktreeChangesSpec,
  collectRangeChanges,
  collectStagedChanges,
  collectWorktreeChanges,
} from './collect.js';
export {
  type Observation,
  type ObservationSourceReaderSpec,
  observationSourceReader,
} from './observation-source-reader.js';
export {
  type GitAdapterSettings,
  type ResolveGitAdapterSettingsSpec,
  resolveGitAdapterSettings,
} from './settings.js';
export {
  type CovenantInputFromStagedChangesSpec,
  covenantInputFromStagedChanges,
  STAGED_DELETE,
  STAGED_WRITE,
  type StagedChange,
} from './staged.js';
