/**
 * @polydeukes/sdk-ts — hand a covenant input to `pdks covenant check` from TypeScript.
 *
 * Alpha. One verb: it locates the `polydeukes` install of the project being judged, spawns
 * its bin, and returns the verdict as a value. No judgment logic lives here.
 * See https://github.com/huskyhoochu/polydeukes
 */

export {
  type CheckCovenantSpawnSpec,
  type CheckCovenantSpec,
  type CheckCovenantVerdict,
  checkCovenant,
} from './check-covenant.ts';
