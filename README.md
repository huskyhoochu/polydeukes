# Polydeukes

**English** · [한국어](./README.ko.md)

> A development *discipline* framework for building alongside an AI coding partner.
> Deterministic covenants, a verifiable work ledger, a local memory graph, and adversarial verification — on one thin core.

**Status: pre-alpha.** The first units have landed in `@polydeukes/core` (covenant protocol, ROI telemetry, config loader), `@polydeukes/covenant` (the run_covenant wrapper, heredoc-aware multi-line Bash analysis with its write-detection rules (redirect/tee/`sed -i`), the path-routing dispatcher, the self-mod meta-covenant with its escape hatch, and the shell-mod meta-covenant that assembles the detection rules into a Bash-axis judge with a read-only allowlist), and `@polydeukes/adapter-claude-code` (PreToolUse payload → covenant input IR up-translation); everything else is still blueprint. This repository holds that early core plus the architecture blueprint and the reasoning behind it. What follows is a description of what is being built.

---

## What it is

Polydeukes externalizes the discipline a developer applies to themselves — test first, verify before committing, record decisions, don't repeat the same mistake — into deterministic machinery, rather than prompt-level requests, and shares that machinery with an AI partner.

The framing is partnership, not control. A covenant is not a fence that cages the AI; it is a shared promise that applies equally to the human and the AI. The origin of the name and the philosophy behind it are in [`STORY.md`](./STORY.md).

The design starts from an AI development harness embedded in a real production monorepo — the very "harness engineering" framing this project sets out to reclaim — and from an analysis of whether that machinery can be extracted into a general framework.

## Structure — a thin core plus independent packages

Not all-or-nothing: install only the pieces you need. Each package depends only on the core and knows nothing of the others.

| Package | Role |
|---------|------|
| `@polydeukes/core` | Covenant protocol (stdin-JSON / exit-2), config loader, transcript interface — a minimal core that is agnostic to domain and agent |
| `@polydeukes/covenant` | Deterministic PreToolUse hooks at edit and push time, plus a self-mod meta-covenant that protects the covenants themselves |
| `@polydeukes/ledger` | Work tracking. Completion authority moves from "I'm done" to "the actions passed" |
| `@polydeukes/memory` | A local SQLite + FTS5 store. Turns decisions and dead ends into searchable memory. Syncing is an optional adapter (local by default) |
| `@polydeukes/verify` | A multi-agent adversarial verification orchestrator |

The recommended adoption order is `covenant` → `memory` → `ledger` → `verify`. `covenant` and `memory` pay off immediately regardless of project size, while `ledger` and `verify` shine at the scale of multiple worktrees and team workflows.

## Design blueprint (in brief)

The core principle of the extraction strategy is that dependencies always point **inward (general core) → outward (domain), one direction only**. The core knows nothing of any specific product or AI runtime.

```
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

- **Language ⊥ agent** — language coupling (test commands, path globs for TS/Python/Go) goes in `polydeukes.config.ts`; AI-runtime coupling (transcript schema) goes in `adapter-*`. The two are orthogonal.
- **Essential vs incidental** — "verification is decided by exit code" is essential; "that command happens to be vitest" is incidental (config). "Knowledge is a local SQLite file" is essential; "that file happens to live on S3" is incidental (a sync adapter).
- **Measurement as a first-class citizen** — collect covenant-ROI and memory-search telemetry, then feed it back in a closed loop. Prove "it produces safer code" with data.

Three verified gaps to close before extraction: the Bash bypass route around self-protection, the `status` leak in completion judgment, and the dormant measurement infrastructure.

## Documents

| Document | Contents |
|----------|----------|
| [`STORY.md`](./STORY.md) | The origin of the name and the design philosophy (a founder's narrative) |

## CLI (planned)

```sh
$ pdks verify              # run verification actions
$ pdks ledger start <id>   # start a unit of work
$ pdks covenant check      # check the covenants
```

`pdks` is an alias for `polydeukes`.

## License

[MIT](./LICENSE)
