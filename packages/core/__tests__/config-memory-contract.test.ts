import { describe, expect, it } from 'vitest';
import { ConfigValidationError, defineConfig } from '../src/config.ts';
import { validate, validLanguages } from './helpers.ts';

const memory = {
  include: ['notes/**/*.md'],
  exclude: ['**/index.md', 'notes/releases/**'],
  typeMap: { decision: 'reference', guide: 'howto' },
  ticket: [
    { type: 'decision', from: 'frontmatter', key: 'issue', pattern: '[A-Z]+-[0-9]+' },
    { from: 'title', pattern: '[A-Z]+-[0-9]+' },
  ],
  weights: { reference: 2, howto: 0.5 },
  obligations: [
    { line: '^\\s*[-*] \\[ \\]', key: '[A-Z]+-[0-9]+[a-z]?' },
    { section: '^Unresolved questions$' },
  ],
};

function accepted(value: unknown): boolean {
  try {
    defineConfig(value);
    return true;
  } catch {
    return false;
  }
}

describe('memory config data contract', () => {
  it('retains valid JSON data and leaves memory absent when undeclared', () => {
    expect(defineConfig({ ...validLanguages, memory }).memory).toEqual(memory);
    expect(JSON.parse(JSON.stringify(defineConfig({ ...validLanguages, memory }).memory))).toEqual(
      memory,
    );
    expect('memory' in defineConfig(validLanguages)).toBe(false);
  });

  it.each([
    [{ ...validLanguages, memory }, true],
    [{ ...validLanguages, memory: { include: ['notes/**/*.md'] } }, true],
    [{ ...validLanguages, memory: { typeMap: { decision: 'reference' } } }, false],
    [{ ...validLanguages, memory: { ...memory, include: [] } }, false],
    [{ ...validLanguages, memory: { ...memory, include: ['notes/**/*.md', ''] } }, false],
    [{ ...validLanguages, memory: { ...memory, include: 'notes/**/*.md' } }, false],
    [{ ...validLanguages, memory: { ...memory, extra: true } }, false],
    [{ ...validLanguages, memory: { ...memory, typeMap: { decision: 1 } } }, false],
    [{ ...validLanguages, memory: { ...memory, ticket: [{ from: 'frontmatter' }] } }, false],
    [
      { ...validLanguages, memory: { ...memory, ticket: [{ from: 'title', key: 'issue' }] } },
      false,
    ],
    [{ ...validLanguages, memory: { ...memory, ticket: [{ from: 'body' }] } }, false],
    [{ ...validLanguages, memory: { ...memory, ticket: [{ from: 'title', extra: true }] } }, false],
    // A path rule: one fixture per constraint of the node, so the schema and the runtime
    // cannot drift on a constraint no fixture reaches.
    [{ ...validLanguages, memory: { ...memory, ticket: [{ from: 'path' }] } }, true],
    [
      {
        ...validLanguages,
        memory: { ...memory, ticket: [{ from: 'path', type: 'rfc', pattern: '[0-9]+' }] },
      },
      true,
    ],
    [{ ...validLanguages, memory: { ...memory, ticket: [{ from: 'path', key: 'id' }] } }, false],
    [{ ...validLanguages, memory: { ...memory, ticket: [{ from: 'path', type: '' }] } }, false],
    [{ ...validLanguages, memory: { ...memory, ticket: [{ from: 'path', type: 1 }] } }, false],
    [{ ...validLanguages, memory: { ...memory, ticket: [{ from: 'path', pattern: 1 }] } }, false],
    [{ ...validLanguages, memory: { ...memory, ticket: [{ from: 'path', extra: true }] } }, false],
    [{ ...validLanguages, memory: { ...memory, weights: { reference: -1 } } }, false],
    [{ ...validLanguages, memory: { ...memory, weights: { reference: '2' } } }, false],
    // Obligation rules: the two forms each alone, an empty list, and one fixture per way of
    // mixing or truncating a form, so neither side admits a rule the other refuses.
    [{ ...validLanguages, memory: { ...memory, obligations: [] } }, true],
    [{ ...validLanguages, memory: { ...memory, obligations: [{ line: 'x', key: 'y' }] } }, true],
    [{ ...validLanguages, memory: { ...memory, obligations: [{ section: 'x' }] } }, true],
    [{ ...validLanguages, memory: { ...memory, obligations: [{ line: 'x' }] } }, false],
    [{ ...validLanguages, memory: { ...memory, obligations: [{ key: 'y' }] } }, false],
    [
      {
        ...validLanguages,
        memory: { ...memory, obligations: [{ line: 'x', key: 'y', section: 'z' }] },
      },
      false,
    ],
    [
      { ...validLanguages, memory: { ...memory, obligations: [{ section: 'x', key: 'y' }] } },
      false,
    ],
    [{ ...validLanguages, memory: { ...memory, obligations: [{ line: 1, key: 'y' }] } }, false],
    [{ ...validLanguages, memory: { ...memory, obligations: [{ line: 'x', key: 1 }] } }, false],
    [{ ...validLanguages, memory: { ...memory, obligations: [{ section: 1 }] } }, false],
    [{ ...validLanguages, memory: { ...memory, obligations: [{ line: '[', key: 'y' }] } }, false],
    [{ ...validLanguages, memory: { ...memory, obligations: [{ section: '[' }] } }, false],
    [{ ...validLanguages, memory: { ...memory, obligations: [{ line: 'x', key: '[' }] } }, false],
    [
      {
        ...validLanguages,
        memory: { ...memory, obligations: [{ line: 'x', key: 'y', extra: true }] },
      },
      false,
    ],
    [{ ...validLanguages, memory: { ...memory, obligations: [{}] } }, false],
    [{ ...validLanguages, memory: { ...memory, obligations: { line: 'x', key: 'y' } } }, false],
  ] as const)('schema and runtime both judge memory fixture %#', (config, expected) => {
    expect(accepted(config)).toBe(expected);
    expect(validate(config)).toBe(expected);
  });

  it.each([
    [{ typeMap: { decision: 'reference' } }, 'memory.include'],
    [{ include: [] }, 'memory.include'],
    [{ ...memory, ticket: [{ from: 'frontmatter' }] }, 'memory.ticket[0]'],
    [{ ...memory, ticket: [{ from: 'title', key: 'issue' }] }, 'memory.ticket[0]'],
    [{ ...memory, weights: { reference: -1 } }, 'memory.weights.reference'],
    [{ ...memory, weights: { reference: Number.POSITIVE_INFINITY } }, 'memory.weights.reference'],
    [{ ...memory, ticket: [{ from: 'title', pattern: '[' }] }, 'memory.ticket[0]'],
    [{ ...memory, ticket: [{ from: 'path', key: 'id' }] }, 'memory.ticket[0]'],
    [{ ...memory, ticket: [{ from: 'path', pattern: '[' }] }, 'memory.ticket[0]'],
    // A rejection that names `memory.include` for an `exclude` fault sends the user to the
    // wrong key; one that names nothing leaves the schema as the only hint.
    [{ ...memory, exclude: '**/index.md' }, 'memory.exclude'],
    [{ ...memory, exclude: ['**/index.md', ''] }, 'memory.exclude'],
    // An emptied YAML `exclude:` parses to null; a truthiness check would let it through.
    [{ ...memory, exclude: null }, 'memory.exclude'],
    // The second entry is the faulty one, so a message that always names index 0 fails.
    [{ ...memory, obligations: [{ section: 'ok' }, { line: 'x' }] }, 'memory.obligations[1]'],
    [{ ...memory, obligations: [{ key: 'y' }] }, 'memory.obligations[0]'],
    [{ ...memory, obligations: [{ line: 'x', key: 'y', section: 'z' }] }, 'memory.obligations[0]'],
    [{ ...memory, obligations: [{ line: 1, key: 'y' }] }, 'memory.obligations[0]'],
    [{ ...memory, obligations: [{ section: '[' }] }, 'memory.obligations[0]'],
    [{ ...memory, obligations: [{ line: 'x', key: '[' }] }, 'memory.obligations[0]'],
    [{ ...memory, obligations: { line: 'x', key: 'y' } }, 'memory.obligations'],
  ] as const)('names the invalid memory location %#', (candidate, location) => {
    try {
      defineConfig({ ...validLanguages, memory: candidate });
      throw new Error('expected memory config rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      expect((error as Error).message).toContain(location);
    }
  });
});
