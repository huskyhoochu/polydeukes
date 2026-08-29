/**
 * @polydeukes/adapter-git — up-translates a git staged diff into the agent-neutral
 * covenant input IR at commit time.
 *
 * Pre-alpha.
 */

export {
  collectRangeChanges,
  collectStagedChanges,
  collectWorktreeChanges,
} from './collect.js';
export { type GitAdapterSettings, resolveGitAdapterSettings } from './settings.js';
export {
  covenantInputFromStagedChanges,
  STAGED_DELETE,
  STAGED_WRITE,
  type StagedChange,
} from './staged.js';
