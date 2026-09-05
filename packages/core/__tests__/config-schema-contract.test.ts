import { describe, expect, it } from 'vitest';
import { defineConfig } from '../src/config.ts';
import { schema, validate, validLanguages } from './helpers.ts';

// The hand-written JSON Schema and the runtime `defineConfig()` validator must agree on
// every JSON-representable input: a valid fixture must be accepted by both, an invalid one
// rejected by both. A one-sided rejection means the two have drifted. Fixtures are limited to
// JSON-representable inputs; non-JSON rejections (a function testCmd) are structurally
// unrepresentable in a schema and live in config.test.ts instead.
//
// Dummy commands are deliberately fake (`fake-runner`, never a real runner) because the
// core never runs the command a `testCmd` carries. The banned-vocabulary literal appears
// only inside a discipline forbid pattern, where it is discipline data.

const VALID_CONFIGS: readonly unknown[] = [
  {
    languages: {
      typescript: {
        productionGlob: 'packages/core/src/**/*',
        testCmd: 'fake-runner {scope} --strict',
      },
    },
  },
  {
    languages: {
      python: {
        productionGlob: ['services/api/**/*.py', 'services/worker/**/*.py'],
        testCmd: 'fake-py-runner --all',
      },
    },
  },
  // Optional fields present and well-typed. Adapter fixtures live in
  // config-schema-adapters-contract.test.ts.
  {
    languages: {
      typescript: {
        productionGlob: 'packages/core/src/**/*',
        testCmd: 'fake-runner {scope}',
      },
    },
    protectedPaths: ['src/covenant/**'],
    telemetry: { logPath: 'custom/telemetry.log' },
  },
  // telemetry present but empty: the validator fills logPath's default, and the schema
  // treats it as optional — both sides must still accept the bare object.
  {
    languages: {
      typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
    },
    telemetry: {},
  },
  // A judged entry beside its optional why.
  {
    ...validLanguages,
    disciplines: [
      {
        id: 'no-banned',
        why: 'ban new control-framing vocabulary',
        declare: {
          mechanism: 'added-only',
          scope: { source: 'target.path', include: ['^src/'] },
          supply: { pre: 'empty', post: 'empty' },
          extract: {
            before: [
              { op: 'source', of: 'pre' },
              { op: 'lines' },
              { op: 'keyByPattern', re: '(zzz_banned)' },
            ],
            after: [
              { op: 'source', of: 'post' },
              { op: 'lines' },
              { op: 'keyByPattern', re: '(zzz_banned)' },
            ],
            added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
          },
          relate: [
            { id: 'nothing-added', relation: { op: 'empty', of: 'added' }, message: 'adds {key}' },
          ],
        },
      },
    ],
  },
  // A top-level `$schema` string (the IDE reference) must be accepted by both sides. The
  // equivalence is only enforced where a fixture exists, so every allowed key needs one.
  {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    ...validLanguages,
  },
  // Minimal valid witness: token non-empty, ttlMinutes finite and > 0. Both fields required.
  {
    ...validLanguages,
    witness: { token: 'fake-witness-token', ttlMinutes: 10 },
  },
];

const INVALID_CONFIGS: readonly unknown[] = [
  // `$schema` is an allowed key but still type-checked.
  {
    ...validLanguages,
    $schema: 42,
  },
  {},
  { languages: {} },
  {
    languages: {
      typescript: { productionGlob: 'packages/core/src/**/*', testCmd: '' },
    },
  },
  {
    languages: {
      typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 42 },
    },
  },
  {
    languages: {
      typescript: { testCmd: 'fake-runner {scope}' },
    },
  },
  {
    languages: {
      typescript: { productionGlob: '', testCmd: 'fake-runner {scope}' },
    },
  },
  {
    languages: {
      typescript: { productionGlob: [], testCmd: 'fake-runner {scope}' },
    },
  },
  // An empty-string element inside an otherwise valid array — the per-element check, not
  // the container check, is what rejects this.
  {
    languages: {
      typescript: {
        productionGlob: ['packages/core/src/**/*', ''],
        testCmd: 'fake-runner {scope}',
      },
    },
  },
  // The next three are near-miss typos of real keys (protectedPath, testCommand, logPathh):
  // unknown keys must be rejected at every level rather than silently ignored.
  {
    languages: {
      typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
    },
    protectedPath: ['src/covenant/**'],
  },
  {
    languages: {
      typescript: {
        productionGlob: 'packages/core/src/**/*',
        testCmd: 'fake-runner {scope}',
        testCommand: 'fake-runner {scope}',
      },
    },
  },
  {
    languages: {
      typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
    },
    telemetry: { logPathh: 'custom/telemetry.log' },
  },
  {
    languages: {
      typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
    },
    telemetry: { logPath: 42 },
  },
  {
    languages: {
      typescript: { productionGlob: 'packages/core/src/**/*', testCmd: 'fake-runner {scope}' },
    },
    protectedPaths: ['src/covenant/**', 42],
  },
  // An array is typeof 'object', so the top-level check must reject it explicitly.
  ['languages'],
  { ...validLanguages, disciplines: [{ id: 'no-predicate', why: 'oops' }] },
  { ...validLanguages, disciplines: [{ id: 'two', forbid: 'x', immutable: 'y/**' }] },
  // `removed` and `present` are not yet accepted forbid directions; only `added` is.
  { ...validLanguages, disciplines: [{ id: 'removed-dir', forbid: { removed: 'x' } }] },
  { ...validLanguages, disciplines: [{ id: 'present-dir', forbid: { present: 'x' } }] },
  { ...validLanguages, disciplines: [{ id: 'added-number', forbid: { added: 1 } }] },
  { ...validLanguages, disciplines: [{ id: 'empty-forbid', forbid: {} }] },
  { ...validLanguages, disciplines: [{ id: 'immutable-with-in', immutable: 'y/**', in: 'z/**' }] },
  // The two entries are byte-identical on purpose: JSON Schema cannot express by-key
  // uniqueness, so the schema side can only reject this through `uniqueItems` while
  // defineConfig rejects by duplicate id. Differing bodies would leave the schema silent.
  {
    ...validLanguages,
    disciplines: [
      { id: 'dup', forbid: 'a' },
      { id: 'dup', forbid: 'a' },
    ],
  },
  { ...validLanguages, disciplines: [{ id: 'why-typed', forbid: 'a', why: 123 }] },
  { ...validLanguages, disciplines: [{ id: '', forbid: 'a' }] },
  // Meta-covenant labels are reserved ids: the telemetry label space and `pdks explain`'s
  // kind column key on them, so a user entry may not shadow one.
  { ...validLanguages, disciplines: [{ id: 'self-mod', forbid: 'a' }] },
  { ...validLanguages, disciplines: [{ id: 'transcript-mod', forbid: 'a' }] },
  { ...validLanguages, disciplines: [{ id: 7, forbid: 'a' }] },
  // Non-compilable regexes; the schema side catches these through `format: regex`.
  { ...validLanguages, disciplines: [{ id: 'bad-forbid-re', forbid: '(' }] },
  { ...validLanguages, disciplines: { id: 'x', forbid: 'a' } },
  { ...validLanguages, disciplines: ['not-an-object'] },
  // A scalar and an array are both plausible witness mistakes, and an array is typeof
  // 'object' — the container check must reject each without coercing.
  { ...validLanguages, witness: 'covenant-witness' },
  { ...validLanguages, witness: ['covenant-witness'] },
  { ...validLanguages, witness: { token: 'fake-witness-token', ttlMinutes: 10, ttl: 5 } },
  { ...validLanguages, witness: { ttlMinutes: 10 } },
  { ...validLanguages, witness: { token: 123, ttlMinutes: 10 } },
  // Token boundaries: empty pairs the validator's trim-length 0 with the schema's
  // minLength 1; whitespace-only pairs `token.trim().length === 0` with `pattern: \S`.
  { ...validLanguages, witness: { token: '', ttlMinutes: 10 } },
  { ...validLanguages, witness: { token: '   ', ttlMinutes: 10 } },
  { ...validLanguages, witness: { token: 'fake-witness-token' } },
  { ...validLanguages, witness: { token: 'fake-witness-token', ttlMinutes: '10' } },
  // At and across the exclusive lower bound: validator `ttlMinutes > 0` pairs with the
  // schema's `exclusiveMinimum: 0`, so 0 itself must be excluded.
  { ...validLanguages, witness: { token: 'fake-witness-token', ttlMinutes: 0 } },
  { ...validLanguages, witness: { token: 'fake-witness-token', ttlMinutes: -5 } },
  // `witness` is a top-level key only; on a discipline entry it is an unknown key and throws.
  {
    ...validLanguages,
    disciplines: [{ id: 'per-discipline-witness', forbid: 'x', witness: { ttlMinutes: 5 } }],
  },
];

/** True when defineConfig accepts the input (does not throw). */
function defineConfigAccepts(config: unknown): boolean {
  try {
    defineConfig(config);
    return true;
  } catch {
    return false;
  }
}

describe('JSON Schema artifact', () => {
  it('declares the draft 2020-12 $schema', () => {
    // A schema authored against an older draft would be silently misinterpreted by
    // ajv/dist/2020.js rather than failing outright.
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });
});

describe('schema ⟺ defineConfig equivalence (VALID fixtures)', () => {
  it.each(
    VALID_CONFIGS.map((config, index) => [index, config] as const),
  )('valid fixture #%i: defineConfig accepts AND ajv validates', (_index, config) => {
    expect(defineConfigAccepts(config)).toBe(true);
    expect(validate(config)).toBe(true);
  });
});

describe('schema ⟺ defineConfig equivalence (INVALID fixtures)', () => {
  it.each(
    INVALID_CONFIGS.map((config, index) => [index, config] as const),
  )('invalid fixture #%i: defineConfig throws AND ajv rejects', (_index, config) => {
    expect(defineConfigAccepts(config)).toBe(false);
    expect(validate(config)).toBe(false);
  });
});
