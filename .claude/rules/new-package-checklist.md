---
paths:
  - "release-please-config.json"
  - ".release-please-manifest.json"
  - "packages/*/package.json"
  - "packages/*/Cargo.toml"
  - "packages/*/pyproject.toml"
  - ".github/workflows/**"
  - ".forgejo/workflows/**"
  - "_docs/prd/**"
---

# New-package checklist and release registrations

Registrations here are enumerated, not inferred, so a new package silently misses them. Each has
been forgotten at least once, surfacing later as a confusing failure rather than an obvious one.
A PRD that creates a package lists every item below as an acceptance criterion.

## An npm package

1. **`vitest.config.ts` alias** — map `@polydeukes/core` to its *source*. The exports map points
   at `dist`, so without the alias `pnpm -F <pkg> test` breaks on a clean clone.
2. **`release-please-config.json` `extra-files`** — the list is explicit, so a new package's
   version file is not bumped until it is registered. **If a release PR is already open, editing
   the config is not enough**: release-please compares release notes, not the file list, so it
   logs `PR #N remained the same` and leaves the stale branch while the workflow reports success.
   Close the PR (`tea pr close <N>`), delete its head branch (`git push origin --delete <branch>`),
   and rerun the workflow. **The rerun may not recover**: on 2026-09-16 the action's branch
   creation answered 500 on every retry while the same call with an owner token answered 201, and
   a closed PR's `refs/pull/N/head` cannot be removed over the API (405). Then write the release
   commit by hand: every manifest and `.release-please-manifest.json` to the new version, the
   CHANGELOG section the bot had composed on the closed PR, committed as
   `chore(main): release X.Y.Z`. An empty `chore:` commit is the only rerun — the workflow has no
   `workflow_dispatch`.
3. **`workspace:^` for internal dependencies** — never a version range.
4. **npm trusted publishing is registered per package, and only after the package exists.** A new
   name has no access page, so the workflow's OIDC token answers `ENEEDAUTH` and stops the whole
   `pnpm -r publish` walk there. Publish the first version by hand from the tagged tree —
   `pnpm publish --access public --no-git-checks --otp=<authenticator code>` (`npm publish`
   rejects the bin for a missing exec bit that pnpm does not check; the browser-auth path never
   opens its URL). Then register `huskyhoochu` / `polydeukes` / `publish.yml` on the new access
   page and rerun the workflow. **Which packages the workflow publishes is read off the registry**:
   `dist.attestations` on the latest version is present only when the workflow uploaded it.

The publish e2e suites (`publish-pack.e2e.test.ts`, `clean-install.e2e.test.ts`) derive their
package set from the non-private `packages/*` manifests, so a new package is covered the moment
it exists.

## A cargo crate

A `toml` entry in `release-please-config.json` `extra-files` (`$.package.version` of its
`Cargo.toml`), a `cargo test` step in `.forgejo/workflows/ci.yml` after the build, and a crates.io
trusted publisher (repository `huskyhoochu/polydeukes`, workflow `publish.yml`) on the crate's
settings page. The publisher can only be registered once the crate exists, so the first version
is published by hand from the tagged tree with a `publish-new` token.

## A Python package

A `toml` extra-file registration for `$.project.version` in its `pyproject.toml` and the SDK
version in `uv.lock`, explicit uv checks in Forgejo CI, and a PyPI OIDC publish job after the
standalone executable builds. Commit its uv lockfile and include `py.typed` in the wheel. Runtime
dependencies stay in `project.dependencies`; code generation and checking tools belong to the
development dependency group. Its first release requires the owner to configure a PyPI pending
publisher for `huskyhoochu/polydeukes`, workflow `publish.yml`, environment `pypi`, and the
matching GitHub environment. The pinned TOML updater exposes parsed scalar nodes as
`{value, start, end}`, so the lockfile JSONPath filters by `@.name.value` before selecting
`.version`; recheck that path when upgrading the action.
