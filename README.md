# Polydeukes

**English** · [한국어](./README.ko.md)

> A development *discipline* framework for building alongside an AI coding partner. Deterministic
> covenants, a verifiable work ledger, a local memory graph, and adversarial verification — on one
> thin core.

**Status: alpha.** Five packages ship — `@polydeukes/core` (the covenant protocol),
`@polydeukes/covenant` (the judge), the two adapters (`adapter-claude-code`, `adapter-git`), and
the `polydeukes` umbrella, whose `pdks` bin (an alias of `polydeukes`) is the CLI. The ledger,
memory, and verify packages are still blueprint. The CLI today:

```sh
pdks init claude-code    # wire the Claude Code session surface into a project
pdks init grok           # wire the Grok session surface into a project
pdks covenant check      # judge the staged diff (the pre-commit entry point)
pdks covenant check --worktree            # the same judgment over the working tree
pdks covenant check --range main...HEAD   # ... or over a ref range (a PR's scope)
pdks explain             # print what each surface judges, skips, and excludes — no judgment
pdks docs [topic]        # read the bundled documentation, offline
```

The installer also drops a `discipline-draft` skill into `.claude/skills/`: describe a
recurring problem to your AI partner and the skill classifies it into a config entry — judged
at advise when the current families can express it, a `draft: true` entry otherwise.

Since v0.5.0 the default posture is diagnostic. A broken discipline lands as a recorded
advisory — exit 0, one `advised` telemetry row, the entry's own `why` on stderr — rather
than a refused call. What blocks unasked is the judging chain's self-protection;
`enforce: block` on an entry is a promotion its author chooses, and the promotion ladder
is `draft` → advise → block.

The documentation ships inside the package, so `pdks docs` answers from the same version that
does the judging — no network, and no drift between what a search engine indexed and what is
installed. The [Documents](#documents) table below is the same set plus the narrative layer,
grouped from getting started to reference. Planned — each arrives with its package: `pdks
verify` (adversarial verification) and `pdks ledger start <id>` (work tracking).

---

## What it is

Polydeukes externalizes the discipline a developer applies to themselves — test first, verify before
committing, record decisions, don't repeat the same mistake — into deterministic machinery, rather
than prompt-level requests, and shares that machinery with an AI partner.

The framing is partnership, not control. A covenant is not a fence that cages the AI; it is a shared
promise that applies equally to the human and the AI. The origin of the name and the philosophy
behind it are in [`STORY.md`](./STORY.md).

The design starts from an AI development harness embedded in a real production monorepo — the very
"harness engineering" framing this project sets out to reclaim — and from an analysis of whether
that machinery can be extracted into a general framework.

## Structure — a thin core plus independent packages

Not all-or-nothing: install only the pieces you need. Each package depends only on the core and
knows nothing of the others.

| Package | Role |
|---------|------|
| `@polydeukes/core` | Covenant protocol (stdin-JSON / exit-2), the config schema and its validation, algebra declaration schema, transcript interface — a minimal core that is agnostic to domain and agent. Reading a config off disk is the umbrella's `loadConfig`, not the core's: the core touches no file but its own telemetry log |
| `@polydeukes/covenant` | Deterministic judgment at edit and commit time, plus the meta-covenants that protect the judging chain itself |
| `@polydeukes/ledger` | Work tracking. Completion authority moves from "I'm done" to "the actions passed" |
| `@polydeukes/memory` | A local SQLite + FTS5 store. Turns decisions and dead ends into searchable memory. Syncing is an optional adapter (local by default) |
| `@polydeukes/verify` | A multi-agent adversarial verification orchestrator |

The recommended adoption order is `covenant` → `memory` → `ledger` → `verify`. `covenant` and
`memory` pay off immediately regardless of project size, while `ledger` and `verify` shine at the
scale of multiple worktrees and team workflows.

## Design blueprint (in brief)

The core principle of the extraction strategy is a one-way layering: **general core inward, domain
outward**, with every dependency pointing inward at the core and none pointing back out. The core
knows nothing of any specific product or AI runtime.

```text
@polydeukes/core            domain- and agent-agnostic patterns
        △                   (covenant protocol, ledger engine, meta-covenant, memory engine)
        │ depends on (one direction)
@polydeukes/adapter-*        hides runtime/infra coupling behind the core
        │                   · adapter-claude-code  (PreToolUse payload ↔ canonical)
        │                   · adapter-pi, etc.
        │                   · sync (optional): local by default; s3/git/gcs/nfs as adapters
        △
        │ scaffolds into
create-polydeukes           externalizes domain-specific values into templates/config
                            (ticket regex, path globs, scope→command mapping, etc.)
```

Three separations:

- **Language ⊥ agent** — language coupling (test commands, path globs for TS/Python/Go) goes in
  `polydeukes.config.yaml`; AI-runtime coupling (transcript schema) goes in `adapter-*`. The two are
  orthogonal.
- **Essential vs incidental** — "verification is decided by exit code" is essential; "that command
  happens to be vitest" is incidental (config). "Knowledge is a local SQLite file" is essential;
  "that file happens to live on S3" is incidental (a sync adapter).
- **Measurement as a first-class citizen** — collect covenant-ROI and memory-search telemetry, then
  feed it back in a closed loop. Prove "it produces safer code" with data.

## Documents

[`docs/README.md`](./docs/README.md) is the documentation index — the same map as below,
with a one-page summary of how the framework works. The tables here are grouped by layer;
start at the top layer you need.

### Getting started

| Document | Contents |
|----------|----------|
| [`docs/installation.md`](./docs/installation.md) | Install guide — the session surface (`pdks init claude-code` · `pdks init grok`) and the manually wired commit surface |

### Guides

| Document | Contents |
|----------|----------|
| [`docs/configuration.md`](./docs/configuration.md) | Config guide — the file, discovery, IDE wiring, and what enforcement looks like |
| [`docs/troubleshooting.md`](./docs/troubleshooting.md) | The fail-closed states and how to recover, reading verdicts, and the witness valve |

### Reference

| Document | Contents |
|----------|----------|
| [`docs/reference/configuration.md`](./docs/reference/configuration.md) | Configuration reference — every key, its rules, and its pitfalls |
| [`docs/reference/`](./docs/reference/polydeukes.md) | Package reference — subcommands, exit codes, and what each of the five packages owns |

### Why, and the journal

| Document | Contents |
|----------|----------|
| [`STORY.md`](./STORY.md) | The origin of the name and the design philosophy (a founder's narrative) |
| [`docs/why-polydeukes.md`](./docs/why-polydeukes.md) | Why Polydeukes? — the design whitepaper: the principles, the failure stories behind them, and the measurements that settled each one |
| [`docs/build-in-public/`](./docs/build-in-public/2026-07-v0.1-covenant-core.md) | Build-in-public series — one post per milestone, starting with v0.1 (covenant core + measurement) |
| [`CHANGELOG.md`](./CHANGELOG.md) | Release notes per milestone |

## License

[MIT](./LICENSE)
