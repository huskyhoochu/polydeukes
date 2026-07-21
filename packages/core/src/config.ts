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
 * `DisciplineForbid` — the delta-family predicate value (COVENANT-10 §4.1).
 *
 * The string shorthand is equivalent to `{ added }`; `removed`/`present` directions are
 * deferred (COVENANT-12) and rejected by validation.
 */
export type DisciplineForbid = string | { added: string };

/**
 * `DisciplineEntry` — one user-declared discipline (COVENANT-10 §4.1). Pure JSON data.
 *
 * Exactly one predicate key (`forbid` | `immutable` | `forbidCommand`) per entry;
 * `in`/`except` scope only the delta family. Compilation is the covenant package's job —
 * the core validates compilability of regex strings but never executes them.
 */
export type DisciplineEntry = {
  /** unique handle — telemetry label and verdict reason prefix */
  id: string;
  /** prose rationale, documentation only — never judged */
  why?: string;
  /** delta-family scope: glob(s) the file path must match (absent = every file change) */
  in?: string | string[];
  /** delta-family scope: glob(s) excluded after `in` */
  except?: string | string[];
  /** delta family — string shorthand = { added } */
  forbid?: DisciplineForbid;
  /** path family — its own glob is the scope */
  immutable?: string | string[];
  /** command family — regex over shell command strings */
  forbidCommand?: string;
};

/**
 * `PolydeukesConfig` — the input shape a user writes (PRD §4.1). JSON-serializable data.
 *
 * Language keys (`typescript`, `python`, …) are user *values*, not the core's vocabulary —
 * no language or tool literal appears in the core source.
 */
export type PolydeukesConfig = {
  /** IDE schema reference (CONFIG-03) — accepted and ignored, never part of the resolution */
  $schema?: string;
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
  /** user-declared disciplines — validated here, compiled by the covenant package */
  disciplines?: DisciplineEntry[];
  /**
   * TTL waiver values for the covenant escape-hatch seam (CONFIG-05) — consumed at
   * assembly time, validated here
   */
  waiver?: {
    /**
     * the agreed phrase a human types alone on a message's first line — quoting it
     * mid-sentence is a mention, not an invocation (COVENANT-15). Non-empty after
     * trimming; the value itself is free (provenance, not secrecy, is the defence)
     */
    token: string;
    /** validity window in minutes from the user message's timestamp — finite and > 0 */
    ttlMinutes: number;
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
  /** validated discipline data, passed through verbatim (absent stays absent) */
  disciplines?: DisciplineEntry[];
  /** validated waiver data, passed through verbatim (absent stays absent) */
  waiver?: {
    token: string;
    ttlMinutes: number;
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
  '$schema',
  'languages',
  'protectedPaths',
  'adapters',
  'telemetry',
  'disciplines',
  'waiver',
]);
const PROFILE_KEYS: ReadonlySet<string> = new Set(['productionGlob', 'testCmd']);
const TELEMETRY_KEYS: ReadonlySet<string> = new Set(['logPath']);
const WAIVER_KEYS: ReadonlySet<string> = new Set(['token', 'ttlMinutes']);
const DISCIPLINE_KEYS: ReadonlySet<string> = new Set([
  'id',
  'why',
  'in',
  'except',
  'forbid',
  'immutable',
  'forbidCommand',
]);
const PREDICATE_KEYS = ['forbid', 'immutable', 'forbidCommand'] as const;

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

/** Throw unless the pattern string compiles with `new RegExp` — compilability only, never run. */
function rejectUncompilableRegex(pattern: string, location: string): void {
  try {
    new RegExp(pattern);
  } catch {
    throw new ConfigValidationError(`${location} must be a compilable regular expression`);
  }
}

/**
 * Validate the `disciplines` array (COVENANT-10 §4.1). Throws {@link ConfigValidationError}
 * naming the offending entry/key; the validated data passes through verbatim.
 */
function validateDisciplines(disciplines: unknown): DisciplineEntry[] {
  if (!Array.isArray(disciplines)) {
    throw new ConfigValidationError('disciplines must be an array');
  }

  const seenIds = new Set<string>();
  disciplines.forEach((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new ConfigValidationError(`disciplines[${index}] must be an object`);
    }
    if (typeof entry.id !== 'string' || entry.id.length === 0) {
      throw new ConfigValidationError(`disciplines[${index}].id must be a non-empty string`);
    }
    const location = `disciplines[${index}] ('${entry.id}')`;
    if (seenIds.has(entry.id)) {
      throw new ConfigValidationError(`${location} duplicates the id of an earlier entry`);
    }
    seenIds.add(entry.id);
    rejectUnknownKeys(entry, DISCIPLINE_KEYS, location);
    if (entry.why !== undefined && typeof entry.why !== 'string') {
      throw new ConfigValidationError(`${location} why must be a string`);
    }

    const predicates = PREDICATE_KEYS.filter((key) => entry[key] !== undefined);
    if (predicates.length !== 1) {
      throw new ConfigValidationError(
        `${location} must have exactly one predicate key (forbid | immutable | forbidCommand)`,
      );
    }
    const predicate = predicates[0];
    if (predicate !== 'forbid' && (entry.in !== undefined || entry.except !== undefined)) {
      throw new ConfigValidationError(`${location} allows in/except only on a forbid entry`);
    }

    if (predicate === 'forbid') {
      const forbid = entry.forbid;
      if (typeof forbid === 'string') {
        rejectUncompilableRegex(forbid, `${location} forbid`);
      } else if (isPlainObject(forbid)) {
        // Only the { added } direction exists before COVENANT-12.
        const keys = Object.keys(forbid);
        if (keys.length !== 1 || keys[0] !== 'added' || typeof forbid.added !== 'string') {
          throw new ConfigValidationError(
            `${location} forbid object must have exactly one key 'added' with a string pattern`,
          );
        }
        rejectUncompilableRegex(forbid.added, `${location} forbid.added`);
      } else {
        throw new ConfigValidationError(
          `${location} forbid must be a string pattern or an { added } object`,
        );
      }
      if (entry.in !== undefined && !isValidGlob(entry.in)) {
        throw new ConfigValidationError(`${location} in must be a non-empty glob or glob array`);
      }
      if (entry.except !== undefined && !isValidGlob(entry.except)) {
        throw new ConfigValidationError(
          `${location} except must be a non-empty glob or glob array`,
        );
      }
    } else if (predicate === 'immutable') {
      if (!isValidGlob(entry.immutable)) {
        throw new ConfigValidationError(
          `${location} immutable must be a non-empty glob or glob array`,
        );
      }
    } else {
      if (typeof entry.forbidCommand !== 'string') {
        throw new ConfigValidationError(`${location} forbidCommand must be a string pattern`);
      }
      rejectUncompilableRegex(entry.forbidCommand, `${location} forbidCommand`);
    }
  });

  return disciplines as DisciplineEntry[];
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

  // `$schema` is an IDE schema reference (CONFIG-03): accepted, type-checked, and
  // ignored — it never appears in the resolution output.
  if (config.$schema !== undefined && typeof config.$schema !== 'string') {
    throw new ConfigValidationError('$schema must be a string');
  }

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

  const disciplines =
    config.disciplines !== undefined ? validateDisciplines(config.disciplines) : undefined;

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

  let waiver: { token: string; ttlMinutes: number } | undefined;
  if (config.waiver !== undefined) {
    if (!isPlainObject(config.waiver)) {
      throw new ConfigValidationError('waiver must be an object');
    }
    rejectUnknownKeys(config.waiver, WAIVER_KEYS, 'waiver');
    const { token, ttlMinutes } = config.waiver;
    if (typeof token !== 'string' || token.trim().length === 0) {
      throw new ConfigValidationError('waiver.token must be a non-empty string after trimming');
    }
    if (typeof ttlMinutes !== 'number' || !(Number.isFinite(ttlMinutes) && ttlMinutes > 0)) {
      throw new ConfigValidationError('waiver.ttlMinutes must be a finite number greater than 0');
    }
    waiver = { token, ttlMinutes };
  }

  return {
    languages: resolvedLanguages,
    ...(config.protectedPaths !== undefined && { protectedPaths: config.protectedPaths }),
    ...(config.adapters !== undefined && { adapters: config.adapters }),
    telemetry: {
      logPath: logPath ?? DEFAULT_TELEMETRY_LOG_PATH,
    },
    ...(disciplines !== undefined && { disciplines }),
    ...(waiver !== undefined && { waiver }),
  };
}
