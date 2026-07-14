/**
 * First real detection rules for the mutation-rule seam (COVENANT-04b).
 *
 * Pure functions only — each rule is `SimpleCommand → MutationTarget[]`, nothing more.
 * Both rules stay silent on opaque tokens (unknowable values are never reported as
 * confident paths); the 04a core already marks those commands indeterminate, so the
 * fail-closed signal is preserved. Protected-path matching, blocking, allowlists, and
 * telemetry belong to 04d.
 */

import type { MutationRule, MutationTarget, WordToken } from './bash-line.js';

const REDIRECT_WRITE_RULE_NAME = 'redirect-write';
const TEE_RULE_NAME = 'tee';
const SED_IN_PLACE_RULE_NAME = 'sed-in-place';

/** The final path segment of a command word (`/usr/bin/tee` → `tee`). */
function commandBasename(word: WordToken): string {
  return word.text.slice(word.text.lastIndexOf('/') + 1);
}

/**
 * True when a `>&`-family target is an fd reference: all digits, `-` (close), or the
 * digits+`-` move-fd form (`2>&1-` moves fd 1, touching no file).
 */
function isFdReference(text: string): boolean {
  return text === '-' || /^[0-9]+-?$/.test(text);
}

/**
 * Reports the target path of every write-direction redirect (any operator containing `>`).
 * Read redirects (`<`) and fd duplication (`2>&1`, `>&-`) are excluded; a csh-style
 * `>& file` whose target is not an fd reference is still a write.
 */
export const redirectWriteRule: MutationRule = {
  name: REDIRECT_WRITE_RULE_NAME,
  detect(command): MutationTarget[] {
    const targets: MutationTarget[] = [];
    for (const redirect of command.redirects) {
      if (!redirect.operator.includes('>')) continue;
      if (redirect.operator.endsWith('>&') && isFdReference(redirect.target.text)) continue;
      if (redirect.target.opaque) continue;
      targets.push({ path: redirect.target.text, rule: REDIRECT_WRITE_RULE_NAME });
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
  name: TEE_RULE_NAME,
  detect(command): MutationTarget[] {
    const first = command.words[0];
    if (first === undefined || first.opaque) return [];
    if (commandBasename(first) !== 'tee') return [];

    const targets: MutationTarget[] = [];
    let optionsEnded = false;
    for (const word of command.words.slice(1)) {
      if (!optionsEnded) {
        if (word.text === '--') {
          optionsEnded = true;
          continue;
        }
        // A lone `-` is a file operand, not a flag — GNU tee writes a literal `-` file.
        if (word.text.startsWith('-') && word.text !== '-') continue;
      }
      if (word.opaque) continue;
      targets.push({ path: word.text, rule: TEE_RULE_NAME });
    }
    return targets;
  },
};

/** True for any in-place flag form: `-i`, `-i<suffix>`, `--in-place`, `--in-place=<suffix>`. */
function isInPlaceFlag(text: string): boolean {
  return text.startsWith('-i') || text === '--in-place' || text.startsWith('--in-place=');
}

// The script-flag forms whose value arrives in the NEXT word. isScriptFlag must cover
// every flag listed here, or `scriptSkipped` mis-seeds and the wrong operand is dropped.
const SEPARATED_SCRIPT_FLAGS = ['-e', '-f', '--expression', '--file'];

/** True for any script-supplying flag form (`-e`/`-f` family) — its value is never a file. */
function isScriptFlag(text: string): boolean {
  return (
    SEPARATED_SCRIPT_FLAGS.includes(text) ||
    text.startsWith('-e') ||
    text.startsWith('-f') ||
    text.startsWith('--expression=') ||
    text.startsWith('--file=')
  );
}

/**
 * Reports the file operands of an in-place `sed` (first-word basename match, so
 * `/usr/bin/sed` fires too). Without an in-place flag sed writes to stdout — silence.
 * The `-e`/`-f` family is skipped with its value (the `-f` script file is read, not
 * written); when no such flag is present the first positional operand is the sed script
 * — skipped even after `--`. Wrapper commands (`sudo sed`) never fire — the 04d
 * path-mention policy covers them.
 */
export const sedInPlaceRule: MutationRule = {
  name: SED_IN_PLACE_RULE_NAME,
  detect(command): MutationTarget[] {
    const first = command.words[0];
    if (first === undefined || first.opaque) return [];
    if (commandBasename(first) !== 'sed') return [];

    const args = command.words.slice(1);
    if (!args.some((word) => isInPlaceFlag(word.text))) return [];

    const targets: MutationTarget[] = [];
    let optionsEnded = false;
    let skipNext = false;
    // With no script flag anywhere, the first positional operand is the script itself.
    let scriptSkipped = args.some((word) => isScriptFlag(word.text));
    for (const word of args) {
      if (skipNext) {
        skipNext = false;
        continue;
      }
      if (!optionsEnded) {
        if (word.text === '--') {
          optionsEnded = true;
          continue;
        }
        // A lone `-` is an operand, not a flag — same boundary as the tee rule.
        if (word.text.startsWith('-') && word.text !== '-') {
          // The separated flag forms carry their value in the NEXT word — skip it too.
          if (SEPARATED_SCRIPT_FLAGS.includes(word.text)) skipNext = true;
          continue;
        }
      }
      if (!scriptSkipped) {
        scriptSkipped = true;
        continue;
      }
      if (word.opaque) continue;
      targets.push({ path: word.text, rule: SED_IN_PLACE_RULE_NAME });
    }
    return targets;
  },
};
