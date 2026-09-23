import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BINARY_COMBINATOR_NAMES,
  RELATION_NAMES,
  SOURCE_KINDS,
  SUPPLY_POLICIES,
} from '../../core/src/algebra.ts';
import { MECHANISM_NAMES } from '../../core/src/catalogue.ts';
import { FIXED_SOURCE_NAMES } from '../../core/src/source-names.ts';
import { EXTRACT_STEPS } from '../src/covenant/extract-steps.ts';

const referenceRoot = resolve(import.meta.dirname, '../../../docs/reference/declaration-language');
const vocabularies: Record<string, readonly string[]> = {
  relations: RELATION_NAMES,
  'extract-steps': Object.keys(EXTRACT_STEPS),
  combinators: BINARY_COMBINATOR_NAMES,
  mechanisms: MECHANISM_NAMES,
  'fixed-sources': FIXED_SOURCE_NAMES,
  'source-kinds': SOURCE_KINDS,
  'supply-policies': SUPPLY_POLICIES,
};

function tableNames(markdown: string, sectionId: string): string[] {
  const anchors = [...markdown.matchAll(/^<a id="([^"]+)"><\/a>\s*$/gm)];
  expect(
    anchors.filter((anchor) => anchor[1] === sectionId),
    `Expected exactly one explicit anchor: ${sectionId}`,
  ).toHaveLength(1);
  const position = anchors.findIndex((anchor) => anchor[1] === sectionId);
  const section = markdown.slice(anchors[position]?.index, anchors[position + 1]?.index);
  return [...section.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((row) => row[1] as string);
}

describe('declaration language reference', () => {
  it('lists every source vocabulary exactly once in both language tables', () => {
    // A new, removed, duplicated, or misplaced name must make the reference drift visible.
    for (const filename of ['index.md', 'index.ko.md']) {
      const markdown = readFileSync(resolve(referenceRoot, filename), 'utf8');
      for (const [sectionId, expected] of Object.entries(vocabularies)) {
        expect(tableNames(markdown, sectionId).sort(), `${filename} #${sectionId}`).toEqual(
          [...expected].sort(),
        );
      }
    }
  });
});
