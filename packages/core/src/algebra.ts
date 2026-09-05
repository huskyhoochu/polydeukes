/**
 * `algebra.ts` — the shape of one algebra declaration: five blocks, a closed relation
 * position, a closed binary combinator position, and an open unary extraction vocabulary.
 *
 * The module knows no judgment. It runs no extraction and evaluates no relation; the
 * kernel expansion laws quoted on each relation branch below are comments, never code.
 */

import { validateMechanism } from './catalogue.ts';
import { isPlainObject } from './is-plain-object.ts';
import { FIXED_SOURCE_NAMES } from './source-names.ts';
import {
  ConfigValidationError,
  isNonEmptyString,
  isStringArray,
  rejectUncompilableRegex,
  rejectUnknownKeys,
} from './validation.ts';

/** The relation position, closed. This tuple is the single source of the list. */
export const RELATION_NAMES = [
  'empty',
  'nonEmpty',
  'equal',
  'subset',
  'implies',
  'ordered',
  'unchanged',
] as const;

/** One of the seven relation names — the closed vocabulary of the relation position. */
export type RelationName = (typeof RELATION_NAMES)[number];

/** The binary world-combining position, closed. Anything else is a unary step. */
export const BINARY_COMBINATOR_NAMES = ['union', 'onlyIn', 'intersect'] as const;

/**
 * What a missing source does: refuse the declaration, let it pass unjudged, or read the
 * absence as an empty item list and judge on.
 */
export const SUPPLY_POLICIES = ['error', 'pass', 'empty'] as const;

/**
 * The paired source name. `empty` is a property of a single source: `state` holds a
 * before/after pair that only `unchanged` reads, and an absent pair is not a pair of empties.
 */
const PAIRED_SOURCE_NAME = 'state';

/** The kind position of a `sources` entry, closed. Each entry carries exactly one of them. */
export const SOURCE_KINDS = ['file', 'sidecar', 'transcript'] as const;

/**
 * `RelationDecl` — the relation position of one relate entry, one branch per name.
 *
 * Every name references extract names declared in the same declaration; `equal` is the
 * only two-sided branch. The kernel expansion quoted on each branch is a comment — the
 * engine owns the semantics, this module only the shape.
 */
export type RelationDecl =
  /** `empty` — the extraction produced no element. The primitive. */
  | { op: 'empty'; of: string }
  /** `nonEmpty` — expands to ¬empty. */
  | { op: 'nonEmpty'; of: string }
  /** `equal` — expands to subset in both directions; the only two-sided relation. */
  | { op: 'equal'; of: [string, string] }
  /** `subset` — `of` ⊆ `in`. The primitive. */
  | { op: 'subset'; of: string; in: string }
  /** `implies` — expands to a subset of the two key projections. */
  | { op: 'implies'; of: string; requires: string }
  /** `ordered` — adjacent pairs are monotone; `strict` forbids equal neighbours. */
  | { op: 'ordered'; of: string; strict?: boolean }
  /** `unchanged` — expands to equal over the keys the two states share. */
  | { op: 'unchanged'; of: string };

/** A binary world combinator — the closed step kind that joins two extractions. */
export type BinaryStep =
  | { op: 'union'; of: [string, string] }
  | { op: 'onlyIn'; of: string; notIn: string }
  | { op: 'intersect'; of: [string, string] };

/** Open vocabulary — a name outside the three combinators; its arguments pass through. */
export type UnaryStep = { op: string; [arg: string]: unknown };

/** One pipeline step: an open unary step or a closed binary combinator. */
export type ExtractStep = UnaryStep | BinaryStep;

/** The `extract` block — named pipelines, each a non-empty step list. */
export type ExtractBlock = Record<string, ExtractStep[]>;

/** The `scope` block — which calls a declaration applies to, by constant regex over a source. */
export type ScopeBlock = {
  source: string;
  include?: string[];
  exclude?: string[];
  excludeIgnoreCase?: boolean;
};

/** One supply policy — the closed value position of a `supply` entry. */
export type SupplyPolicy = (typeof SUPPLY_POLICIES)[number];

/**
 * The `supply` block — per source name, what its absence does: `error` refuses, `pass` skips,
 * `empty` reads the absence as an empty item list and judges on.
 */
export type SupplyBlock = Record<string, SupplyPolicy>;

/**
 * The `sources` block — per source name, what outside the target it stands for.
 *
 * A `file` path is repo-relative and the supply layer joins it onto the root, which is why an
 * absolute path and a `..` segment are refused here rather than at read time. A `sidecar`
 * binding names a channel the surface supplies and a `transcript` binding the session's
 * conversation history; the location of either is the host's fact, not the declaration's, so
 * the value is the marker `true` and never a path.
 */
export type SourcesBlock = Record<
  string,
  { file: string } | { sidecar: true } | { transcript: true }
>;

/**
 * `RelateEntry` — one (extract name, relation) pairing with its break text.
 *
 * Exactly one of `message` and `messageBySide`; the latter only on `equal`, the one relation
 * with two sides.
 */
export type RelateEntry = { id: string; relation: RelationDecl } & (
  | { message: string }
  | { messageBySide: { left: string; right: string } }
);

/**
 * `WitnessBlock` — the valve standing after the verdict: its own extract pipelines and relate
 * entries in the same grammar. It sees the body's extract names; the body never sees its.
 */
export type WitnessBlock = { extract?: ExtractBlock; relate: RelateEntry[] };

/**
 * `AlgebraDeclaration` — one judgment written as data, `judge = relate ∘ extract`.
 *
 * Pure JSON shape validated by {@link validateAlgebraDeclaration}; `mechanism` names the
 * catalogue entry whose shape the declaration must match.
 */
export type AlgebraDeclaration = {
  discipline: string;
  mechanism: string;
  scope?: ScopeBlock;
  sources?: SourcesBlock;
  supply?: SupplyBlock;
  extract: ExtractBlock;
  relate: RelateEntry[];
  witness?: WitnessBlock;
};

/** One element for which the relation does not hold. The engine fixes the rest of the shape. */
export type Witness = { readonly value: unknown };

/**
 * An empty list means the relation holds. The order preserves the extraction's input
 * order — the premise on which two surfaces reach the same verdict.
 */
export type Witnesses = readonly Witness[];

const DECLARATION_KEYS: ReadonlySet<string> = new Set([
  'discipline',
  'mechanism',
  'scope',
  'sources',
  'supply',
  'extract',
  'relate',
  'witness',
]);
const SCOPE_KEYS: ReadonlySet<string> = new Set([
  'source',
  'include',
  'exclude',
  'excludeIgnoreCase',
]);
const RELATE_ENTRY_KEYS: ReadonlySet<string> = new Set([
  'id',
  'relation',
  'message',
  'messageBySide',
]);
const MESSAGE_BY_SIDE_KEYS: ReadonlySet<string> = new Set(['left', 'right']);
const WITNESS_KEYS: ReadonlySet<string> = new Set(['extract', 'relate']);

/** The argument keys each relation branch admits, `op` included. */
const RELATION_KEYS: Record<RelationName, ReadonlySet<string>> = {
  empty: new Set(['op', 'of']),
  nonEmpty: new Set(['op', 'of']),
  equal: new Set(['op', 'of']),
  subset: new Set(['op', 'of', 'in']),
  implies: new Set(['op', 'of', 'requires']),
  ordered: new Set(['op', 'of', 'strict']),
  unchanged: new Set(['op', 'of']),
};

const COMBINATOR_KEYS: Record<(typeof BINARY_COMBINATOR_NAMES)[number], ReadonlySet<string>> = {
  union: new Set(['op', 'of']),
  onlyIn: new Set(['op', 'of', 'notIn']),
  intersect: new Set(['op', 'of']),
};

function isCombinatorName(op: string): op is (typeof BINARY_COMBINATOR_NAMES)[number] {
  return (BINARY_COMBINATOR_NAMES as readonly string[]).includes(op);
}

/** The names a rejection message lists so the author sees what is admitted. */
function quotedList(names: readonly string[]): string {
  return names.map((name) => `'${name}'`).join(', ');
}

/**
 * The source names a scope regex can be read over: the fixed names whose value is a string,
 * plus this declaration's own `file` bindings. `changes` is a list and `state` a pair, and a
 * channel is the surface's JSON text — a regex over any of them matches nothing, so a
 * declaration scoped on one is refused here rather than answering zero worlds at runtime.
 */
const STRING_VALUED_FIXED_SOURCES = ['target.path', 'pre', 'post', 'command'] as const;

function validateScope(scope: unknown, sources: unknown, location: string): void {
  if (!isPlainObject(scope)) {
    throw new ConfigValidationError(`${location} scope must be an object`);
  }
  rejectUnknownKeys(scope, SCOPE_KEYS, `${location} scope`);
  if (!isNonEmptyString(scope.source)) {
    throw new ConfigValidationError(`${location} scope.source must be a non-empty string`);
  }
  const binding = isPlainObject(sources) ? sources[scope.source] : undefined;
  const isFileSource = isPlainObject(binding) && typeof binding.file === 'string';
  if (!(STRING_VALUED_FIXED_SOURCES as readonly string[]).includes(scope.source) && !isFileSource) {
    throw new ConfigValidationError(
      `${location} scope.source '${scope.source}' is not a string-valued source; scope admits ${quotedList(STRING_VALUED_FIXED_SOURCES)}, or a file source`,
    );
  }
  for (const key of ['include', 'exclude'] as const) {
    const patterns = scope[key];
    if (patterns === undefined) continue;
    if (!isStringArray(patterns)) {
      throw new ConfigValidationError(`${location} scope.${key} must be an array of strings`);
    }
    for (const pattern of patterns) {
      rejectUncompilableRegex(pattern, `${location} scope.${key}`);
    }
  }
  if (scope.excludeIgnoreCase !== undefined && typeof scope.excludeIgnoreCase !== 'boolean') {
    throw new ConfigValidationError(`${location} scope.excludeIgnoreCase must be a boolean`);
  }
}

/**
 * Validate one `sources` entry's path: a repo-relative string the supply layer can join
 * onto the root. `..` is rejected as a whole SEGMENT, so a name that merely contains two
 * dots (`a..b`) stays legal while `a/../b` cannot climb out of the repository.
 */
function validateSourceFile(file: unknown, location: string): void {
  if (!isNonEmptyString(file)) {
    throw new ConfigValidationError(`${location}.file must be a non-empty string`);
  }
  if (file.startsWith('/')) {
    throw new ConfigValidationError(`${location}.file must be a repo-relative path, not '${file}'`);
  }
  if (file.split('/').includes('..')) {
    throw new ConfigValidationError(`${location}.file carries a '..' segment: '${file}'`);
  }
}

function validateSources(sources: unknown, location: string): void {
  if (!isPlainObject(sources)) {
    throw new ConfigValidationError(`${location}.sources must be an object`);
  }
  for (const [name, entry] of Object.entries(sources)) {
    if (name.length === 0) {
      throw new ConfigValidationError(`${location}.sources carries an empty source name`);
    }
    if ((FIXED_SOURCE_NAMES as readonly string[]).includes(name)) {
      throw new ConfigValidationError(
        `${location}.sources.${name} shadows the world's own source of that name — the fixed names are ${quotedList(FIXED_SOURCE_NAMES)}`,
      );
    }
    const where = `${location}.sources.${name}`;
    if (!isPlainObject(entry)) {
      throw new ConfigValidationError(`${where} must be an object naming one kind`);
    }
    const kinds = Object.keys(entry).filter((key) =>
      (SOURCE_KINDS as readonly string[]).includes(key),
    );
    if (kinds.length !== 1) {
      throw new ConfigValidationError(
        `${where} must name exactly one kind, one of ${quotedList(SOURCE_KINDS)}`,
      );
    }
    rejectUnknownKeys(entry, new Set(SOURCE_KINDS), where);
    const kind = kinds[0] as (typeof SOURCE_KINDS)[number];
    if (kind === 'sidecar' || kind === 'transcript') {
      // The marker carries no information beyond the kind, so anything but the literal
      // `true` would be a value the supply layer has to interpret.
      if (entry[kind] !== true) {
        throw new ConfigValidationError(`${where}.${kind} must be the literal true`);
      }
      continue;
    }
    validateSourceFile(entry.file, where);
  }
}

/**
 * Validate the `supply` block: every key names a source this declaration can be missing.
 *
 * The universe of source names is the fixed seven plus whatever `sources` binds, and it is
 * closed, so a key outside it is a name nothing supplies — a misspelling whose policy never
 * applies while the real source falls to the default.
 */
function validateSupply(supply: unknown, sources: unknown, location: string): void {
  if (!isPlainObject(supply)) {
    throw new ConfigValidationError(`${location} supply must be an object`);
  }
  const declared = isPlainObject(sources) ? Object.keys(sources) : [];
  for (const [source, policy] of Object.entries(supply)) {
    if (!(FIXED_SOURCE_NAMES as readonly string[]).includes(source) && !declared.includes(source)) {
      const bindings =
        declared.length === 0 ? 'and this declaration binds none' : `or ${quotedList(declared)}`;
      throw new ConfigValidationError(
        `${location} supply names the source '${source}', which is neither one of ${quotedList(FIXED_SOURCE_NAMES)} ${bindings}`,
      );
    }
    if (!(SUPPLY_POLICIES as readonly unknown[]).includes(policy)) {
      throw new ConfigValidationError(
        `${location} supply.${source} is '${String(policy)}' — must be one of ${quotedList(SUPPLY_POLICIES)}`,
      );
    }
    if (policy === 'empty' && source === PAIRED_SOURCE_NAME) {
      throw new ConfigValidationError(
        `${location} supply.${source}: 'empty' does not apply to the paired source — it holds a before/after pair, and an absent pair is not two empty states`,
      );
    }
  }
}

/**
 * Validate one pipeline step and return the extract names it references.
 *
 * Combinator discrimination is name-first, shape-second: a step named by one of the three
 * is read as that combinator whatever its arguments, so a reserved name can never leak into
 * the open unary vocabulary. A name outside the three that references two extractions
 * (an array `of`, or a `notIn`) is an unknown combinator, not a unary step.
 */
function validateStep(step: unknown, location: string): string[] {
  if (!isPlainObject(step)) {
    throw new ConfigValidationError(`${location} must be an object`);
  }
  if (!isNonEmptyString(step.op)) {
    throw new ConfigValidationError(`${location} op must be a non-empty string`);
  }
  const op = step.op;

  if (!isCombinatorName(op)) {
    if (Array.isArray(step.of) || step.notIn !== undefined) {
      throw new ConfigValidationError(
        `${location} op '${op}' references two extractions but is not one of ${quotedList(BINARY_COMBINATOR_NAMES)}`,
      );
    }
    return [];
  }

  rejectUnknownKeys(step, COMBINATOR_KEYS[op], `${location} (${op})`);
  if (op === 'onlyIn') {
    if (!isNonEmptyString(step.of) || !isNonEmptyString(step.notIn)) {
      throw new ConfigValidationError(
        `${location} '${op}' takes a string 'of' and a string 'notIn'`,
      );
    }
    if (step.of === step.notIn) {
      throw new ConfigValidationError(
        `${location} '${op}' names '${step.of}' on both sides — the result is always empty`,
      );
    }
    return [step.of, step.notIn];
  }
  const pair = step.of;
  if (!isStringArray(pair) || pair.length !== 2 || !pair.every(isNonEmptyString)) {
    throw new ConfigValidationError(`${location} '${op}' takes 'of' as two extract names`);
  }
  const [left, right] = pair as [string, string];
  if (left === right) {
    throw new ConfigValidationError(
      `${location} '${op}' names '${left}' on both sides — the result is that extraction itself`,
    );
  }
  return [left, right];
}

/** Validate one extract block, returning each pipeline's outgoing references. */
function validateExtract(extract: unknown, location: string, label: string): Map<string, string[]> {
  if (!isPlainObject(extract)) {
    throw new ConfigValidationError(`${location} ${label} must be an object`);
  }
  const references = new Map<string, string[]>();
  for (const [name, steps] of Object.entries(extract)) {
    const where = `${location} ${label}.${name}`;
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new ConfigValidationError(`${where} must be a non-empty array of steps`);
    }
    const outgoing: string[] = [];
    steps.forEach((step, index) => {
      const referenced = validateStep(step, `${where}[${index}]`);
      if (referenced.length > 0 && index !== 0) {
        throw new ConfigValidationError(
          `${where}[${index}] a combinator stands only as the first step of a pipeline`,
        );
      }
      outgoing.push(...referenced);
    });
    references.set(name, outgoing);
  }
  return references;
}

/** Validate the relation and return the extract names it references. */
function validateRelation(
  relation: unknown,
  location: string,
): { op: RelationName; refs: string[] } {
  if (!isPlainObject(relation)) {
    throw new ConfigValidationError(`${location} relation must be an object`);
  }
  const op = relation.op;
  if (typeof op !== 'string' || !(RELATION_NAMES as readonly string[]).includes(op)) {
    throw new ConfigValidationError(
      `${location} relation op is '${String(op)}' — must be one of ${quotedList(RELATION_NAMES)}`,
    );
  }
  const name = op as RelationName;
  rejectUnknownKeys(relation, RELATION_KEYS[name], `${location} relation (${name})`);

  if (name === 'equal') {
    const pair = relation.of;
    if (!isStringArray(pair) || pair.length !== 2 || !pair.every(isNonEmptyString)) {
      throw new ConfigValidationError(`${location} relation equal takes 'of' as two extract names`);
    }
    const [left, right] = pair as [string, string];
    if (left === right) {
      throw new ConfigValidationError(
        `${location} relation equal names '${left}' on both sides — it can never break`,
      );
    }
    return { op: name, refs: [left, right] };
  }

  if (!isNonEmptyString(relation.of)) {
    throw new ConfigValidationError(`${location} relation ${name} needs 'of' as an extract name`);
  }
  const refs = [relation.of];

  if (name === 'subset') {
    if (!isNonEmptyString(relation.in)) {
      throw new ConfigValidationError(`${location} relation subset needs 'in' as an extract name`);
    }
    refs.push(relation.in);
  }
  if (name === 'implies') {
    if (!isNonEmptyString(relation.requires)) {
      throw new ConfigValidationError(
        `${location} relation implies needs 'requires' as an extract name`,
      );
    }
    refs.push(relation.requires);
  }
  if (name === 'ordered' && relation.strict !== undefined && typeof relation.strict !== 'boolean') {
    throw new ConfigValidationError(`${location} relation ordered strict must be a boolean`);
  }
  return { op: name, refs };
}

/** Validate one entry; `ids` accumulates across the body and the witness block. */
function validateRelateEntry(
  entry: unknown,
  location: string,
  known: ReadonlySet<string>,
  ids: Set<string>,
): void {
  if (!isPlainObject(entry)) {
    throw new ConfigValidationError(`${location} must be an object`);
  }
  rejectUnknownKeys(entry, RELATE_ENTRY_KEYS, location);
  if (!isNonEmptyString(entry.id)) {
    throw new ConfigValidationError(`${location} id must be a non-empty string`);
  }
  const id = entry.id;
  if (ids.has(id)) {
    throw new ConfigValidationError(`${location} duplicates the entry id '${id}'`);
  }
  ids.add(id);

  const { op, refs } = validateRelation(entry.relation, `${location} '${id}'`);
  for (const name of refs) {
    if (!known.has(name)) {
      throw new ConfigValidationError(
        `${location} '${id}' references '${name}', which no extract in scope defines`,
      );
    }
  }

  const hasMessage = entry.message !== undefined;
  const hasBySide = entry.messageBySide !== undefined;
  if (hasMessage === hasBySide) {
    throw new ConfigValidationError(
      `${location} '${id}' needs exactly one of 'message' and 'messageBySide'`,
    );
  }
  if (hasMessage && !isNonEmptyString(entry.message)) {
    throw new ConfigValidationError(`${location} '${id}' message must be a non-empty string`);
  }
  if (hasBySide) {
    if (op !== 'equal') {
      throw new ConfigValidationError(
        `${location} '${id}' carries messageBySide on ${op} — only equal has two sides`,
      );
    }
    const bySide = entry.messageBySide;
    if (!isPlainObject(bySide)) {
      throw new ConfigValidationError(`${location} '${id}' messageBySide must be an object`);
    }
    rejectUnknownKeys(bySide, MESSAGE_BY_SIDE_KEYS, `${location} '${id}' messageBySide`);
    if (!isNonEmptyString(bySide.left) || !isNonEmptyString(bySide.right)) {
      throw new ConfigValidationError(
        `${location} '${id}' messageBySide needs a non-empty 'left' and 'right'`,
      );
    }
  }
}

function validateRelate(
  relate: unknown,
  location: string,
  known: ReadonlySet<string>,
  ids: Set<string>,
): void {
  if (!Array.isArray(relate) || relate.length === 0) {
    throw new ConfigValidationError(`${location} relate must be a non-empty array`);
  }
  relate.forEach((entry, index) => {
    validateRelateEntry(entry, `${location} relate[${index}]`, known, ids);
  });
}

/**
 * Refuse a combinator reference that does not resolve, and any cycle it takes part in.
 *
 * A self-edge is the shortest cycle, so a plain existence check passes it; only the
 * reachability walk below finds either that or a two-pipeline loop.
 */
function checkExtractGraph(
  references: Map<string, string[]>,
  known: ReadonlySet<string>,
  location: string,
): void {
  for (const [name, outgoing] of references) {
    for (const target of outgoing) {
      if (!known.has(target)) {
        throw new ConfigValidationError(
          `${location} '${name}' references '${target}', which no extract defines`,
        );
      }
    }
  }
  const visiting = new Set<string>();
  const settled = new Set<string>();
  const walk = (name: string): void => {
    if (settled.has(name)) return;
    if (visiting.has(name)) {
      throw new ConfigValidationError(`${location} '${name}' takes part in a reference cycle`);
    }
    visiting.add(name);
    for (const target of references.get(name) ?? []) {
      walk(target);
    }
    visiting.delete(name);
    settled.add(name);
  };
  for (const name of references.keys()) {
    walk(name);
  }
}

/**
 * Validate one algebra declaration's shape, returning it unchanged.
 *
 * Every violation throws {@link ConfigValidationError} with a message starting at
 * `location`, so a caller validating many declarations sees which one failed.
 */
export function validateAlgebraDeclaration(
  input: unknown,
  location = 'declaration',
): AlgebraDeclaration {
  if (!isPlainObject(input)) {
    throw new ConfigValidationError(`${location} must be an object`);
  }
  rejectUnknownKeys(input, DECLARATION_KEYS, location);

  if (!isNonEmptyString(input.discipline)) {
    throw new ConfigValidationError(`${location} discipline must be a non-empty string`);
  }
  if (!isNonEmptyString(input.mechanism)) {
    throw new ConfigValidationError(`${location} mechanism must be a non-empty string`);
  }
  if (input.sources !== undefined) validateSources(input.sources, location);
  if (input.scope !== undefined) validateScope(input.scope, input.sources, location);
  if (input.supply !== undefined) validateSupply(input.supply, input.sources, location);

  if (input.extract === undefined) {
    throw new ConfigValidationError(`${location} needs an extract block`);
  }
  const bodyReferences = validateExtract(input.extract, location, 'extract');
  const bodyNames = new Set(bodyReferences.keys());
  checkExtractGraph(bodyReferences, bodyNames, `${location} extract`);

  const ids = new Set<string>();
  if (input.relate === undefined) {
    throw new ConfigValidationError(`${location} needs a relate array`);
  }
  validateRelate(input.relate, location, bodyNames, ids);

  if (input.witness !== undefined) {
    const witness = input.witness;
    if (!isPlainObject(witness)) {
      throw new ConfigValidationError(`${location} witness must be an object`);
    }
    rejectUnknownKeys(witness, WITNESS_KEYS, `${location} witness`);
    // The witness sees the body's extract names as well as its own; the body never sees
    // the witness's.
    const witnessReferences =
      witness.extract === undefined
        ? new Map<string, string[]>()
        : validateExtract(witness.extract, location, 'witness.extract');
    for (const name of witnessReferences.keys()) {
      if (bodyNames.has(name)) {
        throw new ConfigValidationError(
          `${location} witness.extract '${name}' shadows the body extract of the same name — the two blocks share one namespace`,
        );
      }
    }
    const witnessNames = new Set([...bodyNames, ...witnessReferences.keys()]);
    checkExtractGraph(witnessReferences, witnessNames, `${location} witness.extract`);
    validateRelate(witness.relate, `${location} witness`, witnessNames, ids);
  }

  const declaration = input as AlgebraDeclaration;
  validateMechanism(declaration, location);
  return declaration;
}
