/**
 * Config schema and the `defineConfig()` validator — config as data.
 *
 * The single settings surface the areas share. The input is pure JSON-representable data,
 * and `defineConfig` is the runtime validator for parsed unknown values the compiler never
 * saw. It stays a pure function — no file I/O and no runtime dependencies: validation is
 * hand-rolled, and the published JSON Schema is a sibling artifact this source never reads.
 */

import { type AlgebraDeclaration, validateAlgebraDeclaration } from './algebra.js';
import { isPlainObject } from './is-plain-object.js';
import {
  ConfigValidationError,
  isNonEmptyString,
  isStringArray,
  rejectUncompilableRegex,
  rejectUnknownKeys,
} from './validation.js';

export { ConfigValidationError } from './validation.js';

/** Conventional default telemetry log path — local-only observation data. */
export const DEFAULT_TELEMETRY_LOG_PATH = '.polydeukes/roi.log';

/**
 * `LanguageProfile` — the unit of the language axis.
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
 * `DisciplineForbid` — the delta-family predicate value.
 *
 * The string shorthand is equivalent to `{ added }`. It is the only direction that exists;
 * anything else is rejected by validation.
 */
export type DisciplineForbid = string | { added: string };

/**
 * `AlgebraDeclarationBody` — an algebra declaration minus its name.
 *
 * The declaration family names itself with the entry's `id`, so the block under `declare`
 * carries every other key and never `discipline`.
 */
export type AlgebraDeclarationBody = Omit<AlgebraDeclaration, 'discipline'>;

/**
 * `EnforceLevel` — an entry's own rung on the promotion ladder. `advise` records a break
 * without stopping it; `block` pins the entry at block whatever default the ladder later
 * adopts. Absence means advise; `block` is the promotion rung.
 */
export type EnforceLevel = 'block' | 'advise';

/**
 * `DisciplineEntry` — one user-declared discipline. Pure JSON data.
 *
 * Exactly one predicate key (`forbid` | `immutable` | `forbidCommand` |
 * `requirePrecedent` | `declare`) per entry; `in`/`except` scope the delta and context
 * families.
 * Compilation is the covenant package's job — the core validates compilability of regex
 * strings but never executes them.
 */
export type DisciplineEntry = {
  /** unique handle — telemetry label and verdict reason prefix */
  id: string;
  /** prose rationale — never judged, and carried into the break message */
  why?: string;
  /** the author's level; composes with the observer's surface level, lenient side winning */
  enforce?: EnforceLevel;
  /** delta/context-family scope: glob(s) the file path must match (absent = every file change) */
  in?: string | string[];
  /** delta/context-family scope: glob(s) excluded after `in` */
  except?: string | string[];
  /** delta family — string shorthand = { added } */
  forbid?: DisciplineForbid;
  /** path family — its own glob is the scope */
  immutable?: string | string[];
  /** command family — regex over shell command strings */
  forbidCommand?: string;
  /** context-family trigger: added-direction delta regex (absent = every in-scope change) */
  when?: string;
  /**
   * context family — the session evidence one edit requires beforehand. Exactly one
   * evidence key. The core owns and fully validates `command`; every other key is
   * adapter vocabulary whose value passes through verbatim.
   */
  requirePrecedent?: Record<string, unknown>;
  /**
   * declaration family — one judgment written as data. The entry's `id` is the
   * declaration's name and the block's own `scope` is its scope, so an entry carrying
   * `declare` takes neither `in`/`except` nor `when`.
   */
  declare?: AlgebraDeclarationBody;
};

/**
 * `DisciplineDraft` — an unpromoted discipline: the promotion ladder's first rung,
 * registered as prose ahead of any predicate.
 *
 * A draft is declared, never inferred — only the literal `draft: true` makes one, and an
 * entry with neither a predicate nor the marker stays a validation error. It carries no
 * predicate, scope, or trigger key, produces no registration, no judgment, and no
 * telemetry row; `pdks explain` renders it as unpromoted.
 */
export type DisciplineDraft = {
  /** unique handle in the same label space as judged entries and meta-covenant labels */
  id: string;
  /** the draft's whole body — required prose, unlike the judged families' optional why */
  why: string;
  /** the explicit marker; only the literal true exists (false is rejected as dead data) */
  draft: true;
};

/**
 * `PolydeukesConfig` — the input shape a user writes. JSON-serializable data.
 *
 * Language keys (`typescript`, `python`, …) are user *values*, not the core's vocabulary —
 * no language or tool literal appears in the core source.
 */
export type PolydeukesConfig = {
  /** IDE schema reference — accepted and ignored, never part of the resolution */
  $schema?: string;
  /** language axis, first-class. keys are user values ('typescript', 'python', …) */
  languages: Record<string, LanguageProfile>;
  /** raw protected path patterns — normalized downstream, never here */
  protectedPaths?: string[];
  /**
   * adapter namespaces — keys are ecosystem values (never validated), each value is that
   * adapter's own settings object, passed through verbatim (the vocabulary belongs to the
   * adapter, whose own validator judges the contents)
   */
  adapters?: Record<string, Record<string, unknown>>;
  telemetry?: {
    /** conventional default applies when omitted */
    logPath?: string;
  };
  /** user-declared disciplines — validated here, compiled by the covenant package */
  disciplines?: (DisciplineEntry | DisciplineDraft)[];
  /**
   * TTL witness values for the covenant valve seam — consumed at assembly time,
   * validated here
   */
  witness?: {
    /**
     * the agreed phrase a human types alone on a message's first line — quoting it
     * mid-sentence is a mention, not an invocation. Non-empty after trimming; the value
     * itself is free, since provenance rather than secrecy is the defence
     */
    token: string;
    /** validity window in minutes from the user message's timestamp — finite and > 0 */
    ttlMinutes: number;
  };
};

/**
 * `ResolvedLanguageProfile` — a {@link LanguageProfile} with its template compiled.
 *
 * Consumers keep the callable shape (`testCmd(scope)`).
 */
export type ResolvedLanguageProfile = {
  productionGlob: string | string[];
  /** compiled from the template — consumers keep the callable shape */
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
  /** validated adapter namespaces, passed through verbatim (absent stays absent) */
  adapters?: Record<string, Record<string, unknown>>;
  telemetry: {
    logPath: string;
  };
  /**
   * validated judged entries only — drafts are split out at resolution time so the
   * covenant compiler has no path that receives one. Present whenever the input
   * declared a `disciplines` array, holding exactly its judged entries in order.
   */
  disciplines?: DisciplineEntry[];
  /** validated drafts in declaration order (absent when the input carries none) */
  drafts?: DisciplineDraft[];
  /** validated witness data, passed through verbatim (absent stays absent) */
  witness?: {
    token: string;
    ttlMinutes: number;
  };
};

/** Labels the assembly reserves for the judging chain's own registrations. */
const META_COVENANT_LABELS = ['self-mod', 'shell-mod', 'transcript-mod'];

const TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  '$schema',
  'languages',
  'protectedPaths',
  'adapters',
  'telemetry',
  'disciplines',
  'witness',
]);
const PROFILE_KEYS: ReadonlySet<string> = new Set(['productionGlob', 'testCmd']);
const TELEMETRY_KEYS: ReadonlySet<string> = new Set(['logPath']);
const WITNESS_KEYS: ReadonlySet<string> = new Set(['token', 'ttlMinutes']);
const DISCIPLINE_KEYS: ReadonlySet<string> = new Set([
  'id',
  'why',
  'enforce',
  'in',
  'except',
  'forbid',
  'immutable',
  'forbidCommand',
  'when',
  'requirePrecedent',
  'declare',
]);
const DRAFT_KEYS: ReadonlySet<string> = new Set(['id', 'why', 'draft']);
const ENFORCE_LEVELS: ReadonlySet<string> = new Set(['block', 'advise']);
const PREDICATE_KEYS = [
  'forbid',
  'immutable',
  'forbidCommand',
  'requirePrecedent',
  'declare',
] as const;
/** Predicate families that `in`/`except` may scope — delta and context. */
const SCOPED_PREDICATE_KEYS: ReadonlySet<string> = new Set(['forbid', 'requirePrecedent']);

/** True when the glob value is a present, non-empty string or a non-empty array of non-empty strings. */
function isValidGlob(glob: unknown): glob is string | string[] {
  if (typeof glob === 'string') {
    return isNonEmptyString(glob);
  }
  return Array.isArray(glob) && glob.length > 0 && glob.every(isNonEmptyString);
}

/**
 * Compile a `{scope}` template into the callable consumers use.
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
 * Validate a context-family `requirePrecedent` value.
 *
 * Evidence vocabulary is layered: the container (a flat object holding exactly one
 * evidence key) is the core's, and so is the `command` key — a shell command is the
 * agent-crossing surface, fully validated here. Every other key belongs to an adapter,
 * whose own validator judges the value; the core passes it through verbatim and never
 * inspects it. An unrecognized evidence key fails closed at assembly time, not here.
 */
function validateRequirePrecedent(evidence: unknown, location: string): void {
  if (!isPlainObject(evidence)) {
    throw new ConfigValidationError(`${location} requirePrecedent must be an object`);
  }
  const keys = Object.keys(evidence);
  if (keys.length !== 1) {
    throw new ConfigValidationError(
      `${location} requirePrecedent must have exactly one evidence key`,
    );
  }
  if (keys[0] === 'command') {
    const command = evidence.command;
    if (typeof command !== 'string' || command.length === 0) {
      throw new ConfigValidationError(
        `${location} requirePrecedent.command must be a non-empty string pattern`,
      );
    }
    rejectUncompilableRegex(command, `${location} requirePrecedent.command`);
  }
}

type RawEntry = Record<string, unknown>;

/** Validate a draft entry and return it as data. */
function validateDraft(entry: RawEntry, id: string, location: string): DisciplineDraft {
  for (const key of Object.keys(entry)) {
    if (!DRAFT_KEYS.has(key)) {
      // Named as the draft rule, not as an unknown key: `forbid` et al. are legal
      // discipline keys, just not on a draft.
      throw new ConfigValidationError(
        `${location} allows only id, why, draft on a draft entry (found '${key}')`,
      );
    }
  }
  if (entry.draft !== true) {
    throw new ConfigValidationError(`${location} draft must be the literal true`);
  }
  if (typeof entry.why !== 'string' || entry.why.length === 0) {
    throw new ConfigValidationError(
      `${location} why must be a non-empty string on a draft entry — the prose is its whole body`,
    );
  }
  return { id, why: entry.why, draft: true };
}

/** Validate the head of a judged entry — the closed key set, `why`, and `enforce`. */
function validateEntryHead(entry: RawEntry, location: string): void {
  rejectUnknownKeys(entry, DISCIPLINE_KEYS, location);
  if (entry.why !== undefined && typeof entry.why !== 'string') {
    throw new ConfigValidationError(`${location} why must be a string`);
  }
  if (
    entry.enforce !== undefined &&
    (typeof entry.enforce !== 'string' || !ENFORCE_LEVELS.has(entry.enforce))
  ) {
    throw new ConfigValidationError(`${location} enforce must be 'block' or 'advise'`);
  }
}

/** Select the entry's family — exactly one predicate key, plus the keys that family admits. */
function selectFamily(entry: RawEntry, location: string): (typeof PREDICATE_KEYS)[number] {
  const predicates = PREDICATE_KEYS.filter((key) => entry[key] !== undefined);
  if (predicates.length !== 1) {
    throw new ConfigValidationError(
      `${location} must have exactly one predicate key ` +
        `(forbid | immutable | forbidCommand | requirePrecedent | declare)`,
    );
  }
  const predicate = predicates[0];
  if (
    !SCOPED_PREDICATE_KEYS.has(predicate) &&
    (entry.in !== undefined || entry.except !== undefined)
  ) {
    throw new ConfigValidationError(
      `${location} allows in/except only on a forbid or requirePrecedent entry`,
    );
  }
  // `when` is the context family's trigger; on any other family it would be dead data
  // implying a trigger that is never applied.
  if (entry.when !== undefined && predicate !== 'requirePrecedent') {
    throw new ConfigValidationError(`${location} allows when only on a requirePrecedent entry`);
  }
  if (entry.in !== undefined && !isValidGlob(entry.in)) {
    throw new ConfigValidationError(`${location} in must be a non-empty glob or glob array`);
  }
  if (entry.except !== undefined && !isValidGlob(entry.except)) {
    throw new ConfigValidationError(`${location} except must be a non-empty glob or glob array`);
  }
  return predicate;
}

function validateForbid(entry: RawEntry, location: string): void {
  const forbid = entry.forbid;
  if (typeof forbid === 'string') {
    // An empty pattern matches at every position, so the entry would break every
    // in-scope change — rejected like every sibling pattern field.
    if (forbid.length === 0) {
      throw new ConfigValidationError(`${location} forbid must be a non-empty string pattern`);
    }
    rejectUncompilableRegex(forbid, `${location} forbid`);
  } else if (isPlainObject(forbid)) {
    const keys = Object.keys(forbid);
    if (keys.length !== 1 || keys[0] !== 'added' || typeof forbid.added !== 'string') {
      throw new ConfigValidationError(
        `${location} forbid object must have exactly one key 'added' with a string pattern`,
      );
    }
    if (forbid.added.length === 0) {
      throw new ConfigValidationError(
        `${location} forbid.added must be a non-empty string pattern`,
      );
    }
    rejectUncompilableRegex(forbid.added, `${location} forbid.added`);
  } else {
    throw new ConfigValidationError(
      `${location} forbid must be a string pattern or an { added } object`,
    );
  }
}

function validateImmutable(entry: RawEntry, location: string): void {
  if (!isValidGlob(entry.immutable)) {
    throw new ConfigValidationError(`${location} immutable must be a non-empty glob or glob array`);
  }
}

function validateForbidCommand(entry: RawEntry, location: string): void {
  if (typeof entry.forbidCommand !== 'string') {
    throw new ConfigValidationError(`${location} forbidCommand must be a string pattern`);
  }
  if (entry.forbidCommand.length === 0) {
    // An empty pattern matches every command line — one typo would block every
    // shell call the entry sees.
    throw new ConfigValidationError(`${location} forbidCommand must be a non-empty string pattern`);
  }
  rejectUncompilableRegex(entry.forbidCommand, `${location} forbidCommand`);
}

function validateContextEntry(entry: RawEntry, location: string): void {
  if (entry.when !== undefined) {
    if (typeof entry.when !== 'string') {
      throw new ConfigValidationError(`${location} when must be a string pattern`);
    }
    if (entry.when.length === 0) {
      // An empty pattern matches at every position, so the trigger would fire on any
      // file that merely grows — reject it like every sibling pattern field.
      throw new ConfigValidationError(`${location} when must be a non-empty string pattern`);
    }
    rejectUncompilableRegex(entry.when, `${location} when`);
  }
  validateRequirePrecedent(entry.requirePrecedent, location);
}

/**
 * Validate a declaration-family entry by delegating the block to the algebra validator.
 *
 * The entry's `id` supplies the declaration's name, so the block carrying its own
 * `discipline` is refused rather than silently overwritten. The delegated messages arrive
 * with the entry's location in front of them, which is what places a failure among many
 * entries.
 */
function validateDeclareEntry(entry: RawEntry, location: string): void {
  const block = entry.declare;
  if (!isPlainObject(block)) {
    throw new ConfigValidationError(`${location} declare must be an object`);
  }
  if ('discipline' in block) {
    throw new ConfigValidationError(
      `${location} declare must not carry discipline — the entry id is the name`,
    );
  }
  validateAlgebraDeclaration({ discipline: entry.id, ...block }, `${location} declare`);
}

/** One validator per family, keyed by the predicate that selects the family. */
const PREDICATE_VALIDATORS: Record<
  (typeof PREDICATE_KEYS)[number],
  (entry: RawEntry, location: string) => void
> = {
  forbid: validateForbid,
  immutable: validateImmutable,
  forbidCommand: validateForbidCommand,
  requirePrecedent: validateContextEntry,
  declare: validateDeclareEntry,
};

/**
 * Validate the `disciplines` array and split judged entries from drafts. Throws
 * {@link ConfigValidationError} naming the offending entry/key; the validated data passes
 * through verbatim, in declaration order.
 */
function validateDisciplines(disciplines: unknown): {
  judged: DisciplineEntry[];
  drafts: DisciplineDraft[];
} {
  if (!Array.isArray(disciplines)) {
    throw new ConfigValidationError('disciplines must be an array');
  }

  const judged: DisciplineEntry[] = [];
  const drafts: DisciplineDraft[] = [];
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
    // The three meta-covenant registrations share the telemetry label space with
    // discipline ids; a colliding id would make gain aggregation and any label-keyed
    // reader (pdks explain) ambiguous.
    if (META_COVENANT_LABELS.includes(entry.id)) {
      throw new ConfigValidationError(`${location} id collides with a meta-covenant label`);
    }
    seenIds.add(entry.id);

    // Selected by the marker's value, so an explicit `draft: undefined` is absence,
    // like every other optional key in this validator.
    if (entry.draft !== undefined) {
      drafts.push(validateDraft(entry, entry.id, location));
      return;
    }

    validateEntryHead(entry, location);
    const predicate = selectFamily(entry, location);
    PREDICATE_VALIDATORS[predicate](entry, location);
    judged.push(entry as DisciplineEntry);
  });

  return { judged, drafts };
}

/** Validate the `languages` map and compile each profile's `{scope}` template. */
function validateLanguages(languages: unknown): Record<string, ResolvedLanguageProfile> {
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
  return resolvedLanguages;
}

/** Validate `protectedPaths` — an array of non-empty strings; the data passes through verbatim. */
function validateProtectedPaths(protectedPaths: unknown): string[] {
  if (!isStringArray(protectedPaths)) {
    throw new ConfigValidationError('protectedPaths must be an array of strings');
  }
  // An empty element carries no path meaning and would ride along unnoticed next to
  // valid siblings.
  if (protectedPaths.some((path) => path.length === 0)) {
    throw new ConfigValidationError('protectedPaths must not contain an empty string');
  }
  return protectedPaths;
}

/**
 * Validate the `adapters` map — each namespace is a plain object whose contents belong to
 * that adapter's own validator, so they pass through verbatim.
 */
function validateAdapters(adapters: unknown): Record<string, Record<string, unknown>> {
  // Array first: the removed directory-list form deserves a migration hint, not a
  // generic type error — and an EMPTY array must land here too, never pass as a map.
  if (Array.isArray(adapters) || !isPlainObject(adapters)) {
    throw new ConfigValidationError(
      'adapters must be an object map of adapter namespaces — the directory-list form ' +
        'was removed; move directories to protectedPaths',
    );
  }
  for (const [name, namespace] of Object.entries(adapters)) {
    if (!isPlainObject(namespace)) {
      throw new ConfigValidationError(`adapters.${name} must be an object`);
    }
  }
  return adapters as Record<string, Record<string, unknown>>;
}

/** Validate the `telemetry` section and return its `logPath` (absent stays undefined). */
function validateTelemetry(telemetry: unknown): string | undefined {
  if (!isPlainObject(telemetry)) {
    throw new ConfigValidationError('telemetry must be an object');
  }
  rejectUnknownKeys(telemetry, TELEMETRY_KEYS, 'telemetry');
  if (telemetry.logPath === undefined) {
    return undefined;
  }
  if (typeof telemetry.logPath !== 'string') {
    throw new ConfigValidationError('telemetry.logPath must be a string');
  }
  if (telemetry.logPath.trim().length === 0) {
    throw new ConfigValidationError('telemetry.logPath must be a non-empty string after trimming');
  }
  return telemetry.logPath;
}

/** Validate the `witness` section — both values are consumed at assembly time. */
function validateWitness(witness: unknown): { token: string; ttlMinutes: number } {
  if (!isPlainObject(witness)) {
    throw new ConfigValidationError('witness must be an object');
  }
  rejectUnknownKeys(witness, WITNESS_KEYS, 'witness');
  const { token, ttlMinutes } = witness;
  if (typeof token !== 'string' || token.trim().length === 0) {
    throw new ConfigValidationError('witness.token must be a non-empty string after trimming');
  }
  if (typeof ttlMinutes !== 'number' || !(Number.isFinite(ttlMinutes) && ttlMinutes > 0)) {
    throw new ConfigValidationError('witness.ttlMinutes must be a finite number greater than 0');
  }
  return { token, ttlMinutes };
}

/**
 * Validate parsed unknown data as a {@link PolydeukesConfig} and return a
 * {@link ResolvedConfig} with defaults filled and templates compiled. Pure — no file I/O.
 *
 * Throws {@link ConfigValidationError} (naming the offending field path) when the top level
 * is not a plain object, any object level carries an unknown key, `languages` is
 * missing/empty, any language's `productionGlob` is missing/empty, any `testCmd` is not a
 * non-empty string template, `telemetry.logPath` is not a non-empty string after trimming,
 * `protectedPaths` carries a non-string or empty element, or `adapters` is not a map of
 * plain-object namespaces.
 */
export function defineConfig(config: unknown): ResolvedConfig {
  if (!isPlainObject(config)) {
    throw new ConfigValidationError('config must be a plain object');
  }
  rejectUnknownKeys(config, TOP_LEVEL_KEYS, 'config');

  // `$schema` is an IDE schema reference: accepted, type-checked, and ignored — it never
  // appears in the resolution output.
  if (config.$schema !== undefined && typeof config.$schema !== 'string') {
    throw new ConfigValidationError('$schema must be a string');
  }

  const resolvedLanguages = validateLanguages(config.languages);
  const protectedPaths =
    config.protectedPaths !== undefined ? validateProtectedPaths(config.protectedPaths) : undefined;
  const adapters = config.adapters !== undefined ? validateAdapters(config.adapters) : undefined;
  const split =
    config.disciplines !== undefined ? validateDisciplines(config.disciplines) : undefined;
  const disciplines = split?.judged;
  const drafts = split !== undefined && split.drafts.length > 0 ? split.drafts : undefined;
  const logPath = config.telemetry !== undefined ? validateTelemetry(config.telemetry) : undefined;
  const witness = config.witness !== undefined ? validateWitness(config.witness) : undefined;

  return {
    languages: resolvedLanguages,
    ...(protectedPaths !== undefined && { protectedPaths }),
    ...(adapters !== undefined && { adapters }),
    telemetry: {
      logPath: logPath ?? DEFAULT_TELEMETRY_LOG_PATH,
    },
    ...(disciplines !== undefined && { disciplines }),
    ...(drafts !== undefined && { drafts }),
    ...(witness !== undefined && { witness }),
  };
}
