/**
 * `catalogue.ts` — the eighteen judgment-mechanism names and the shape each one admits.
 *
 * A mechanism name is a coordinate the machine checks, not a label: {@link deriveShape}
 * reads a declaration's shape from its syntax alone — which sources its `source` steps
 * name, which relations its body relates, whether it carries a witness block — and
 * {@link validateMechanism} refuses a declaration whose derived shape falls outside the
 * spec of the name it carries. Nothing here runs an extraction or opens a world.
 */

import type { AlgebraDeclaration, ExtractBlock, RelationName } from './algebra.ts';
import { isPlainObject } from './is-plain-object.ts';
import { FIXED_SOURCE_NAMES } from './source-names.ts';
import { ConfigValidationError } from './validation.ts';

/** The four axes a declaration can read, closed. This tuple is the single source of the list. */
export const AXIS_NAMES = ['change', 'actor', 'world', 'history'] as const;

/** One of the four axes — the closed vocabulary of the axis position. */
export type Axis = (typeof AXIS_NAMES)[number];

/** The judgment mechanisms, closed. A name outside this tuple is refused, never coerced. */
export const MECHANISM_NAMES = [
  'pairing',
  'companion',
  'monotonic-order',
  'fingerprint-sync',
  'producer-owned',
  'self-absolution-ban',
  'actor-scope',
  'precedent',
  'phase-order',
  'turn-locality',
  'stated-ground',
  'controlled-vocabulary',
  'naming',
  'added-only',
  'one-way-marker',
  'delegated-scope',
  'scoped-valve',
  'forbidden-command',
] as const;

/** One of the eighteen mechanism names. */
export type MechanismName = (typeof MECHANISM_NAMES)[number];

/**
 * What one mechanism name admits: the axes it may read, the relations it may relate, and
 * the structural markers it requires.
 *
 * `requiresWitness` asks for the valve block; `scopeSource` pins what the declaration may
 * scope on; `reserved` names what will define the name, and stands in place of a
 * shape — a reserved name admits no declaration at all.
 */
export type MechanismShape = {
  axes: ReadonlySet<Axis>;
  relations: ReadonlySet<RelationName>;
  requiresWitness?: true;
  scopeSource?: 'target.path' | 'command';
  reserved?: string;
};

/**
 * The blocks {@link deriveShape} reads. A declaration names itself with its `discipline`,
 * and an entry under `declare` names itself with the entry id instead — the shape is the
 * same either way, so the derivation takes the blocks rather than the whole document.
 */
export type DerivableDeclaration = Pick<
  AlgebraDeclaration,
  'extract' | 'relate' | 'sources' | 'witness'
>;

/** The derived shape of one declaration: what its syntax says it reads and relates. */
export type DerivedShape = {
  axes: ReadonlySet<Axis>;
  relations: ReadonlySet<RelationName>;
  witness: boolean;
};

const CHANGE: ReadonlySet<Axis> = new Set<Axis>(['change']);
const WORLD: ReadonlySet<Axis> = new Set<Axis>(['world']);
const ACTOR: ReadonlySet<Axis> = new Set<Axis>(['actor']);
const HISTORY: ReadonlySet<Axis> = new Set<Axis>(['history']);
const HISTORY_WORLD: ReadonlySet<Axis> = new Set<Axis>(['history', 'world']);
const CHANGE_WORLD: ReadonlySet<Axis> = new Set<Axis>(['change', 'world']);

/** The one fixed source name whose value is the actor rather than the change. */
const ACTOR_SOURCE = 'actor';

/** Every name's spec. The `Record` type pins the keys to {@link MECHANISM_NAMES}. */
export const MECHANISM_SHAPES: Record<MechanismName, MechanismShape> = {
  pairing: { axes: WORLD, relations: new Set<RelationName>(['equal']) },
  companion: { axes: CHANGE_WORLD, relations: new Set<RelationName>(['implies']) },
  'monotonic-order': { axes: CHANGE_WORLD, relations: new Set<RelationName>(['ordered']) },
  'fingerprint-sync': { axes: WORLD, relations: new Set<RelationName>(['equal']) },
  'producer-owned': { axes: ACTOR, relations: new Set<RelationName>(['empty', 'nonEmpty']) },
  'self-absolution-ban': {
    axes: CHANGE,
    relations: new Set<RelationName>(['unchanged', 'empty']),
  },
  'actor-scope': { axes: ACTOR, relations: new Set<RelationName>(['empty', 'nonEmpty']) },
  // The spawn sidecar is a world-axis channel carrying session history, so a precedent
  // read off it is still a precedent; the transcript source carries the history axis.
  precedent: { axes: HISTORY_WORLD, relations: new Set<RelationName>(['nonEmpty']) },
  'phase-order': { axes: HISTORY, relations: new Set<RelationName>(['ordered']) },
  'turn-locality': { axes: HISTORY, relations: new Set<RelationName>(['nonEmpty']) },
  'stated-ground': { axes: HISTORY, relations: new Set<RelationName>(['nonEmpty']) },
  'controlled-vocabulary': { axes: CHANGE_WORLD, relations: new Set<RelationName>(['subset']) },
  naming: {
    axes: CHANGE,
    relations: new Set<RelationName>(['empty', 'nonEmpty']),
    scopeSource: 'target.path',
  },
  'added-only': { axes: CHANGE, relations: new Set<RelationName>(['empty']) },
  'one-way-marker': { axes: CHANGE, relations: new Set<RelationName>(['subset']) },
  'delegated-scope': {
    axes: new Set<Axis>(),
    relations: new Set<RelationName>(),
    reserved: 'the definition-time evaluator',
  },
  'scoped-valve': {
    axes: new Set(AXIS_NAMES),
    relations: new Set<RelationName>([
      'empty',
      'nonEmpty',
      'equal',
      'subset',
      'implies',
      'ordered',
      'unchanged',
    ]),
    requiresWitness: true,
  },
  // A command-line ban scopes on the command it reads: a world with no shell call carries
  // no `command`, and a scope-less reader would refuse every file-changing call as unjudgeable.
  'forbidden-command': {
    axes: CHANGE,
    relations: new Set<RelationName>(['empty']),
    scopeSource: 'command',
  },
};

/** The names a rejection message lists so the author sees what is admitted. */
function quotedList(names: readonly string[]): string {
  return names.map((name) => `'${name}'`).join(', ');
}

/** Whether one `sources` binding names the session history rather than a world value. */
function isTranscriptSource(binding: unknown): boolean {
  return isPlainObject(binding) && binding.transcript === true;
}

/** The source names one extract block's `source` steps name, in declaration order. */
function sourceNamesOf(extract: ExtractBlock | undefined): string[] {
  if (extract === undefined) return [];
  const names: string[] = [];
  for (const steps of Object.values(extract)) {
    for (const step of steps) {
      if (isPlainObject(step) && step.op === 'source' && typeof step.of === 'string') {
        names.push(step.of);
      }
    }
  }
  return names;
}

/** Every source name the body and the valve read, in declaration order. */
function sourceNames(declaration: DerivableDeclaration): string[] {
  return [...sourceNamesOf(declaration.extract), ...sourceNamesOf(declaration.witness?.extract)];
}

/**
 * Read one declaration's shape from its syntax (pure).
 *
 * The axis of a source name is where the name comes from: the fixed name `actor` is the
 * actor axis and the other six fixed names the change axis, a name the declaration's own
 * `sources` block binds is the world axis unless the binding is of the transcript kind,
 * which is the history axis. A name that is neither is refused by
 * {@link validateMechanism} — skipping it would derive the empty set, which is a subset of
 * every spec, and an axis-restricted name would load on a typo. The witness block's
 * `extract` reads a world too, so its source steps count; its `relate` does not, because the
 * valve's relation is not the judgment's.
 */
export function deriveShape(declaration: DerivableDeclaration): DerivedShape {
  const bindings = declaration.sources ?? {};
  const axes = new Set<Axis>();
  for (const name of sourceNames(declaration)) {
    if ((FIXED_SOURCE_NAMES as readonly string[]).includes(name)) {
      axes.add(name === ACTOR_SOURCE ? 'actor' : 'change');
    } else if (name in bindings) {
      axes.add(isTranscriptSource(bindings[name]) ? 'history' : 'world');
    }
  }
  const relations = new Set<RelationName>(
    declaration.relate.map((entry) => entry.relation.op as RelationName),
  );
  return { axes, relations, witness: declaration.witness !== undefined };
}

/** Refuse a `source` step naming neither a fixed source nor a binding of this declaration. */
function checkSourceNames(declaration: DerivableDeclaration, location: string): void {
  const declared = new Set(Object.keys(declaration.sources ?? {}));
  for (const name of sourceNames(declaration)) {
    if ((FIXED_SOURCE_NAMES as readonly string[]).includes(name) || declared.has(name)) continue;
    const bindings =
      declared.size === 0 ? 'and this declaration binds none' : `or ${quotedList([...declared])}`;
    throw new ConfigValidationError(
      `${location} reads the source '${name}', which is neither one of ${quotedList(FIXED_SOURCE_NAMES)} ${bindings}`,
    );
  }
}

/**
 * Check the declaration's `mechanism` against the catalogue (throws on a mismatch).
 *
 * The order is the author's repair order: an unknown name first (nothing else is
 * meaningful without a spec), then the reserved name, then the structural markers, then
 * the axes and relations the derived shape must stay inside. Membership is subset, not
 * equality — a name admitting two relations accepts a declaration using one of them.
 */
export function validateMechanism(declaration: AlgebraDeclaration, location: string): void {
  const mechanism = declaration.mechanism;
  if (!(MECHANISM_NAMES as readonly string[]).includes(mechanism)) {
    throw new ConfigValidationError(
      `${location} mechanism is '${mechanism}' — must be one of ${quotedList(MECHANISM_NAMES)}`,
    );
  }
  const spec = MECHANISM_SHAPES[mechanism as MechanismName];
  if (spec.reserved !== undefined) {
    throw new ConfigValidationError(
      `${location} mechanism '${mechanism}' is reserved for ${spec.reserved}, which does not exist yet`,
    );
  }

  checkSourceNames(declaration, location);
  const shape = deriveShape(declaration);

  if (spec.requiresWitness === true && !shape.witness) {
    throw new ConfigValidationError(
      `${location} mechanism '${mechanism}' needs a witness block — the valve is its whole shape`,
    );
  }
  if (spec.scopeSource !== undefined && declaration.scope?.source !== spec.scopeSource) {
    const actual =
      declaration.scope === undefined
        ? 'this declaration has no scope block'
        : `this declaration scopes on '${declaration.scope.source}'`;
    throw new ConfigValidationError(
      `${location} mechanism '${mechanism}' scopes on '${spec.scopeSource}' — ${actual}`,
    );
  }

  const outsideAxes = [...shape.axes].filter((axis) => !spec.axes.has(axis));
  const outsideRelations = [...shape.relations].filter((relation) => !spec.relations.has(relation));
  if (outsideAxes.length > 0 || outsideRelations.length > 0) {
    throw new ConfigValidationError(
      `${location} mechanism '${mechanism}' expects relations ${quotedList([...spec.relations])} on axes ${quotedList([...spec.axes])}; this declaration relates ${quotedList([...shape.relations])} on ${quotedList([...shape.axes])}`,
    );
  }
}
