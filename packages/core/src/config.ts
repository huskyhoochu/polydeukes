/**
 * Config schema v2 + `defineConfig()` validator — config as data (CONFIG-04).
 *
 * This is the single settings surface the three areas share (covenant's `protectedPaths`,
 * ledger's `testCmd`, memory's ticket pattern all reference this shape). Since schema v2 the
 * input is pure JSON-representable data: `testCmd` is a `{scope}` template string, and
 * `defineConfig` is the runtime validator for parsed unknown data (the CONFIG-03 loader feeds
 * it values the compiler never saw). It stays a pure function — zero file I/O, zero runtime
 * dependencies (hand-rolled validation; the published JSON Schema is a sibling artifact the
 * source never reads).
 */

/** Conventional default telemetry log path (PRD §4.3) — local-only observation data. */
export const DEFAULT_TELEMETRY_LOG_PATH = '.polydeukes/roi.log';

/**
 * `LanguageProfile` — the unit of the language axis (PRD §4.1).
 *
 * `testCmd` is a shell command template: every literal `{scope}` token is substituted at
 * resolve time, and the core only carries the resulting string — it never interprets it.
 */
export type LanguageProfile = {
  /** what counts as production source for this language — required */
  productionGlob: string | string[];
  /**
   * shell command template that verifies the given scope — `{scope}` placeholders are
   * substituted at resolve time; the core never interprets the resulting string
   */
  testCmd: string;
};

/**
 * `PolydeukesConfig` — the input shape a user writes (PRD §4.1). JSON-serializable data.
 *
 * Language keys (`typescript`, `python`, …) are user *values*, not the core's vocabulary —
 * no language or tool literal appears in the core source.
 */
export type PolydeukesConfig = {
  /** language axis, first-class. keys are user values ('typescript', 'python', …) */
  languages: Record<string, LanguageProfile>;
  /** raw protected path patterns — normalization is CONFIG-02's job */
  protectedPaths?: string[];
  /** adapter directories — auto-included into the protection surface (CONFIG-02) */
  adapters?: string[];
  telemetry?: {
    /** conventional default applies when omitted (§4.3) */
    logPath?: string;
  };
};

/**
 * `ResolvedLanguageProfile` — a {@link LanguageProfile} with its template compiled.
 *
 * Consumers keep the callable shape (`testCmd(scope)`), identical to schema v1 (LEDGER-05).
 */
export type ResolvedLanguageProfile = {
  productionGlob: string | string[];
  /** compiled from the template — consumers keep the callable shape (LEDGER-05) */
  testCmd: (scope: string) => string;
};

/**
 * `ResolvedConfig` — a validated config with defaults filled and templates compiled.
 *
 * Consumers (covenant/ledger/memory) read `telemetry.logPath` without optional handling.
 */
export type ResolvedConfig = {
  languages: Record<string, ResolvedLanguageProfile>;
  protectedPaths?: string[];
  adapters?: string[];
  telemetry: {
    logPath: string;
  };
};

/**
 * `ConfigValidationError` — raised when a config fails structural validation (PRD §4.3).
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

/** The exact key vocabulary of each object level — anything else is a typo, rejected loudly. */
const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'languages',
  'protectedPaths',
  'adapters',
  'telemetry',
]);
const PROFILE_KEYS: ReadonlySet<string> = new Set(['productionGlob', 'testCmd']);
const TELEMETRY_KEYS: ReadonlySet<string> = new Set(['logPath']);

/** True when the value is a plain record — not null, not an array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Throw on the first key outside the allowed vocabulary, naming the key and its location. */
function rejectUnknownKeys(
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

/** True when the value is an array whose every element is a string. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** True when the glob value is a present, non-empty string or a non-empty array of non-empty strings. */
function isValidGlob(glob: unknown): glob is string | string[] {
  if (typeof glob === 'string') {
    return glob.length > 0;
  }
  if (Array.isArray(glob)) {
    return glob.length > 0 && glob.every((entry) => typeof entry === 'string' && entry.length > 0);
  }
  return false;
}

/**
 * Compile a `{scope}` template into the callable consumers use (PRD §4.2).
 *
 * Exactly the literal token `{scope}` is substituted, at every occurrence (`replaceAll`
 * semantics). Other braces (`${VAR}`, `{a,b}`, `awk '{print}'`) are the shell's own
 * vocabulary and pass through untouched.
 */
function compileTestCmd(template: string): (scope: string) => string {
  // Callback form: a string replacement would interpret `$`-patterns ($$, $&, $`, $')
  // via GetSubstitution, breaking literal insertion for scopes containing `$`.
  return (scope) => template.replaceAll('{scope}', () => scope);
}

/**
 * Validate parsed unknown data as a {@link PolydeukesConfig} and return a
 * {@link ResolvedConfig} with defaults filled and templates compiled (PRD §4.3).
 * Pure — no file I/O.
 *
 * Throws {@link ConfigValidationError} (naming the offending field path) when the top level
 * is not a plain object, any object level carries an unknown key, `languages` is
 * missing/empty, any language's `productionGlob` is missing/empty, any `testCmd` is not a
 * non-empty string template, `telemetry.logPath` is not a string, or
 * `protectedPaths`/`adapters` carries a non-string element.
 */
export function defineConfig(config: unknown): ResolvedConfig {
  if (!isPlainObject(config)) {
    throw new ConfigValidationError('config must be a plain object');
  }
  rejectUnknownKeys(config, TOP_LEVEL_KEYS, 'config');

  const languages = config.languages;
  if (!isPlainObject(languages) || Object.keys(languages).length === 0) {
    throw new ConfigValidationError('languages must be a non-empty object');
  }

  const resolvedLanguages: Record<string, ResolvedLanguageProfile> = {};
  for (const [key, profile] of Object.entries(languages)) {
    if (!isPlainObject(profile)) {
      throw new ConfigValidationError(`languages.${key} must be an object`);
    }
    rejectUnknownKeys(profile, PROFILE_KEYS, `languages.${key}`);
    if (!isValidGlob(profile.productionGlob)) {
      throw new ConfigValidationError(
        `languages.${key}.productionGlob must be a non-empty string or non-empty array of non-empty strings`,
      );
    }
    if (typeof profile.testCmd === 'function') {
      throw new ConfigValidationError(
        `languages.${key}.testCmd must be a string template (config-as-data v2) — ` +
          `replace the function with e.g. 'your-runner {scope}'`,
      );
    }
    if (typeof profile.testCmd !== 'string' || profile.testCmd.length === 0) {
      throw new ConfigValidationError(
        `languages.${key}.testCmd must be a non-empty string template`,
      );
    }
    resolvedLanguages[key] = {
      productionGlob: profile.productionGlob,
      testCmd: compileTestCmd(profile.testCmd),
    };
  }

  if (config.protectedPaths !== undefined && !isStringArray(config.protectedPaths)) {
    throw new ConfigValidationError('protectedPaths must be an array of strings');
  }

  if (config.adapters !== undefined && !isStringArray(config.adapters)) {
    throw new ConfigValidationError('adapters must be an array of strings');
  }

  let logPath: string | undefined;
  if (config.telemetry !== undefined) {
    if (!isPlainObject(config.telemetry)) {
      throw new ConfigValidationError('telemetry must be an object');
    }
    rejectUnknownKeys(config.telemetry, TELEMETRY_KEYS, 'telemetry');
    if (config.telemetry.logPath !== undefined) {
      if (typeof config.telemetry.logPath !== 'string') {
        throw new ConfigValidationError('telemetry.logPath must be a string');
      }
      logPath = config.telemetry.logPath;
    }
  }

  return {
    languages: resolvedLanguages,
    ...(config.protectedPaths !== undefined && { protectedPaths: config.protectedPaths }),
    ...(config.adapters !== undefined && { adapters: config.adapters }),
    telemetry: {
      logPath: logPath ?? DEFAULT_TELEMETRY_LOG_PATH,
    },
  };
}
