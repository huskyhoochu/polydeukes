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
} from './collect.ts';
export {
  type Observation,
  type ObservationSourceReaderSpec,
  observationSourceReader,
} from './observation-source-reader.ts';
export {
  type GitAdapterSettings,
  type ResolveGitAdapterSettingsSpec,
  resolveGitAdapterSettings,
} from './settings.ts';
export {
  type CovenantInputFromStagedChangesSpec,
  covenantInputFromStagedChanges,
  STAGED_DELETE,
  STAGED_WRITE,
  type StagedChange,
} from './staged.ts';
