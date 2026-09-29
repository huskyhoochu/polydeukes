/**
 * @polydeukes/sdk-ts — hand a covenant input or a change set to `pdks covenant check` from
 * TypeScript.
 *
 * Beta. Two verbs: `checkCovenant` takes one input, `checkChangeSet` one unified diff. Each
 * locates the `polydeukes` install of the project being judged, spawns its bin, and returns
 * the verdict as a value. No judgment logic lives here.
 * See https://github.com/huskyhoochu/polydeukes
 */

export { type CheckChangeSetSpec, checkChangeSet } from './check-change-set.ts';
export {
  type CheckCovenantSpawnSpec,
  type CheckCovenantSpec,
  type CheckCovenantVerdict,
  checkCovenant,
} from './check-covenant.ts';
