# Copy a discipline for the task you are doing

**English** · [한국어](./index.ko.md)

Choose a recipe, check what it needs, and copy the configuration. Each recipe has a small passing
and breaking example to run.

Which host supplies the evidence a recipe reads is on the
[Host support](../reference/host-support.md) page.

<a id="keep-work-recoverable"></a>
## Keep work recoverable

- [Stop an agent from destroying work you cannot recover](./work-stays-recoverable.md) Needs: a
  connected session. Surface: Session (command text). Default: blocks. Values to change: none.
- [Stop an agent from deleting a whole directory with rm](./deletes-name-their-target.md) Needs: a
  connected session. Surface: Session (command text). Default: blocks. Values to change: none.

<a id="run-checks-and-read-output"></a>
## Run checks and read their output

- [Stop an agent from skipping your Git commit hook](./hooks-stay-armed.md) Needs: a commit hook in
  the repository. Surface: Session (command text). Default: blocks. Values to change: none.
- [Detect test and search output cut off by head or tail](./output-is-read-whole.md) Needs: a
  connected session. Surface: Session (command text). Default: advises. Values to change: check and
  search command list for your tools.

- [Detect added test skips, snapshots, and timeout settings](./tests-are-not-weakened.md) Needs:
  JavaScript or TypeScript test files. Surface: Session and change-set. Default: advises. Values to
  change: test paths and both spelling patterns.
- [Detect repeated test runs without an edit between them](./few-test-runs-per-edit.md) Needs:
  session history including the current call and edit success. Surface: Session (history). Default:
  advises. Values to change: both command patterns and the count.

<a id="change-dependencies"></a>
## Change dependencies

- [Detect dependency changes made outside pnpm](./pnpm-only.md) Needs: a project that uses pnpm.
  Surface: Session (command text). Default: advises. Values to change: none.

- [Check for a registry lookup before package.json is edited](./manifest-needs-evidence.md) Needs:
  dependencies from the npm registry and a root `package.json`. Surface: Session (earlier tool
  calls). Default: advises. Values to change: manifest path if it is not at the root.

<a id="keep-files-consistent"></a>
## Keep files consistent

- [Detect new uses of banned words without fixing every old one](./no-new-banned-words.md) Needs:
  selected words to avoid in source and tests. Surface: Session and change-set. Default: advises.
  Values to change: source paths and word list.
- [Keep every release heading in your changelog](./changelog-keeps-every-release.md) Needs:
  CHANGELOG.md with `## 1.2.3` or `## [1.2.3]` release headings. Surface: Session and change-set.
  Default: advises. Values to change: changelog path and both heading patterns if your layout
  differs.
- [Keep the same enum values in two JSON schemas](./schema-enums-agree.md) Needs: two valid JSON
  schemas whose selected enum arrays should contain the same values. Surface: Session and
  change-set. Default: advises. Values to change: both file paths, the scope pattern, and both
  selectors.
- [Check that English and Korean documents change together](./docs-stay-bilingual.md) Needs: paired
  English and Korean Markdown documents. Surface: Change-set only. Default: advises. Values to
  change: folder and language suffix.

<a id="keep-code-structure-and-names"></a>
## Keep code structure and names

- [Detect added references to a module's internal paths](./internal-modules-stay-internal.md) Needs:
  a module with a public entry point and internal paths. Surface: Session and change-set. Default:
  advises. Values to change: module paths and both import patterns.
- [Detect source file names with uppercase letters or
  underscores](./file-names-follow-the-convention.md)
  Needs: a file-name convention under your source folders. Surface: Session and change-set. Default:
  advises. Values to change: paths and the file-name pattern.

<a id="prepare-and-assign-edits"></a>
## Prepare and assign edits

- [Check that the design document was read before source files are
  edited](./document-read-before-edit.md)
  Needs: a design document for the selected source paths and a host that supplies earlier tool
  calls. Surface: Session (earlier tool calls). Default: advises. Values to change: edited paths and
  document path.
- [Detect when an implementer subagent edits tests](./tests-are-the-writers.md) Needs: separate
  subagents for test writing and implementation, with a fixed agent type name for the implementer.
  Surface: Session (actor). Default: advises. Values to change: test path pattern and subagent name.
