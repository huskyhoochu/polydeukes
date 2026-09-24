import { describe, expect, it } from 'vitest';
import { ConfigValidationError, defineConfig } from '../src/config.ts';
import { validate, validLanguages } from './helpers.ts';

const memory = {
  include: ['notes/**/*.md'],
  typeMap: { decision: 'reference', guide: 'howto' },
  ticket: [
    { type: 'decision', from: 'frontmatter', key: 'issue', pattern: '[A-Z]+-[0-9]+' },
    { from: 'title', pattern: '[A-Z]+-[0-9]+' },
  ],
  weights: { reference: 2, howto: 0.5 },
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
    [{ ...validLanguages, memory: { ...memory, weights: { reference: -1 } } }, false],
    [{ ...validLanguages, memory: { ...memory, weights: { reference: '2' } } }, false],
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
