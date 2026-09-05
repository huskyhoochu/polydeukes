/**
 * The declaration engine — `judge = relate ∘ extract` as a pure function of one `World`.
 *
 * `compileDeclaration` resolves a shape-validated declaration against the extract registry
 * and answers either something judgeable or a config fault naming where the declaration is
 * wrong; it never throws. `judgeDeclaration` then runs the extraction pipelines over a
 * world value and evaluates the relations, answering a verdict. `witnessOpens` evaluates
 * the witness block on its own, so a caller can let a satisfied condition stand after the
 * verdict without re-reading it.
 *
 * The engine knows nothing but its two arguments: no files, no tools, no session. Whatever
 * a host can express as named values in a `World` it can judge here.
 */

import type {
  AlgebraDeclaration,
  BinaryStep,
  ExtractStep,
  RelateEntry,
  RelationDecl,
  WitnessBlock,
} from '@polydeukes/core';
import { BINARY_COMBINATOR_NAMES } from '@polydeukes/core';
import {
  type ConfigFault,
  EXTRACT_STEPS,
  fault,
  type Items,
  type PairedItems,
  SupplyFailure,
  UNARY_STEP_NAMES,
  type World,
} from './extract-steps.js';
import {
  relateEmpty,
  relateEqual,
  relateImplies,
  relateNonEmpty,
  relateOrdered,
  relateSubset,
  relateUnchanged,
  type Witness,
  type WitnessWithBefore,
} from './relations.js';

export type { ConfigFault, Items, SessionSnapshot, World } from './extract-steps.js';
export { EXTRACT_STEPS, UNARY_STEP_NAMES } from './extract-steps.js';
export type { Witness } from './relations.js';

/** The world name a paired source reads: its value is `{ pre, post }`, one state each. */
const PAIRED_SOURCE = 'state';

/** One entry's failure: the text a human reads, and the elements that produced it. */
export type Break = {
  readonly id: string;
  readonly message: string;
  readonly witnesses: readonly Witness[];
};

/**
 * What one judgment answers. `not-applicable` separates the two ways a call goes unjudged —
 * outside the declaration's scope, or missing a source the declaration lets pass.
 */
export type DeclarationVerdict =
  | { readonly kind: 'pass' }
  | { readonly kind: 'broken'; readonly breaks: readonly Break[] }
  | {
      readonly kind: 'not-applicable';
      readonly reason: 'scope' | 'supply-pass';
      readonly source?: string;
    }
  | { readonly kind: 'supply-error'; readonly source: string; readonly reason: string };

type CompiledPipeline = {
  readonly name: string;
  readonly paired: boolean;
  readonly references: readonly string[];
  readonly combinator?: BinaryStep;
  readonly steps: readonly ExtractStep[];
};

type CompiledScope = {
  readonly source: string;
  readonly include: readonly RegExp[];
  readonly exclude: readonly RegExp[];
};

/** The opaque result of compiling one declaration; only this module reads inside it. */
export type CompiledDeclaration = {
  readonly pipelines: ReadonlyMap<string, CompiledPipeline>;
  readonly relate: readonly RelateEntry[];
  readonly supply: Readonly<Record<string, 'error' | 'pass' | 'empty'>>;
  readonly scope?: CompiledScope;
  readonly witness?: {
    readonly pipelines: ReadonlyMap<string, CompiledPipeline>;
    readonly relate: readonly RelateEntry[];
  };
};

function isFault(value: unknown): value is ConfigFault {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'config-fault'
  );
}

function isCombinator(step: ExtractStep): step is BinaryStep {
  return (BINARY_COMBINATOR_NAMES as readonly string[]).includes(step.op);
}

function combinatorReferences(step: BinaryStep): readonly string[] {
  return step.op === 'onlyIn' ? [step.of, step.notIn] : step.of;
}

/** Resolve one pipeline's steps against the registry, answering the fault of the first bad one. */
function compilePipeline(
  name: string,
  steps: readonly ExtractStep[],
  location: string,
): CompiledPipeline | ConfigFault {
  const [first, ...rest] = steps;
  if (first === undefined || (!isCombinator(first) && first.op !== 'source')) {
    const found = first === undefined ? 'an empty pipeline' : `'${first.op}'`;
    return fault(
      location,
      `a pipeline begins with 'source' or one of ${BINARY_COMBINATOR_NAMES.join(', ')} — found ${found}`,
    );
  }
  const combinator = isCombinator(first) ? first : undefined;
  const unarySteps = combinator === undefined ? steps : rest;

  for (const step of unarySteps) {
    const entry = EXTRACT_STEPS[step.op];
    if (entry === undefined) {
      return fault(
        location,
        `'${step.op}' is not a registered extract step — the registry carries ${UNARY_STEP_NAMES.join(', ')}`,
      );
    }
    const bad = entry.validate(step as Readonly<Record<string, unknown>>, location);
    if (bad !== undefined) return bad;
  }

  const paired = combinator === undefined && first.op === 'source' && first.of === PAIRED_SOURCE;
  return {
    name,
    paired,
    references: combinator === undefined ? [] : combinatorReferences(combinator),
    combinator,
    steps: unarySteps,
  };
}

function compileExtract(
  extract: Readonly<Record<string, ExtractStep[]>>,
  known: Map<string, CompiledPipeline>,
  location: string,
): ConfigFault | undefined {
  const added: CompiledPipeline[] = [];
  for (const [name, steps] of Object.entries(extract)) {
    const compiled = compilePipeline(name, steps, `${location} ${name}`);
    if (isFault(compiled)) return compiled;
    known.set(name, compiled);
    added.push(compiled);
  }
  for (const pipeline of added) {
    for (const reference of pipeline.references) {
      if (known.get(reference)?.paired === true) {
        return fault(
          `${location} ${pipeline.name}`,
          `'${pipeline.name}' combines '${reference}', which reads a before/after pair — a combinator takes single extractions`,
        );
      }
    }
  }
  return undefined;
}

/** The extract names a relation reads, and whether it takes a paired extraction. */
function relationReferences(relation: RelationDecl): readonly string[] {
  if (relation.op === 'equal') return relation.of;
  if (relation.op === 'subset') return [relation.of, relation.in];
  if (relation.op === 'implies') return [relation.of, relation.requires];
  return [relation.of];
}

function checkRelateShapes(
  relate: readonly RelateEntry[],
  pipelines: ReadonlyMap<string, CompiledPipeline>,
  location: string,
): ConfigFault | undefined {
  for (const entry of relate) {
    const wantsPair = entry.relation.op === 'unchanged';
    for (const name of relationReferences(entry.relation)) {
      const pipeline = pipelines.get(name);
      if (pipeline === undefined) {
        return fault(
          `${location} '${entry.id}'`,
          `'${entry.relation.op}' references '${name}', which no extract in scope defines`,
        );
      }
      const paired = pipeline.paired;
      if (paired === wantsPair) continue;
      return fault(
        `${location} '${entry.id}'`,
        wantsPair
          ? `'unchanged' compares a before/after pair, and '${name}' reads a single state`
          : `'${entry.relation.op}' takes a single extraction, and '${name}' reads a before/after pair`,
      );
    }
  }
  return undefined;
}

function compileRegexList(
  patterns: readonly string[] | undefined,
  flags: string,
  location: string,
): readonly RegExp[] | ConfigFault {
  const compiled: RegExp[] = [];
  for (const pattern of patterns ?? []) {
    try {
      compiled.push(new RegExp(pattern, flags));
    } catch {
      return fault(location, `cannot compile the expression '${pattern}'`);
    }
  }
  return compiled;
}

/** `compileDeclaration` input — the shape-validated declaration to resolve. */
export type CompileDeclarationSpec = { declaration: AlgebraDeclaration };

/**
 * Resolve a shape-validated declaration into something judgeable, or answer the first thing
 * wrong with it: a step outside the registry, an argument outside a step's closed keys, an
 * uncompilable expression, or a paired extraction where a single one belongs.
 */
export function compileDeclaration(
  spec: CompileDeclarationSpec,
): CompiledDeclaration | ConfigFault {
  const decl = spec.declaration;
  const pipelines = new Map<string, CompiledPipeline>();
  const extractFault = compileExtract(decl.extract, pipelines, `${decl.discipline} extract`);
  if (extractFault !== undefined) return extractFault;

  const relateFault = checkRelateShapes(decl.relate, pipelines, `${decl.discipline} relate`);
  if (relateFault !== undefined) return relateFault;

  let scope: CompiledScope | undefined;
  if (decl.scope !== undefined) {
    const where = `${decl.discipline} scope`;
    const include = compileRegexList(decl.scope.include, '', where);
    if (isFault(include)) return include;
    const exclude = compileRegexList(
      decl.scope.exclude,
      decl.scope.excludeIgnoreCase === true ? 'i' : '',
      where,
    );
    if (isFault(exclude)) return exclude;
    scope = { source: decl.scope.source, include, exclude };
  }

  const witness = compileWitness(decl.witness, pipelines, decl.discipline);
  if (isFault(witness)) return witness;

  return { pipelines, relate: decl.relate, supply: decl.supply ?? {}, scope, witness };
}

function compileWitness(
  block: WitnessBlock | undefined,
  bodyPipelines: ReadonlyMap<string, CompiledPipeline>,
  discipline: string,
): CompiledDeclaration['witness'] | ConfigFault {
  if (block === undefined) return undefined;
  const pipelines = new Map(bodyPipelines);
  if (block.extract !== undefined) {
    const bad = compileExtract(block.extract, pipelines, `${discipline} witness.extract`);
    if (bad !== undefined) return bad;
  }
  const relateFault = checkRelateShapes(block.relate, pipelines, `${discipline} witness relate`);
  if (relateFault !== undefined) return relateFault;
  return { pipelines, relate: block.relate };
}

/** A source absent from the world, or a value the pipeline could not read. */
type SupplyProblem =
  | { readonly kind: 'error'; readonly source: string; readonly reason: string }
  | { readonly kind: 'pass'; readonly source: string };

type Extraction = { readonly single?: Items; readonly pair?: PairedItems };

class Extractor {
  private readonly cache = new Map<string, Extraction>();
  problem: SupplyProblem | undefined;

  constructor(
    private readonly pipelines: ReadonlyMap<string, CompiledPipeline>,
    private readonly supply: Readonly<Record<string, 'error' | 'pass' | 'empty'>>,
    private readonly world: World,
  ) {}

  /** The pipeline's items, or `undefined` once a supply problem has ended the judgment. */
  resolve(name: string): Extraction | undefined {
    if (this.problem !== undefined) return undefined;
    const cached = this.cache.get(name);
    if (cached !== undefined) return cached;

    const pipeline = this.pipelines.get(name);
    if (pipeline === undefined) return undefined;

    const result = pipeline.paired ? this.runPaired(pipeline) : this.runSingle(pipeline);
    if (result === undefined) return undefined;
    this.cache.set(name, result);
    return result;
  }

  private runPaired(pipeline: CompiledPipeline): Extraction | undefined {
    if (!(PAIRED_SOURCE in this.world)) {
      this.problem = this.absent(PAIRED_SOURCE);
      return undefined;
    }
    const state = this.world[PAIRED_SOURCE];
    if (
      typeof state !== 'object' ||
      state === null ||
      Array.isArray(state) ||
      !('pre' in state) ||
      !('post' in state)
    ) {
      this.problem = {
        kind: 'error',
        source: PAIRED_SOURCE,
        reason: `'${PAIRED_SOURCE}' must be a before/after pair — an object carrying 'pre' and 'post'`,
      };
      return undefined;
    }
    const sides = state as { pre: unknown; post: unknown };
    const pre = this.runSteps(pipeline, sides.pre, PAIRED_SOURCE);
    if (pre === undefined) return undefined;
    const post = this.runSteps(pipeline, sides.post, PAIRED_SOURCE);
    if (post === undefined) return undefined;
    return { pair: { pre, post } };
  }

  /**
   * A pipeline reading one world value, or a combinator joining two other extractions —
   * the two ways a pipeline can begin.
   */
  private runSingle(pipeline: CompiledPipeline): Extraction | undefined {
    const combinator = pipeline.combinator;
    if (combinator !== undefined) {
      const [leftName, rightName] = combinatorReferences(combinator);
      const left = this.resolve(leftName)?.single;
      const right = this.resolve(rightName)?.single;
      if (left === undefined || right === undefined) return undefined;
      const items = this.runStepList(
        pipeline.steps,
        combine(combinator, left, right),
        pipeline.name,
      );
      return items === undefined ? undefined : { single: items };
    }

    const source = sourceName(pipeline);
    if (!(source in this.world)) {
      // `empty` is the one policy that continues the judgment: the absence becomes an empty
      // item list, and what that means for the verdict is the pipeline's own arithmetic.
      if (this.supply[source] === 'empty') return { single: [] };
      this.problem = this.absent(source);
      return undefined;
    }
    const items = this.runSteps(pipeline, this.world[source], source);
    return items === undefined ? undefined : { single: items };
  }

  /**
   * What an absent source means under the declaration's supply policy: skip, or fail. The
   * paired source reaches only this, never the empty reading — config validation refuses
   * `empty` there, and an absent pair is not a pair of empty states either way.
   */
  private absent(source: string): SupplyProblem {
    return this.supply[source] === 'pass'
      ? { kind: 'pass', source }
      : { kind: 'error', source, reason: `the world carries no source named '${source}'` };
  }

  /** The steps after the source; the paired path re-enters here once per state. */
  private runSteps(pipeline: CompiledPipeline, value: unknown, source: string): Items | undefined {
    return this.runStepList(pipeline.steps.slice(1), [{ key: '0', value }], source);
  }

  private runStepList(
    steps: readonly ExtractStep[],
    items: Items,
    source: string,
  ): Items | undefined {
    let current = items;
    for (const step of steps) {
      try {
        current = EXTRACT_STEPS[step.op].run(current, step as Readonly<Record<string, unknown>>);
      } catch (error) {
        if (!(error instanceof SupplyFailure)) throw error;
        this.problem = { kind: 'error', source, reason: error.message };
        return undefined;
      }
    }
    return current;
  }
}

/** The world name a source-headed pipeline reads. */
function sourceName(pipeline: CompiledPipeline): string {
  return String((pipeline.steps[0] as { of?: unknown }).of);
}

function combine(step: BinaryStep, left: Items, right: Items): Items {
  if (step.op === 'union') return [...left, ...right];
  const rightKeys = new Set(right.map((item) => item.key));
  return step.op === 'onlyIn'
    ? left.filter((item) => !rightKeys.has(item.key))
    : left.filter((item) => rightKeys.has(item.key));
}

/** The paired path runs the whole pipeline over one state; the single path skips the source. */
function evaluate(
  entry: RelateEntry,
  extractor: Extractor,
): readonly WitnessWithBefore[] | undefined {
  const relation = entry.relation;
  const items = (name: string): Items | undefined => extractor.resolve(name)?.single;

  if (relation.op === 'unchanged') {
    const pair = extractor.resolve(relation.of)?.pair;
    return pair === undefined ? undefined : relateUnchanged(pair.pre, pair.post);
  }
  if (relation.op === 'equal') {
    const left = items(relation.of[0]);
    const right = items(relation.of[1]);
    return left === undefined || right === undefined ? undefined : relateEqual(left, right);
  }
  if (relation.op === 'subset') {
    const of = items(relation.of);
    const inItems = items(relation.in);
    return of === undefined || inItems === undefined ? undefined : relateSubset(of, inItems);
  }
  if (relation.op === 'implies') {
    const of = items(relation.of);
    const requires = items(relation.requires);
    return of === undefined || requires === undefined ? undefined : relateImplies(of, requires);
  }
  const of = items(relation.of);
  if (of === undefined) return undefined;
  if (relation.op === 'empty') return relateEmpty(of);
  if (relation.op === 'nonEmpty') return relateNonEmpty(of, relation.of);
  return relateOrdered(of, relation.strict === true);
}

/** The template of an entry, chosen by the side of the witness that will render it. */
function templateFor(entry: RelateEntry, witness: Witness): string {
  if ('message' in entry) return entry.message;
  return witness.side === 'right' ? entry.messageBySide.right : entry.messageBySide.left;
}

function renderText(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

/**
 * The break text: the first witness fills the template, and the witnesses beyond it are
 * counted in a suffix rather than listed, so one break stays one line.
 */
function renderMessage(entry: RelateEntry, witnesses: readonly WitnessWithBefore[]): string {
  const first = witnesses[0];
  const rendered = templateFor(entry, first)
    .replaceAll('{key}', first.key)
    .replaceAll('{value}', renderText(first.value))
    .replaceAll('{before}', first.before === undefined ? '' : renderText(first.before));
  return witnesses.length > 1 ? `${rendered} (+${witnesses.length - 1})` : rendered;
}

function stripBefore(witnesses: readonly WitnessWithBefore[]): readonly Witness[] {
  return witnesses.map(({ key, value, side }) =>
    side === undefined ? { key, value } : { key, value, side },
  );
}

/**
 * Whether the declaration's scope admits this world. An absent scope admits every world, and
 * an absent `include` admits every path the `exclude` list does not name.
 */
function inScope(scope: CompiledScope | undefined, world: World): boolean {
  if (scope === undefined) return true;
  const target = world[scope.source];
  if (typeof target !== 'string') return false;
  const included = scope.include.length === 0 || scope.include.some((p) => p.test(target));
  return included && !scope.exclude.some((pattern) => pattern.test(target));
}

function verdictFor(problem: SupplyProblem): DeclarationVerdict {
  return problem.kind === 'pass'
    ? { kind: 'not-applicable', reason: 'supply-pass', source: problem.source }
    : { kind: 'supply-error', source: problem.source, reason: problem.reason };
}

/**
 * Whether the declaration's scope admits this world — the routing question, asked without
 * judging. A surface routes on the same predicate the judgment starts with, so a world it
 * sends to the body is never one the body answers `not-applicable` for.
 */
export function scopeAdmits(compiled: CompiledDeclaration, world: World): boolean {
  return inScope(compiled.scope, world);
}

/** `judgeDeclaration` input — one compiled declaration and the world it is judged against. */
export type JudgeDeclarationSpec = { compiled: CompiledDeclaration; world: World };

/**
 * Judge one compiled declaration against one world.
 *
 * The scope decides first, so a declaration that does not apply never reads a source it
 * would have failed on. Then every relate entry is evaluated in declaration order, one
 * break per entry that does not hold. The first supply failure ends the judgment: a
 * partially read world produces no partial verdict.
 */
export function judgeDeclaration(spec: JudgeDeclarationSpec): DeclarationVerdict {
  const { compiled, world } = spec;
  if (!inScope(compiled.scope, world)) return { kind: 'not-applicable', reason: 'scope' };

  const extractor = new Extractor(compiled.pipelines, compiled.supply, world);
  const breaks: Break[] = [];
  for (const entry of compiled.relate) {
    const witnesses = evaluate(entry, extractor);
    if (extractor.problem !== undefined) return verdictFor(extractor.problem);
    if (witnesses === undefined || witnesses.length === 0) continue;
    breaks.push({
      id: entry.id,
      message: renderMessage(entry, witnesses),
      witnesses: stripBefore(witnesses),
    });
  }
  return breaks.length === 0 ? { kind: 'pass' } : { kind: 'broken', breaks };
}

/** `witnessOpens` input — one compiled declaration and the world its witness is asked about. */
export type WitnessOpensSpec = { compiled: CompiledDeclaration; world: World };

/**
 * Whether the declaration's witness condition holds for this world — the valve that stands
 * after the verdict. It is closed unless every witness entry holds: a declaration with no
 * witness block, a world outside the scope, and a source the witness cannot read all leave
 * it shut, so the valve opens only on a condition that was actually met.
 */
export function witnessOpens(spec: WitnessOpensSpec): boolean {
  const { compiled, world } = spec;
  const witness = compiled.witness;
  if (witness === undefined) return false;
  if (!inScope(compiled.scope, world)) return false;

  const extractor = new Extractor(witness.pipelines, compiled.supply, world);
  for (const entry of witness.relate) {
    const witnesses = evaluate(entry, extractor);
    if (extractor.problem !== undefined || witnesses === undefined) return false;
    if (witnesses.length > 0) return false;
  }
  return true;
}
