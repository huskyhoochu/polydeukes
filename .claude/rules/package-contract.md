---
paths:
  - "packages/*/src/index.ts"
  - "packages/*/src/claude-code.ts"
  - "packages/*/src/claude-code-hook.ts"
  - "packages/*/package.json"
  - "packages/*/README.md"
---

# Package contract — the shape every package's outer boundary takes

A package's **contract** is everything it promises its consumers: the `exports` subpath set plus
the symbols each entry-point barrel re-exports. README-named symbols are part of it. The
vocabulary is in `domain-terms.md` § Package contract; the test that keeps the shape is
`packages/polydeukes/__tests__/package-contract.test.ts` (its `KNOWN_VIOLATIONS` list is the
ratchet — application tickets shrink it, and an added entry is a review event).

The one-sentence definition of a simple interface here: **a contract exports nothing beyond
what a caller must know to fill one spec.**

## Two skeletons, no third

| Skeleton | Packages | Runtime exports | Other exports | Discriminator |
|---|---|---|---|---|
| **executor** | covenant, adapter-*, polydeukes | **verbs** — each takes **one spec object** and returns **one result** | the types a spec needs, spec ingredients | takes a spec |
| **vocabulary** | core | positional pure functions, protocol primitives | types, `as const` tuples | takes no spec |

A function that takes a spec is executor code and does not belong in core. A package that seems
to need a third skeleton is split wrong.

## Executor verbs

- One spec object in, one result out. Two or more positional parameters break the shape.
- The result is a core-named type, or the package's own `<Verb>Verdict` (when it carries the
  judgment vocabulary — passed/blocked/…) or `<Verb>Outcome` (otherwise). An anonymous object
  literal as a return type breaks the shape.
- The input type is `<Verb>Spec`. `Options` and `Params` are not spec names.
- **Types are contract.** Internal concept types (`Item`, `World`, `PairedItems`) stay inside.
- **Spec ingredients** are the only constants a contract carries: values used to fill a field of
  an exported spec type (`SHELL_TOOLS` fills `CompileDisciplinesSpec.shellTools`). A constant no
  spec consumes is implementation.

## Entry points

Three kinds of `exports` subpath: `.` (the contract), a `.json` data file (`./schema.json`,
`./algebra-declaration.schema.json` — the subpath and its target both end in `.json`), and
`./<surface>` — the umbrella alone, closed list
`['./claude-code']` kept as a literal in the test. Adding a surface entry point edits that
literal, and the diff is the review signal. Sibling packages have `.` alone. Condition keys
(`types` / `import` / `default`) are not entry points — covenant's `default` is the fallback that
keeps `createRequire` resolution alive.

## Barrels

- The source behind every code entry point is a barrel: `export { … } from` and
  `export type { … } from` statements plus comments, nothing else. No definitions, no
  `import` (a re-export needs none, `import type` included), no `export *` in any form
  (`export * as ns` re-exports a whole module under one name — the contract lists names).
  ESM re-exports are eager, so a definition in a barrel is instantiated
  by every consumer of any other export — and that eagerness is load-bearing: the umbrella's
  fail-closed proof is that a dist missing one module throws on the barrel import, before any
  assembly. Keep re-exports static.
- The barrel is the **consumer contract, not the test surface**. A package's own tests import
  `../src/<module>.ts` directly. There is no second barrel (`internal.ts`).
- The umbrella is not a facade: it re-exports no sibling verbs. From `@polydeukes/*` only
  `export type` (the `loadConfig` result type `ResolvedConfig` is the one case).
- Adding a name to a barrel widens the contract. The reason must be a sibling package, the
  umbrella, or the README needing it.

## README

README-named symbols are contract, in the reverse direction: **a README may not name a symbol
outside the contract.** Which symbols stay in the contract is decided per symbol when a barrel is
narrowed — a consumer need stays and its README line stays; an internal explanation moves to
`docs/reference/`.
