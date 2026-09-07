/**
 * The judge as the composition roots see it: the seven verbs they call, gathered in one
 * object. A test replaces one member of it; the roots default to the real seven.
 *
 * A leaf module on purpose — it imports the judge and nothing else, so the session subpath
 * that loads it does not also load the commit surface's translator and reader.
 */

import { compileDisciplineRegistrations } from './discipline.ts';
import { dispatchCovenants } from './dispatch.ts';
import { selfModRegistration } from './self-mod.ts';
import { shellModRegistration } from './shell-mod.ts';
import { planSources, supplySources } from './supply.ts';
import { transcriptModRegistration } from './transcript-mod.ts';

/** The judge verbs the composition roots call — the seam a test replaces one member of. */
export type CovenantModule = {
  dispatchCovenants: typeof dispatchCovenants;
  compileDisciplineRegistrations: typeof compileDisciplineRegistrations;
  selfModRegistration: typeof selfModRegistration;
  shellModRegistration: typeof shellModRegistration;
  transcriptModRegistration: typeof transcriptModRegistration;
  planSources: typeof planSources;
  supplySources: typeof supplySources;
};

/** The real seven — what judges a call unless a test injects a replacement. */
export const covenantModule: CovenantModule = {
  dispatchCovenants,
  compileDisciplineRegistrations,
  selfModRegistration,
  shellModRegistration,
  transcriptModRegistration,
  planSources,
  supplySources,
};
