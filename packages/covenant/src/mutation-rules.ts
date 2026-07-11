/**
 * First real detection rules for the mutation-rule seam (COVENANT-04b).
 *
 * Pure functions only — each rule is `SimpleCommand → MutationTarget[]`, nothing more.
 * Both rules stay silent on opaque tokens (unknowable values are never reported as
 * confident paths); the 04a core already marks those commands indeterminate, so the
 * fail-closed signal is preserved. Protected-path matching, blocking, allowlists, and
 * telemetry belong to 04d.
 */

import type { MutationRule, MutationTarget } from './bash-line.js';

/** True when a `>&`-family target is an fd reference (all digits, or `-` = close). */
function isFdReference(text: string): boolean {
  return text === '-' || /^[0-9]+$/.test(text);
}

/**
 * Reports the target path of every write-direction redirect (any operator containing `>`).
 * Read redirects (`<`) and fd duplication (`2>&1`, `>&-`) are excluded; a csh-style
 * `>& file` whose target is not an fd reference is still a write.
 */
export const redirectWriteRule: MutationRule = {
  name: 'redirect-write',
  detect(command): MutationTarget[] {
    const targets: MutationTarget[] = [];
    for (const redirect of command.redirects) {
      if (!redirect.operator.includes('>')) continue;
      if (redirect.operator.endsWith('>&') && isFdReference(redirect.target.text)) continue;
      if (redirect.target.opaque) continue;
      targets.push({ path: redirect.target.text, rule: 'redirect-write' });
    }
    return targets;
  },
};

/**
 * Reports every non-flag argument of a `tee` command (first-word basename match, so
 * `/usr/bin/tee` fires too). Flags are skipped until the `--` end-of-options marker;
 * after it, `-`-prefixed words are paths. Wrapper commands (`sudo tee`) never fire —
 * the 04d path-mention policy covers them.
 */
export const teeRule: MutationRule = {
  name: 'tee',
  detect(command): MutationTarget[] {
    const first = command.words[0];
    if (first === undefined || first.opaque) return [];
    const basename = first.text.slice(first.text.lastIndexOf('/') + 1);
    if (basename !== 'tee') return [];

    const targets: MutationTarget[] = [];
    let optionsEnded = false;
    for (const word of command.words.slice(1)) {
      if (!optionsEnded) {
        if (word.text === '--') {
          optionsEnded = true;
          continue;
        }
        if (word.text.startsWith('-')) continue;
      }
      if (word.opaque) continue;
      targets.push({ path: word.text, rule: 'tee' });
    }
    return targets;
  },
};
