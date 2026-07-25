import { describe, expect, it } from 'vitest';
// COVENANT-13 §4.1 / AC §5.1 — the 4th predicate family (context family). A
// `requirePrecedent` entry declares "this edit needs session evidence first". Core owns and
// fully validates ONLY the `command` evidence vocabulary; every other evidence key is
// adapter vocabulary that the container check (flat object, exactly one evidence key)
// admits with its value passed through verbatim (CONFIG-07 namespace layering). The
// optional `when` trigger regex combines with `requirePrecedent` ONLY, and `in`/`except`
// widen from delta-family-only to delta+context (path/command families still reject them).
// None of the context-family surface exists yet, so the acceptance side is RED; the
// rejection side locks the exactly-one boundaries GREEN must not overshoot.
import { ConfigValidationError, defineConfig } from '../src/index.ts';

// ---------------------------------------------------------------------------
// Fixtures. Same valid base config as config-disciplines.test.ts (v2 config-as-data).
// testCmd bodies are FAKE (`fake-runner`) so the core grep gate stays satisfied.
// Evidence values (`npm view `, subagent kinds, tool-name patterns) are discipline DATA
// injected through fixtures — never literals the core itself knows about.
// ---------------------------------------------------------------------------

const baseConfig = {
  languages: {
    typescript: {
      productionGlob: 'packages/core/src/**/*',
      testCmd: 'fake-runner {scope}',
    },
  },
} as const;

/** Attach a disciplines array to the valid base config. */
function withDisciplines(disciplines: unknown): unknown {
  return { ...baseConfig, disciplines };
}

// Asserts the concrete error instance and returns it so callers can assert on the message.
function expectConfigValidationError(invalidConfig: unknown): ConfigValidationError {
  try {
    defineConfig(invalidConfig);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigValidationError);
    return error as ConfigValidationError;
  }
  throw new Error('defineConfig should have thrown');
}

// ===========================================================================
// AC §5.1.1 — valid context-family entries pass and pass through verbatim
// ===========================================================================

describe('defineConfig context family — valid requirePrecedent entries (AC §5.1)', () => {
  it('accepts a full context-family entry (in/except/when/command) and carries it verbatim', () => {
    // P0 pass-through invariant (PRD §4.1 example shape): a well-formed context-family
    // entry must validate and reach ResolvedConfig.disciplines byte-for-byte. Mutation
    // caught: requirePrecedent not registered as the 4th predicate key (entry rejected as
    // predicate-less), or the validator rewriting/dropping when/in/except on the way through.
    const disciplines = [
      {
        id: 'dependency-needs-npm-view',
        why: 'measure the registry before trusting a trained version',
        in: 'package.json',
        except: 'fixtures/package.json',
        when: '^\\s*"[^"]+"\\s*:\\s*"[~^]?\\d',
        requirePrecedent: { command: 'npm view ' },
      },
    ];

    const resolved = defineConfig(withDisciplines(disciplines));

    expect(resolved.disciplines).toEqual(disciplines);
  });

  it('accepts a minimal entry without when/in (when is optional; requirePrecedent alone is the one predicate)', () => {
    // P0 boundary: `when` absent means "every in-scope change triggers" (PRD §4.1), so its
    // absence must validate. Mutation caught: `when` (or `in`) accidentally made required
    // on the context family, or the exactly-one-predicate count not counting
    // requirePrecedent (a lone requirePrecedent rejected as zero predicates).
    const disciplines = [{ id: 'minimal-context', requirePrecedent: { command: 'fake-probe ' } }];

    const resolved = defineConfig(withDisciplines(disciplines));

    expect(resolved.disciplines).toEqual(disciplines);
  });

  it('admits adapter evidence vocabulary verbatim — container checked, values never validated by core', () => {
    // P0 vocabulary layering (PRD §4.1, CONFIG-07): non-command evidence keys belong to
    // adapters; core validates only the container (flat object, one key) and passes values
    // through verbatim. The third entry's value is a NON-compilable regex on purpose:
    // core applying its command-grade regex probe to an adapter value would reject it.
    // Mutation caught: core validating adapter values (over-reach), or rejecting unknown
    // evidence keys at config time (they fail-closed at ASSEMBLY time, not here — §4.4).
    const disciplines = [
      { id: 'spawn-evidence', in: 'src/**', requirePrecedent: { subagent: 'tdd-implementer' } },
      { id: 'tool-evidence', in: 'src/**', requirePrecedent: { tool: '^mcp__' } },
      { id: 'opaque-adapter-value', in: 'src/**', requirePrecedent: { tool: '(' } },
    ];

    const resolved = defineConfig(withDisciplines(disciplines));

    expect(resolved.disciplines).toEqual(disciplines);
  });
});

// ===========================================================================
// AC §5.1.1 — core vocabulary `command` is fully validated
// ===========================================================================

describe('defineConfig context family — command evidence validation (AC §5.1)', () => {
  it('rejects an empty-string command, naming the entry', () => {
    // P0 boundary: an empty command pattern matches everything — the gate would open on
    // any tool call (fail-open). Mutation caught: the non-empty check on command dropped.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'empty-command', requirePrecedent: { command: '' } }]),
    );

    expect(error.message).toContain('empty-command');
  });

  it('rejects a non-compilable command regex string', () => {
    // P0: a pattern `new RegExp` cannot compile is a broken discipline — refuse at
    // authoring time, not at judge time. Mutation caught: the compilability probe applied
    // to forbid/forbidCommand but not to the new command evidence field.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'bad-command-re', requirePrecedent: { command: '(' } }]),
    );

    expect(error.message).toContain('bad-command-re');
  });

  it('rejects a non-string command value', () => {
    // P0 type boundary: core owns the command vocabulary, so a numeric value must be
    // refused (verbatim pass-through applies to ADAPTER keys only). Mutation caught: the
    // command branch falling into the adapter verbatim path.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'command-number', requirePrecedent: { command: 123 } }]),
    );

    expect(error.message).toContain('command-number');
  });
});

// ===========================================================================
// AC §5.1.1 — evidence container: flat object with exactly one evidence key
// ===========================================================================

describe('defineConfig context family — evidence container shape (AC §5.1)', () => {
  it('rejects a requirePrecedent with zero evidence keys ({})', () => {
    // P0 fail-fast: an evidence-less requirePrecedent can never be satisfied nor evaluated
    // — an unjudgeable entry. Mutation caught: the exactly-one lower bound dropped
    // (an empty container silently accepted = a discipline that always blocks or always
    // passes depending on the evaluator's whim).
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'no-evidence', requirePrecedent: {} }]),
    );

    expect(error.message).toContain('no-evidence');
  });

  it('rejects a requirePrecedent with two evidence keys (command+adapter and adapter+adapter)', () => {
    // P0 fail-fast: two evidence keys make the required precedent ambiguous. Both pairings
    // matter — a count that only watches the `command` key would admit the adapter-only
    // pair. Mutation caught: the exactly-one upper bound weakened to "at least one", or
    // counted over core keys only.
    const withCommand = expectConfigValidationError(
      withDisciplines([
        { id: 'two-evidence-core', requirePrecedent: { command: 'fake-probe ', subagent: 'x' } },
      ]),
    );
    expect(withCommand.message).toContain('two-evidence-core');

    const adapterOnly = expectConfigValidationError(
      withDisciplines([
        { id: 'two-evidence-adapter', requirePrecedent: { subagent: 'x', tool: 'y' } },
      ]),
    );
    expect(adapterOnly.message).toContain('two-evidence-adapter');
  });

  it('rejects a requirePrecedent value that is not a flat object (array/string/null)', () => {
    // P0 container boundary: arrays are typeof object, strings look like a shorthand, and
    // null JSON-parses fine — each must be refused, not coerced. Mutation caught: a
    // typeof-object check that admits arrays/null, or a string-shorthand fabricated.
    for (const value of [['fake-probe '], 'fake-probe ', null]) {
      const error = expectConfigValidationError(
        withDisciplines([{ id: 'non-object-evidence', requirePrecedent: value }]),
      );
      expect(error.message).toContain('non-object-evidence');
    }
  });
});

// ===========================================================================
// AC §5.1.2 — exactly-one-predicate widened to 4 keys
// ===========================================================================

describe('defineConfig context family — predicate cardinality over 4 keys (AC §5.1)', () => {
  it('rejects requirePrecedent combined with each of the other three predicate keys', () => {
    // P0: the exactly-one-predicate count must include requirePrecedent on the too-many
    // side as well. Mutation caught: requirePrecedent added as an accepted key but left
    // out of the cardinality set, so it could ride along another family unnoticed.
    const combos: Record<string, unknown>[] = [
      { forbid: 'x' },
      { immutable: 'y/**' },
      { forbidCommand: 'z' },
    ];
    for (const extra of combos) {
      const error = expectConfigValidationError(
        withDisciplines([
          { id: 'context-plus-other', requirePrecedent: { command: 'fake-probe ' }, ...extra },
        ]),
      );
      expect(error.message).toContain('context-plus-other');
    }
  });
});

// ===========================================================================
// AC §5.1.2 — `when` couples with requirePrecedent only, and is itself validated
// ===========================================================================

describe('defineConfig context family — when trigger coupling and validity (AC §5.1)', () => {
  it('rejects when on a forbid, immutable, or forbidCommand entry', () => {
    // P0 (PRD §4.1): `when` is a context-family trigger; on any other family it would be
    // silently dead data implying a trigger that is never applied. Mutation caught: `when`
    // added to the shared entry key set instead of the context-family-only set.
    const entries = [
      { id: 'forbid-with-when', forbid: 'x', when: 'y' },
      { id: 'immutable-with-when', immutable: 'y/**', when: 'y' },
      { id: 'command-with-when', forbidCommand: 'x', when: 'y' },
    ];
    for (const entry of entries) {
      const error = expectConfigValidationError(withDisciplines([entry]));
      expect(error.message).toContain(entry.id);
    }
  });

  it('rejects a non-string when value', () => {
    // P0 type boundary: `when` is a regex string, not a number/object.
    const error = expectConfigValidationError(
      withDisciplines([
        { id: 'when-number', when: 123, requirePrecedent: { command: 'fake-probe ' } },
      ]),
    );

    expect(error.message).toContain('when-number');
  });

  it('rejects a non-compilable when regex', () => {
    // P0: same authoring-time compilability gate as every other pattern field. Mutation
    // caught: the compilability probe not extended to the new `when` field.
    const error = expectConfigValidationError(
      withDisciplines([
        { id: 'bad-when-re', when: '(', requirePrecedent: { command: 'fake-probe ' } },
      ]),
    );

    expect(error.message).toContain('bad-when-re');
  });
});

// ===========================================================================
// AC §5.1.2 — in/except widening must not leak to the path/command families
// ===========================================================================

describe('defineConfig context family — scope keys stay off path/command families (AC §5.1)', () => {
  it('rejects `in` on a forbidCommand entry (the widening regression, new combination)', () => {
    // P0 regression: widening in/except from forbid-only to delta+context must NOT open
    // them to the command family. The shipped suite pins except-on-forbidCommand; this
    // pins the in-side of the same boundary. Mutation caught: the scope-key restriction
    // rewritten as "any family" during the widening.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'command-with-in', forbidCommand: 'x', in: 'z/**' }]),
    );

    expect(error.message).toContain('command-with-in');
  });

  it('rejects `except` on an immutable entry (the widening regression, new combination)', () => {
    // P0 regression partner: the shipped suite pins in-on-immutable; this pins the
    // except-side, catching an asymmetric widening that opens only one of the two keys.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'immutable-with-except', immutable: 'y/**', except: 'z/**' }]),
    );

    expect(error.message).toContain('immutable-with-except');
  });
});
