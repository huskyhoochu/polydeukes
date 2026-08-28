import type { AlgebraDeclaration, ExtractBlock, RelateEntry } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import { type ConfigFault, compileDeclaration } from '../src/declaration-engine.ts';
import { isConfigFault } from './declaration-engine-helpers.ts';

// `compileDeclaration` resolves a validated declaration against the extract registry and
// checks the shapes the type system cannot: an `op` outside the registry, an argument
// outside an entry's closed keys, a regex that does not compile, a paired (`state`) extract
// in a single-sided relation or a single extract under `Unchanged`, and a combinator over a
// paired extract. Every one comes back as a `config-fault` value carrying a `location`;
// none throws.

// Source and extract names are fixture values; `state` is the one name the contract
// reserves for a pre/post pair.
const SRC = 'doc';
const SRC_OTHER = 'other';
const PAIRED_SOURCE = 'state';
const SINGLE = 'singleItems';
const OTHER = 'otherItems';
const PAIRED = 'pairedItems';
const JOINED = 'joinedItems';
const ENTRY = 'probe-entry';

function declaration(extract: ExtractBlock, relate: RelateEntry[]): AlgebraDeclaration {
  return { discipline: 'probe', extract, relate };
}

/** Compile without throwing and return the fault, failing if none came back. */
function faultOf(decl: AlgebraDeclaration): ConfigFault {
  let result: ReturnType<typeof compileDeclaration> | undefined;
  expect(() => {
    result = compileDeclaration(decl);
  }).not.toThrow();
  if (result === undefined || !isConfigFault(result)) {
    throw new Error(`expected a config fault, got ${JSON.stringify(result)}`);
  }
  return result;
}

const emptyOf = (name: string): RelateEntry => ({
  id: ENTRY,
  relation: { op: 'Empty', of: name },
  message: 'm',
});

describe('compileDeclaration — an op outside the registry', () => {
  it('refuses the history vocabulary `toolUses` with a fault naming the pipeline', () => {
    // The first outside name the roadmap expects: a registry lookup that falls through to
    // an identity step would run the declaration as if the step were absent.
    const fault = faultOf(
      declaration(
        {
          [SINGLE]: [
            { op: 'source', of: SRC },
            { op: 'toolUses', names: ['Agent'], subagentType: 'writer' },
          ],
        },
        [emptyOf(SINGLE)],
      ),
    );
    expect(fault.kind).toBe('config-fault');
    expect(fault.location).toContain(SINGLE);
    expect(fault.reason).toContain('toolUses');
  });

  it('refuses `sha256` — an outside name with no arguments is still outside', () => {
    const fault = faultOf(
      declaration({ [SINGLE]: [{ op: 'source', of: SRC }, { op: 'sha256' }] }, [emptyOf(SINGLE)]),
    );
    expect(fault.kind).toBe('config-fault');
    expect(fault.location).toContain(SINGLE);
  });
});

describe("compileDeclaration — an argument outside an entry's closed keys", () => {
  it('refuses `json` carrying the W2 `as` argument', () => {
    // The schema leaves unary arguments open, so this is the only place the key is closed.
    const fault = faultOf(
      declaration(
        {
          [SINGLE]: [
            { op: 'source', of: SRC },
            { op: 'json', as: SRC },
          ],
        },
        [emptyOf(SINGLE)],
      ),
    );
    expect(fault.kind).toBe('config-fault');
    expect(fault.location).toContain(SINGLE);
    expect(fault.reason).toContain('as');
  });
});

describe('compileDeclaration — a regex that does not compile', () => {
  it('refuses `matches.re` that the regex engine rejects, as a value', () => {
    // `new RegExp` throws SyntaxError; a compile that lets it escape crashes assembly
    // instead of reporting the declaration.
    const fault = faultOf(
      declaration(
        {
          [SINGLE]: [
            { op: 'source', of: SRC },
            { op: 'matches', re: '(' },
          ],
        },
        [emptyOf(SINGLE)],
      ),
    );
    expect(fault.kind).toBe('config-fault');
    expect(fault.location).toContain(SINGLE);
  });
});

describe('compileDeclaration — a pipeline must begin at a source or a combinator', () => {
  it('refuses a pipeline whose first step is a unary transform', () => {
    // Without this the engine would read a source name off the `lines` step, find none,
    // and report a supply error naming the source 'undefined' — while dropping that step.
    const fault = faultOf(
      declaration({ [SINGLE]: [{ op: 'lines' }, { op: 'matches', re: 'TODO' }] }, [
        emptyOf(SINGLE),
      ]),
    );
    expect(fault.location).toContain(SINGLE);
    expect(fault.reason).toContain('source');
  });

  it('refuses a relation naming an extract no block defines, as a fault rather than a pass', () => {
    // A reference that resolves to nothing must not read as "the relation holds".
    const fault = faultOf(
      declaration({ [SINGLE]: [{ op: 'source', of: SRC }] }, [emptyOf('nowhere')]),
    );
    expect(fault.location).toContain(ENTRY);
    expect(fault.reason).toContain('nowhere');
  });
});

describe('compileDeclaration — paired and single shapes', () => {
  const pairedExtract: ExtractBlock = { [PAIRED]: [{ op: 'source', of: PAIRED_SOURCE }] };
  const singleExtract: ExtractBlock = { [SINGLE]: [{ op: 'source', of: SRC }] };

  it('refuses `Unchanged` over a single extract', () => {
    // A single extract has no pre/post to compare; an engine treating it as "pre = post"
    // holds vacuously — the fail-open reading.
    const fault = faultOf(
      declaration(singleExtract, [
        { id: ENTRY, relation: { op: 'Unchanged', of: SINGLE }, message: 'm' },
      ]),
    );
    expect(fault.kind).toBe('config-fault');
    expect(fault.location).toContain(ENTRY);
  });

  it('refuses `Empty` over a paired extract', () => {
    // The paired value is `{ pre, post }`; any single-sided relation would have to pick a
    // side silently.
    const fault = faultOf(declaration(pairedExtract, [emptyOf(PAIRED)]));
    expect(fault.kind).toBe('config-fault');
    expect(fault.location).toContain(ENTRY);
  });

  it('refuses a combinator that references a paired extract', () => {
    const fault = faultOf(
      declaration(
        {
          ...pairedExtract,
          ...singleExtract,
          [OTHER]: [{ op: 'union', of: [PAIRED, SINGLE] }],
        },
        [emptyOf(OTHER)],
      ),
    );
    expect(fault.kind).toBe('config-fault');
    expect(fault.location).toContain(OTHER);
  });

  it('admits `Unchanged` over a paired extract and `Empty` over a single one', () => {
    // The positive end: the shape check must not refuse the pairing it exists for.
    const result = compileDeclaration(
      declaration({ ...pairedExtract, ...singleExtract }, [
        { id: ENTRY, relation: { op: 'Unchanged', of: PAIRED }, message: 'm' },
        { id: `${ENTRY}-2`, relation: { op: 'Empty', of: SINGLE }, message: 'm' },
      ]),
    );
    expect(isConfigFault(result)).toBe(false);
  });

  it('admits a combinator over two single extracts', () => {
    const result = compileDeclaration(
      declaration(
        {
          ...singleExtract,
          [OTHER]: [{ op: 'source', of: SRC_OTHER }],
          [JOINED]: [{ op: 'intersect', of: [SINGLE, OTHER] }],
        },
        [emptyOf(JOINED)],
      ),
    );
    expect(isConfigFault(result)).toBe(false);
  });
});
