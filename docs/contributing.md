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
  `{path,title,summary}`. Write titles and summaries as plain text. Markdown formatting such as
  backticks is displayed literally in website titles and navigation.
- `bundled: true` files are copied into the installed `pdks docs` library. `bundled: false`
  files appear in the repository and on the documentation website; `pdks docs` excludes them.
  This page and the design explanation are `bundled: false`.

Do not add a `docs/*.md` file that the catalog does not name.

<a id="website"></a>
## Documentation website

`packages/documentation` builds the website from every catalog entry, including `bundled: false`.
Its `sync-docs.mjs` script creates the ignored `src/content/docs/` tree and `src/generated/sidebar.json`.
Edit the originals under `docs/`; the next build replaces generated files.

In the Reference sidebar, `reference/cli/` and `reference/packages/` form separate groups.
Other reference pages, including configuration and declaration language, remain direct links.

The sync step removes the document title and language switch, writes catalog metadata as frontmatter,
and converts Markdown links into site routes. English pages use `/docs/`, Korean pages `/ko/docs/`.
A link to `.ko.md` selects Korean; a link to `.md` selects English. Links outside `docs/` point to
GitHub. Stable section anchors and dots in version filenames are preserved.

`pnpm -F @polydeukes/documentation build` runs sync and Astro. Vercel uses that command and publishes
`packages/documentation/dist`. Check rendered pages in both languages after changing the transform.

<a id="examples-and-checks"></a>
## Examples and check commands

Copy-paste examples must be consumer-shaped: paths and patterns a reader can run in their
own project. When an example is this repository's live config, say so in the prose next to
it.

Exercise a new declaration in an isolated example project, not by violating this
repository's protected files. Prefer `git diff HEAD | pdks covenant check --diff` for
file-backed examples and the hook probe in [the first-judgment tutorial](./tutorials/first-judgment.md)
for session writes.

TypeScript examples import only symbols a package contract exports. The umbrella
publishes no TypeScript entry point — it is reached as the `pdks` bin — so those symbols
come from `@polydeukes/core` or an agent adapter.

Before committing a docs change, run:

```sh
node scripts/check-docs.mjs
```

The checker requires bilingual pairs, catalog coverage, and that local Markdown links resolve
to an existing file and, when they carry a fragment, to an existing heading slug or explicit
id.

<a id="check-commands"></a>
## What to run

| Command | What it checks |
|---|---|
| `node scripts/check-docs.mjs` | Pairs, catalog, local links and anchors |
| `pnpm -F polydeukes exec vitest run __tests__/check-docs.test.ts` | Checker regressions |
| `pdks docs search <query>` / `pdks docs show <id>` | Installed bundle after a build that copies `docs/` |
| `pnpm -F polydeukes exec vitest run __tests__/declaration-reference.test.ts __tests__/sync-docs.test.ts` | Complete vocabulary tables and website transformations |
| `pnpm -F @polydeukes/documentation build` | Generated content, routes, and static website build |
