import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CovenantRegistration } from '../src/dispatch.ts';
// The supply layer's two verbs, executor skeleton: `planSources` folds every registration's
// `sources` bindings into one de-duplicated path list (registration order, then declaration
// order, first occurrence wins); `supplySources` calls the injected `read` once per planned
// path and keeps only what came back — an `undefined` is absence (no key), a throw is the
// caller's fail-closed path. The kernel opens no file itself: the module text carries no
// `node:fs` and no `node:child_process`.
import type {
  PlanSourcesSpec,
  SourcePlan,
  SuppliedSources,
  SupplySourcesSpec,
} from '../src/supply.ts';
import { planSources, supplySources } from '../src/supply.ts';
import { exitThunk } from './helpers.js';

const pkgDir = resolve(import.meta.dirname, '..');

// Source names and file paths are fixture values.
const KO = { name: 'ko', file: 'locales/ko.json' };
const EN = { name: 'en', file: 'locales/en.json' };
const GLOSSARY = { name: 'glossary', file: 'docs/glossary.md' };

/** A declare-shaped registration carrying the given source bindings. */
function declareReg(
  label: string,
  sources: readonly { name: string; file: string }[],
): CovenantRegistration {
  return { label, protectedPaths: [], body: exitThunk(0), sources };
}

/** A registration of a family that names no sources (forbid, immutable, the meta-covenants). */
function plainReg(label: string): CovenantRegistration {
  return { label, protectedPaths: [], body: exitThunk(0) };
}

/** A `read` that answers from a table and records every path it was asked for. */
function tableRead(table: Record<string, string | undefined>) {
  const asked: string[] = [];
  const read = (path: string): string | undefined => {
    asked.push(path);
    return table[path];
  };
  return { read, asked };
}

describe('planSources — the path list the registrations name', () => {
  it('walks registrations in order and each declaration in its own order, a forbid entry between them contributing nothing', () => {
    // Sorting the list, or reading the forbid registration's missing `sources` as a throw,
    // changes which file the composition root reads first — and witness order follows
    // plan order, so two surfaces would disagree on the first witness.
    const plan = planSources({
      registrations: [
        declareReg('parity', [KO, EN]),
        plainReg('no-secrets'),
        declareReg('glossary-terms', [EN, GLOSSARY]),
      ],
    });

    expect(plan).toEqual({ files: [KO.file, EN.file, GLOSSARY.file] });
  });

  it('keeps the first occurrence of a path named twice, not the last', () => {
    // A last-occurrence de-duplication (collect all, keep the final position) reverses the
    // order here; the first test above cannot tell the two apart.
    const plan = planSources({
      registrations: [declareReg('a', [EN, KO]), declareReg('b', [KO, EN])],
    });

    expect(plan.files).toEqual([EN.file, KO.file]);
  });

  it('answers { files: [] } when no registration names a source, including an empty sources list', () => {
    // The degenerate plan: a root that receives `undefined` here, or a `[undefined]`, would
    // crash the session hook on every config without a declare entry.
    const plan = planSources({
      registrations: [plainReg('no-secrets'), declareReg('scoped-only', [])],
    });

    expect(plan).toEqual({ files: [] });
  });
});

describe('supplySources — read once per planned path, keep what came back', () => {
  it('calls read exactly once per path in plan order and keys the result in that order', () => {
    // Reading twice doubles the cold-start cost the PRD budgets per named file; reading in
    // sorted order breaks the plan-order invariant witnesses are built on.
    const { read, asked } = tableRead({ [KO.file]: '{"a":1}', [EN.file]: '{"a":2}' });

    const supplied = supplySources({ plan: { files: [KO.file, EN.file] }, read });

    expect(asked).toEqual([KO.file, EN.file]);
    expect(supplied).toEqual({ files: { [KO.file]: '{"a":1}', [EN.file]: '{"a":2}' } });
    expect(Object.keys(supplied.files)).toEqual([KO.file, EN.file]);
  });

  it('leaves a path whose read answered undefined out of the result entirely — no key, not a key holding undefined', () => {
    // The engine's absence test is `source in world`; a key present with `undefined`
    // passes it, the step runs over nothing, and the declaration's `supply: error` never
    // fires. That is the fail-open the `null` prohibition in the IR exists to prevent.
    const { read } = tableRead({ [KO.file]: '{}', [EN.file]: undefined });

    const supplied = supplySources({ plan: { files: [KO.file, EN.file] }, read });

    expect(Object.keys(supplied.files)).toEqual([KO.file]);
    expect(EN.file in supplied.files).toBe(false);
  });

  it('keeps an empty string as a present value', () => {
    // A truthiness check (`if (text)`) turns an empty locale file into an absence and
    // refuses a declaration that should have judged an empty key set.
    const { read } = tableRead({ [EN.file]: '' });

    const supplied = supplySources({ plan: { files: [EN.file] }, read });

    expect(supplied.files).toEqual({ [EN.file]: '' });
  });

  it('lets a throwing read propagate untouched', () => {
    // EACCES is not ENOENT: swallowing it into absence lets a
    // `supply: pass` declaration skip a file the root could not read, and the composition
    // root's fail-closed row never lands.
    const read = (): string | undefined => {
      throw new Error('EACCES: permission denied');
    };

    expect(() => supplySources({ plan: { files: [EN.file] }, read })).toThrow(
      'EACCES: permission denied',
    );
  });

  it('never calls read on an empty plan and answers { files: {} }', () => {
    // A loop written over `plan.files[0]` or an off-by-one would read `undefined` as a path.
    const { read, asked } = tableRead({});

    const supplied = supplySources({ plan: { files: [] }, read });

    expect(asked).toEqual([]);
    expect(supplied).toEqual({ files: {} });
  });
});

describe('the supply module is kernel — no effects of its own', () => {
  // The kernel plans and assembles; the file system and the process table are the
  // composition root's, injected through `read`. A convenience `readFileSync` fallback in
  // the module would be a second, unmeasured read path the commit surface never sees.
  it('imports neither node:fs nor node:child_process', () => {
    const text = readFileSync(join(pkgDir, 'src/supply.ts'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    expect(text).not.toMatch(/from\s+['"](node:)?(fs|child_process)(\/promises)?['"]/);
    expect(text).not.toMatch(/\brequire\s*\(/);
  });
});

describe('the barrel carries the two verbs and their four types, and nothing else from the module', () => {
  // The umbrella is the consumer of `planSources` and `supplySources`, which is the
  // reason the barrel widens by exactly these six names. A seventh name re-exported from
  // the supply module (a helper, a constant no spec consumes) is a leak no typechecker
  // flags; a missing type strands a verb the umbrella cannot give a written type.
  const ADDED: readonly string[] = [
    'planSources',
    'PlanSourcesSpec',
    'SourcePlan',
    'supplySources',
    'SupplySourcesSpec',
    'SuppliedSources',
  ];

  it('re-exports exactly the six names from ./supply.js', () => {
    const barrel = readFileSync(join(pkgDir, 'src/index.ts'), 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    const statement = barrel.match(/export\s+\{([^}]*)\}\s+from\s+'\.\/supply\.js'/);
    expect(statement, 'no re-export statement from ./supply.js').not.toBeNull();

    const names = (statement?.[1] ?? '')
      .split(',')
      .map((raw) => raw.trim().replace(/^type\s+/, ''))
      .filter((name) => name.length > 0)
      .sort();
    expect(names).toEqual([...ADDED].sort());
  });
});

// A compile-time fact: `tsc --noEmit` checks it, the test runner strips it. The executor
// skeleton is one spec object in, one named result out — a second positional parameter or
// an anonymous return literal breaks the package's contract shape.
describe('the two verbs take the executor shape', () => {
  it('planSources is (PlanSourcesSpec) => SourcePlan and supplySources is (SupplySourcesSpec) => SuppliedSources', () => {
    expectTypeOf(planSources).parameters.toEqualTypeOf<[PlanSourcesSpec]>();
    expectTypeOf(planSources).returns.toEqualTypeOf<SourcePlan>();
    expectTypeOf(supplySources).parameters.toEqualTypeOf<[SupplySourcesSpec]>();
    expectTypeOf(supplySources).returns.toEqualTypeOf<SuppliedSources>();
  });
});
