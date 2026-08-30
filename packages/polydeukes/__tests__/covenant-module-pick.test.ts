import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, expectTypeOf, it } from 'vitest';
import type { CovenantModule } from '../src/covenant-module.ts';

// `CovenantModule` is the static type both composition roots assemble against, narrowed to
// the members they actually call. The type assertions below bite under the package
// typecheck (`tsc --noEmit`), not the vitest runtime — `expectTypeOf` is a runtime no-op.
// The source scan reads text ONLY and never rebuilds dist (no `beforeAll` build step,
// ever): a rebuild while the tree is mid-change locks the session behind the fail-closed
// hook.

const srcDir = resolve(import.meta.dirname, '../src');

/** The members the two composition roots call on the loaded module. */
const COVENANT_MEMBERS = [
  'compileDisciplineRegistrations',
  'dispatchCovenants',
  'selfModRegistration',
  'shellModRegistration',
  'transcriptModRegistration',
  'planSources',
  'supplySources',
] as const;

/** Every file that receives the loaded module and calls members on it. */
const CONSUMER_FILES = ['claude-code-hook.ts', 'covenant-check.ts'];

const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('the covenant module type', () => {
  // A module type that mirrors the whole covenant barrel lets a consumer grow a call on
  // any of its members without the widening ever showing in a diff of this package.
  it('carries exactly the members the composition roots consume', () => {
    expectTypeOf<keyof CovenantModule>().toEqualTypeOf<(typeof COVENANT_MEMBERS)[number]>();
  });
});

describe('the consumers against the member list', () => {
  // The member list above is written by hand. This derives both sides from the consumers'
  // own source: an access outside the list is a demand the type must not satisfy, and a
  // listed member no consumer touches is contract carried for nobody.
  it('every `covenant.<member>` access is in the list, and every member is accessed', () => {
    const accessed = new Set<string>();
    for (const file of CONSUMER_FILES) {
      const src = stripComments(readFileSync(join(srcDir, file), 'utf-8'));
      for (const m of src.matchAll(/\bcovenant\.([A-Za-z_]\w*)/g)) {
        accessed.add(m[1] as string);
      }
    }
    expect([...accessed].sort()).toEqual([...COVENANT_MEMBERS].sort());
  });
});

describe('the composition roots against the supply verbs', () => {
  // Each root must plan and supply for ITSELF — the two surfaces read the tree differently
  // (index, disk, or a commit), so a shared helper in one root would hand the other the wrong `read`. A root
  // that never calls one of the verbs dispatches without a world, and every declaration
  // naming a source refuses under `supply: error`.
  it('BOTH composition roots call planSources and supplySources', () => {
    for (const file of CONSUMER_FILES) {
      const src = stripComments(readFileSync(join(srcDir, file), 'utf-8'));
      const accessed = new Set([...src.matchAll(/\bcovenant\.([A-Za-z_]\w*)/g)].map((m) => m[1]));
      expect(
        [...accessed].filter((m) => m === 'planSources' || m === 'supplySources').sort(),
        file,
      ).toEqual(['planSources', 'supplySources']);
    }
  });
});
