import { describe, expect, it } from 'vitest';
// The context family: a `requirePrecedent` entry declares that an edit needs session
// evidence first. Core owns and fully validates only the `command` evidence vocabulary;
// every other evidence key is adapter vocabulary, admitted by the container check (flat
// object, exactly one evidence key) with its value passed through verbatim. The optional
// `when` trigger regex combines with `requirePrecedent` only, and `in`/`except` are open to
// the delta and context families while the path and command families still reject them.
import { ConfigValidationError, defineConfig } from '../src/config.ts';

// testCmd bodies are deliberately fake (`fake-runner`): the core never runs the command,
// so a real runner name would imply a coupling it does not have. Evidence values
// (`npm view `, subagent kinds, tool-name patterns) are discipline data injected through
// fixtures, never literals core knows about.

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

describe('defineConfig context family — valid requirePrecedent entries', () => {
  it('accepts a full context-family entry (in/except/when/command) and carries it verbatim', () => {
    // A well-formed entry must reach ResolvedConfig.disciplines byte-for-byte: the
    // assertion catches both requirePrecedent going unregistered as a predicate key and
    // the validator rewriting or dropping when/in/except on the way through.
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
    // An absent `when` means "every in-scope change triggers", so omitting it must
    // validate — and a lone requirePrecedent must count as one predicate, not zero.
    const disciplines = [{ id: 'minimal-context', requirePrecedent: { command: 'fake-probe ' } }];

    const resolved = defineConfig(withDisciplines(disciplines));

    expect(resolved.disciplines).toEqual(disciplines);
  });

  it('admits adapter evidence vocabulary verbatim — container checked, values never validated by core', () => {
    // Non-command evidence keys belong to adapters, so core checks only the container and
    // passes values through untouched. The third entry's value is a non-compilable regex on
    // purpose — core applying its command-grade regex probe to an adapter value would
    // reject it. An unknown evidence key fails closed at assembly time, not at config time.
    const disciplines = [
      { id: 'spawn-evidence', in: 'src/**', requirePrecedent: { subagent: 'tdd-implementer' } },
      { id: 'tool-evidence', in: 'src/**', requirePrecedent: { tool: '^mcp__' } },
      { id: 'opaque-adapter-value', in: 'src/**', requirePrecedent: { tool: '(' } },
    ];

    const resolved = defineConfig(withDisciplines(disciplines));

    expect(resolved.disciplines).toEqual(disciplines);
  });
});

describe('defineConfig context family — command evidence validation', () => {
  it('rejects an empty-string command, naming the entry', () => {
    // An empty command pattern matches everything, so the gate would open on any tool call.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'empty-command', requirePrecedent: { command: '' } }]),
    );

    expect(error.message).toContain('empty-command');
  });

  it('rejects a non-compilable command regex string', () => {
    // A pattern `new RegExp` cannot compile is a broken discipline: refuse it at authoring
    // time rather than at judge time.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'bad-command-re', requirePrecedent: { command: '(' } }]),
    );

    expect(error.message).toContain('bad-command-re');
  });

  it('rejects a non-string command value', () => {
    // Core owns the command vocabulary, so a numeric value must be refused — verbatim
    // pass-through applies to adapter keys only.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'command-number', requirePrecedent: { command: 123 } }]),
    );

    expect(error.message).toContain('command-number');
  });
});

describe('defineConfig context family — evidence container shape', () => {
  it('rejects a requirePrecedent with zero evidence keys ({})', () => {
    // An evidence-less requirePrecedent can never be satisfied nor evaluated; accepting it
    // yields a discipline that always blocks or always passes depending on the evaluator.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'no-evidence', requirePrecedent: {} }]),
    );

    expect(error.message).toContain('no-evidence');
  });

  it('rejects a requirePrecedent with two evidence keys (command+adapter and adapter+adapter)', () => {
    // Two evidence keys make the required precedent ambiguous. Both pairings are needed: a
    // count that only watches the `command` key would still admit the adapter-only pair.
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
    // Arrays are typeof object, strings look like a shorthand, and null JSON-parses fine:
    // each must be refused rather than coerced into an evidence container.
    for (const value of [['fake-probe '], 'fake-probe ', null]) {
      const error = expectConfigValidationError(
        withDisciplines([{ id: 'non-object-evidence', requirePrecedent: value }]),
      );
      expect(error.message).toContain('non-object-evidence');
    }
  });
});

describe('defineConfig context family — predicate cardinality over 4 keys', () => {
  it('rejects requirePrecedent combined with each of the other three predicate keys', () => {
    // requirePrecedent must belong to the cardinality set, not merely be an accepted key;
    // otherwise it could ride along with another family unnoticed.
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

describe('defineConfig context family — when trigger coupling and validity', () => {
  it('rejects when on a forbid, immutable, or forbidCommand entry', () => {
    // `when` is a context-family trigger; on any other family it is dead data implying a
    // trigger that is never applied, so it must live in the context-only key set.
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
    const error = expectConfigValidationError(
      withDisciplines([
        { id: 'when-number', when: 123, requirePrecedent: { command: 'fake-probe ' } },
      ]),
    );

    expect(error.message).toContain('when-number');
  });

  it('rejects an empty-string when trigger', () => {
    // '' compiles fine and matches everything, so an empty trigger silently means "always"
    // — what omitting `when` already expresses — and would let a typo'd trigger masquerade
    // as a narrow one. Compilability alone never catches this; the non-empty check does.
    const error = expectConfigValidationError(
      withDisciplines([
        { id: 'empty-when', when: '', requirePrecedent: { command: 'fake-probe ' } },
      ]),
    );

    expect(error.message).toContain('empty-when');
    expect(error.message).toContain('when must be a non-empty string pattern');
  });

  it('rejects a non-compilable when regex', () => {
    // The same authoring-time compilability gate every other pattern field gets.
    const error = expectConfigValidationError(
      withDisciplines([
        { id: 'bad-when-re', when: '(', requirePrecedent: { command: 'fake-probe ' } },
      ]),
    );

    expect(error.message).toContain('bad-when-re');
  });
});

describe('defineConfig context family — scope keys stay off path/command families', () => {
  it('rejects `in` on a forbidCommand entry (the widening regression, new combination)', () => {
    // Opening in/except to the context family must not open them to the command family.
    // config-disciplines.test.ts pins except-on-forbidCommand; this pins the in-side.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'command-with-in', forbidCommand: 'x', in: 'z/**' }]),
    );

    expect(error.message).toContain('command-with-in');
  });

  it('rejects `except` on an immutable entry (the widening regression, new combination)', () => {
    // config-disciplines.test.ts pins in-on-immutable; this pins the except-side, so an
    // asymmetric widening that opens only one of the two keys is caught.
    const error = expectConfigValidationError(
      withDisciplines([{ id: 'immutable-with-except', immutable: 'y/**', except: 'z/**' }]),
    );

    expect(error.message).toContain('immutable-with-except');
  });
});
