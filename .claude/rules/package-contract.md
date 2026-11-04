---
paths:
  - "packages/sdk-ts/src/index.ts"
  - "packages/sdk-ts/package.json"
  - "packages/sdk-ts/README.md"
---

# TypeScript SDK package contract

A package's **contract** is everything it promises its consumers: the `exports` subpath set plus the
symbols each entry-point barrel re-exports. README-named symbols are part of it.

The one-sentence definition of a simple interface here:
**a contract exports nothing beyond
what a caller must know to fill one spec.**

## Executor verbs

- One spec object in, one named result out. The parameter list is exactly one parameter typed
  `<Verb>Spec`; there are no positional parameters, not even one — a verb that takes a bare
  `rootDir: string` leaves its role implicit; the spec's field name is what says what the value
  means at the call site.
- The result is the package's own `<Verb>Verdict` (when it carries the judgment vocabulary —
  passed/blocked/…) or `<Verb>Outcome` (otherwise), bare, inside `Promise<…>`, or as a `|` union of
  named types. A verb may share another verb's result type from the same package; `checkChangeSet`
  returns `CheckCovenantVerdict` from this package. An anonymous object literal, a function type, or
  an `&` intersection as a return type breaks the shape — name it.
- The input type is `<Verb>Spec`. `Options` and `Params` are not spec names.
- **Types are contract.** Internal concept types stay inside.

## Entry points

The SDK exports `.` as its consumer contract. Condition keys (`types` / `import` / `default`) are
not entry points.

## Barrels

- The source behind every code entry point is a barrel: `export { … } from` and
  `export type { … } from` statements plus comments, nothing else. No definitions, no `import` (a
  re-export needs none, `import type` included), no `export *` in any form (`export * as ns`
  re-exports a whole module under one name — the contract lists names). ESM re-exports are eager, so
  a definition in a barrel is instantiated by every consumer of any other export. Keep re-exports
  static.
- The barrel is the **consumer contract, not the test surface**. A package's own tests import
  `../src/<module>.ts` directly, never `../src/index.ts` in any spelling. A package has one barrel.
- A symbol has one entry point. Two entry points may re-export the same module only when they carry
  different names from it. A barrel never re-exports another barrel.
- Adding a name to a barrel widens the contract. The reason must be a consumer or the README needing
  it.

## README

README-named symbols are contract, in the reverse direction:
**a README may not name a symbol
outside the contract.**
Which symbols stay in the contract is decided per symbol when a barrel is narrowed — a consumer need
stays and its README line stays; an internal explanation moves to `docs/reference/`.
