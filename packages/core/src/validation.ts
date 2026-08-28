/**
 * `validation.ts` — the shape-checking primitives the core's validators share.
 *
 * Internal to the core: `config.ts` and `algebra.ts` both build on these, and neither
 * owns them. Not a public export — `isPlainObject` has its own file because it *is* one.
 */

/**
 * `ConfigValidationError` — raised when a config fails structural validation.
 *
 * The message names the offending field path so the developer sees exactly what is wrong.
 * This throw is a developer-time error (config authoring), a different axis from the
 * covenant runtime's fail-closed exit code — a bad config should fail loud and early.
 */
export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

/** Throw on the first key outside the allowed vocabulary, naming the key and its location. */
export function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  location: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      throw new ConfigValidationError(`unknown key '${key}' in ${location}`);
    }
  }
}

/** True when the value is a string with at least one character. */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** True when the value is an array whose every element is a string. */
export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** Throw unless the pattern string compiles with `new RegExp` — compilability only, never run. */
export function rejectUncompilableRegex(pattern: string, location: string): void {
  try {
    new RegExp(pattern);
  } catch {
    throw new ConfigValidationError(`${location} must be a compilable regular expression`);
  }
}
