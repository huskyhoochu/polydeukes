# Copy a discipline for the task you are doing

**English** · [한국어](./index.ko.md)

Choose a recipe, check what it needs, and copy the configuration. Each recipe has a small passing
and breaking example to run.

<a id="keep-work-recoverable"></a>
## Keep work recoverable

- [Stop an agent from destroying work you cannot recover](./work-stays-recoverable.md) Needs: a
  Claude Code or Codex session. Surface: Session (Claude Code, Codex). Default: blocks. Values to
  change: none.
- [Stop an agent from deleting a whole directory with rm](./deletes-name-their-target.md) Needs: a
  Claude Code or Codex session. Surface: Session (Claude Code, Codex). Default: blocks. Values to
  change: none.

<a id="run-checks-and-read-output"></a>
## Run checks and read their output

- [Stop an agent from skipping your Git commit hook](./hooks-stay-armed.md) Needs: a commit hook in
  the repository. Surface: Session (Claude Code, Codex). Default: blocks. Values to change: none.
- [Detect test and search output cut off by head or tail](./output-is-read-whole.md) Needs: a Claude
  Code or Codex session. Surface: Session (Claude Code, Codex). Default: advises. Values to change:
  check and search command list for your tools.

<a id="change-dependencies"></a>
## Change dependencies

- [Detect dependency changes made outside pnpm](./pnpm-only.md) Needs: a project that uses pnpm.
  Surface: Session (Claude Code, Codex). Default: advises. Values to change: none.

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
