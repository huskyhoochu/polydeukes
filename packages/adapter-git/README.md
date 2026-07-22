# @polydeukes/adapter-git

**English** · [한국어](./README.ko.md)

> The boundary where git's vocabulary is translated away. A staged diff becomes the agent-neutral covenant input IR at commit time — the same judgment for every hand, AI or human.

**Pre-alpha.** Not yet published to npm. This is the second adapter, and its existence is itself the proof of IR neutrality: it fills the same `fileChanges` evidence the Claude Code adapter fills — from git blobs instead of virtual applies — and the core consumed both without a single changed line.

## What lives here

- **Staged-change collection** — `collectStagedChanges(repoRoot)` reads the staging area with `--no-renames` forced on, so a rename is judged as a deletion plus an addition (a `git mv` of a protected file must not slip through as one opaque rename entry). `pre` comes from the HEAD blob and `post` from the STAGED blob — never the worktree, which may have diverged after `git add`. A binary blob (NUL heuristic) yields null content instead of lossily decoded bytes, and the unborn first commit narrows to all-added instead of throwing.
- **Pure translation** — `covenantInputFromStagedChanges(changes)` folds the collected changes into one `CovenantInput`: one tool call per change under the adapter-owned names `staged-write`/`staged-delete`, pre/post pairs in `fileChanges` for writes (a deletion has no post content, so its element is omitted while its tool call survives), and honestly empty session collections — the commit surface has no session, and keys are never fabricated.
- **Nothing else, on purpose** — this is a pure library. It knows the staged-diff payload format and nothing about installation, hook runners, or valves. The umbrella's `pdks covenant check` assembles it into the pre-commit surface; wiring it into a hook runner is a deployment act that lives outside this module.

See the [project repository](https://github.com/huskyhoochu/polydeukes) for the architecture blueprint and design rationale.

## License

MIT
