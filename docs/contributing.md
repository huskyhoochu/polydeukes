# Contributing to the documentation

**English** · [한국어](./contributing.ko.md)

This page is the public editorial contract for `docs/`. It is not bundled into `pdks docs`.
Product behaviour stays in the guides and references; this page says how those files are
kept.

<a id="bilingual-pairs"></a>
## Keep English and Korean paired

Every Markdown body under `docs/` has an English file and a `.ko.md` mirror. Stage both sides
of a pair together. Vocabulary in Korean uses a translation plus an English gloss on first
mention (`약속(covenant)`), not a transliteration. Do not invent a Korean file only to
satisfy a checker, and do not leave one side of a pair unpublished.

<a id="stable-ids"></a>
## Stable section IDs

Section IDs are explicit HTML anchors, identical across languages:

```md
<a id="section-id"></a>
## Heading
```

IDs are lowercase ASCII kebab-case. Put the `<a id>` on its own line immediately before the
heading. Every H2/H3 that is independently retrievable gets a stable ID. H1 is the document
title, not a section. Automatic heading links may remain; do not rename an old heading
without keeping its previous slug or explicit id.

<a id="catalog"></a>
## Catalog, bundle, and redirects

`docs/catalog.json` is the single list. Every Markdown file under `docs/` is a `documents`
entry.

- `documents` entries carry `id`, `category`, `order`, `bundled`, and `en`/`ko`
  `{path,title,summary}`. Titles and summaries live in the catalog so the Markdown stays
  plain.
- `bundled: true` files are copied into the installed `pdks docs` library. `bundled: false`
  files stay in the repository and on GitHub; they are not searched or shown by `pdks docs`.
  This page and the dated development records are `bundled: false`.

Do not add a `docs/*.md` file that the catalog does not name.

<a id="examples-and-checks"></a>
## Examples and check commands

Copy-paste examples must be consumer-shaped: paths and patterns a reader can run in their
own project. When an example is this repository's live config, say so in the prose next to
it.

Exercise a new declaration in an isolated example project, not by violating this
repository's protected files. Prefer `pdks covenant check --worktree` for file-backed
examples and the hook probe in [the first-judgment tutorial](./tutorials/first-judgment.md)
for session writes.

TypeScript examples import only symbols the package contract exports (`polydeukes` and
`polydeukes/claude-code`).

Before committing a docs change, run:

```sh
node scripts/check-docs.mjs
```

The checker requires bilingual pairs, catalog coverage, and that local Markdown links resolve
to an existing file and, when they carry a fragment, to an existing heading slug or explicit
id.

<a id="historical-records"></a>
## Historical records

`docs/build-in-public/` files are dated development records. Keep the events, numbers,
quotations, and vocabulary they shipped with. Do not shorten them into move notices. Do not
rewrite a dated term that was correct on the day the post was published.

<a id="check-commands"></a>
## What to run

| Command | What it checks |
|---|---|
| `node scripts/check-docs.mjs` | Pairs, catalog, local links and anchors |
| `pnpm -F polydeukes exec vitest run __tests__/check-docs.test.ts` | Checker regressions |
| `pdks docs search <query>` / `pdks docs show <id>` | Installed bundle after a build that copies `docs/` |
