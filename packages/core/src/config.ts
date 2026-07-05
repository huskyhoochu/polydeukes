/**
 * Config schema + `defineConfig()` loader — the language axis as a first-class citizen
 * (CONFIG-01).
 *
 * This is the single settings surface the three areas share (covenant's `protectedPaths`,
 * ledger's `testCmd`, memory's ticket pattern all reference this shape). `defineConfig` is a
 * pure validation function — zero file I/O, zero dependencies (hand-rolled validation, no
 * schema library). Discovery/loading of the on-disk config file lives outside the core, in
 * the umbrella CLI.
 */

/** Conventional default telemetry log path (PRD §4.3) — local-only observation data. */
export const DEFAULT_TELEMETRY_LOG_PATH = '.polydeukes/roi.log';

/**
 * `LanguageProfile` — the unit of the language axis (PRD §4.1).
 *
 * `testCmd` is a function (not a string template): scope→command mapping is the user's
 * freedom, and the core only carries the returned shell string — it never interprets it.
 */
export type LanguageProfile = {
  /** what counts as production source for this language — required */
  productionGlob: string | string[];
  /** returns the shell string that verifies the given scope — core never interprets it */
  testCmd: (scope: string) => string;
};

/**
 * `PolydeukesConfig` — the input shape a user writes in `polydeukes.config.ts` (PRD §4.1).
 *
 * Language keys (`typescript`, `python`, …) are user *values*, not the core's vocabulary —
 * no language or tool literal appears in the core source.
 */
export type PolydeukesConfig = {
  /** language axis, first-class. keys are user values ('typescript', 'python', …) */
  languages: Record<string, LanguageProfile>;
  /** raw protected path patterns — normalization is CONFIG-02's job */
  protectedPaths?: string[];
  telemetry?: {
    /** conventional default applies when omitted (§4.3) */
    logPath?: string;
  };
};

/**
 * `ResolvedConfig` — a validated {@link PolydeukesConfig} with defaults filled.
 *
 * Consumers (covenant/ledger/memory) read `telemetry.logPath` without optional handling.
 */
export type ResolvedConfig = PolydeukesConfig & {
  telemetry: {
    logPath: string;
  };
};

/**
 * `ConfigValidationError` — raised when a config fails structural validation (PRD §4.2).
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

/** True when the glob value is a present, non-empty string or a non-empty array of non-empty strings. */
function isValidGlob(glob: unknown): boolean {
  if (typeof glob === 'string') {
    return glob.length > 0;
  }
  if (Array.isArray(glob)) {
    return glob.length > 0 && glob.every((entry) => typeof entry === 'string' && entry.length > 0);
  }
  return false;
}

/**
 * Validate a {@link PolydeukesConfig} and return a {@link ResolvedConfig} with defaults filled
 * (PRD §4.2). Pure — no file I/O.
 *
 * Throws {@link ConfigValidationError} (naming the offending field path) when `languages` is
 * missing/empty, any language's `productionGlob` is missing/empty, any `testCmd` is not a
 * function, or `protectedPaths` carries a non-string element.
 */
export function defineConfig(config: PolydeukesConfig): ResolvedConfig {
  const languages = config.languages;
  if (typeof languages !== 'object' || languages === null || Object.keys(languages).length === 0) {
    throw new ConfigValidationError('languages must be a non-empty object');
  }

  for (const [key, profile] of Object.entries(languages)) {
    if (!isValidGlob(profile.productionGlob)) {
      throw new ConfigValidationError(
        `languages.${key}.productionGlob must be a non-empty string or non-empty array of non-empty strings`,
      );
    }
    if (typeof profile.testCmd !== 'function') {
      throw new ConfigValidationError(`languages.${key}.testCmd must be a function`);
    }
  }

  if (config.protectedPaths !== undefined) {
    if (
      !Array.isArray(config.protectedPaths) ||
      !config.protectedPaths.every((entry) => typeof entry === 'string')
    ) {
      throw new ConfigValidationError('protectedPaths must be an array of strings');
    }
  }

  return {
    ...config,
    telemetry: {
      ...config.telemetry,
      logPath: config.telemetry?.logPath ?? DEFAULT_TELEMETRY_LOG_PATH,
    },
  };
}
