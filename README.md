# Polydeukes

**English** · [한국어](./README.ko.md)

[![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/huskyhoochu/polydeukes)

> A development _discipline_ framework for building alongside an AI coding partner. Deterministic
> covenants, a verifiable work ledger, a local memory graph, and adversarial verification — on one
> thin core.

<a id="quick-start"></a>
## Quick start

Choose one of [four installation routes](./docs/how-to/install.md). For example, with Homebrew:

```sh
brew install huskyhoochu/polydeukes/pdks
brew install huskyhoochu/polydeukes/pdks-claude-code
```

The first command installs the Rust judge; the second adds the optional Claude Code adapter. Codex
uses `pdks-codex`; project memory uses `pdks-memory`. Each is installed separately.

### 1. Connect your agent

Run from your project root in your own terminal:

```sh
pdks-claude-code init
# With the Codex extension installed instead:
# pdks-codex init
```

Reopen Claude Code, or approve Codex hooks through `/hooks`, then verify a real call in
`.polydeukes/roi.log`. For Git diff checks alone, run `pdks init`. Existing installations should
follow the [migration guide](./docs/how-to/migrate-to-rust.md).

### 2. Configure your first discipline

Open the generated `polydeukes.config.yaml` in your editor. Keep the generated `protectedPaths` and
`witness` blocks. Add this `disciplines` list, or append the entry to your existing list. It reports
newly added lines containing `TODO` in `src/`:

```yaml
disciplines:
  - id: "no-new-todo-lines"
    why: "Resolve TODOs before adding source lines."
    enforce: advise
    declare:
      mechanism: "added-only"
      scope: { source: "target.path", include: ["^src/"] }
      supply: { pre: "empty", post: "empty" }
      extract:
        before:
          - { op: "source", of: "pre" }
          - { op: "lines" }
          - { op: "keyByPattern", re: "(.*TODO.*)" }
        after:
          - { op: "source", of: "post" }
          - { op: "lines" }
          - { op: "keyByPattern", re: "(.*TODO.*)" }
        added:
          - { op: "onlyIn", of: "after", notIn: "before" }
      relate:
        - id: "nothing-added"
          relation: { op: "empty", of: "added" }
          message: "Resolve this TODO: {value}"
```

Unchanged TODO lines are allowed; repeating an identical existing line is also treated as already
present. `advise` reports a violation and lets work continue. Choose `enforce: block` when you want
the entry to stop a session call. Diff checks also need `--enforce block` to stop on a blocking
entry.

The config file itself is protected during agent sessions. Edit it yourself, or use the
[witness
procedure](./docs/how-to/connect-surfaces.md#witness-and-recovery)
for an intentional agent edit. In Claude Code, the installed `discipline-draft` skill can help turn
a problem you describe into an entry.

### 3. Check the result

```sh
pdks explain
git diff HEAD | pdks covenant check --diff
```

`explain` should list `no-new-todo-lines` as `declare` on both surfaces. To see a violation, add a
new `// TODO: quick-start check` line to a tracked file under `src/`, then rerun the diff command.
Expect a diagnostic naming the discipline, an `advised` row in `.polydeukes/roi.log`, and exit code 0.
Remove the line and rerun; that diagnostic should disappear.

Continue with [more discipline examples](./docs/how-to/write-disciplines.md),
[pre-commit
integration](./docs/how-to/connect-surfaces.md#change-set-surface),
or `pdks docs` for the installed documentation.

<a id="status-and-cli"></a>
## Status and CLI

The project ships a Rust judge, three optional extensions, and TypeScript, Rust, and Python SDKs.
Disciplines advise by default; authors choose which should block. Configuration and registration
path protection is handled separately.

```sh
pdks init
pdks explain
git diff --cached | pdks covenant check --diff
git diff main...HEAD | pdks covenant check --diff
pdks docs install
pdks docs search 'configuration'
```

After installing memory and configuring a document collection, use `pdks memory search <query>` and
`pdks memory show <id>` to retrieve evidence. Follow the [walkthrough](./docs/how-to/use-memory.md).

<a id="what-it-is"></a>
## What it is

Polydeukes externalizes the discipline a developer applies to themselves — test first, verify before
committing, record decisions, don't repeat the same mistake — into deterministic machinery, rather
than prompt-level requests, and shares that machinery with an AI partner.

The framing is partnership, not control. A covenant is not a fence that cages the AI; it is a shared
promise that applies equally to the human and the AI. The origin of the name and the philosophy
behind it are in [`STORY.md`](./STORY.md).

The design starts from AI development tooling embedded in a real production monorepo, and from an
analysis of whether that tooling can be extracted into a general discipline framework.

<a id="thin-core-and-packages"></a>
## Executables and SDKs

| Component                | Role                                                     |
| ------------------------ | -------------------------------------------------------- |
| `pdks`                   | Configuration, judgment, explanation, embedded docs      |
| `pdks-claude-code`       | Claude Code event translation and hook registration      |
| `pdks-codex`             | Codex event translation, tool history, hook registration |
| `pdks-memory`            | Current Markdown queries, links, and local usage history |
| `@polydeukes/sdk-ts`     | TypeScript process client                                |
| `polydeukes-sdk` (crate) | Rust process client                                      |
| `polydeukes-sdk` (PyPI)  | Python process client                                    |

<a id="design-blueprint"></a>
## Design principles

Adapters supply observed evidence; the judge compares it with declared promises. Missing evidence is
made visible in the result. The [design explanation](./docs/why-polydeukes.md) describes observation
boundaries, witnesses, and the choice between advice and blocking.

<a id="documents"></a>
## Documents

[`docs/README.md`](./docs/README.md) is the documentation index — the same map as below, with a
one-page summary of how the framework works. The tables here are grouped by layer; start at the top
layer you need.

<a id="tutorials-and-guides"></a>
### Tutorials and guides

| Document                                                                 | Contents                                                                                  |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| [`docs/tutorials/first-judgment.md`](./docs/tutorials/first-judgment.md) | First visible judgment — install, wire Claude Code, and watch a protected edit get judged |
| [`docs/how-to/connect-surfaces.md`](./docs/how-to/connect-surfaces.md)   | Connect the session and change-set surfaces, including Codex                              |
| [`docs/how-to/configure-project.md`](./docs/how-to/configure-project.md) | Configure the project file, IDE support, and advise versus block                          |
| [`docs/how-to/write-disciplines.md`](./docs/how-to/write-disciplines.md) | Worked declarations, starting with an added-line check                                    |
| [`docs/troubleshooting.md`](./docs/troubleshooting.md)                   | Fail-closed states, the witness valve, and the telemetry log                              |

<a id="reference-layer"></a>
### Reference

| Document                                                                                         | Contents                                                                                |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| [`docs/reference/configuration/index.md`](./docs/reference/configuration/index.md)               | Configuration reference — every key, its rules, and its pitfalls                        |
| [`docs/reference/declaration-language/index.md`](./docs/reference/declaration-language/index.md) | Declaration language reference — every source, extraction step, relation, and mechanism |
| [`docs/reference/packages/polydeukes.md`](./docs/reference/packages/polydeukes.md)               | Package reference — subcommands, exit codes, and the package contract                   |

<a id="why-and-the-journal"></a>
### Background and releases

| Document                                                                             | Contents                                                                                                                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| [Introducing Polydeukes (Korean)](https://funes-days.com/dev/polydeukes-open-source) | The author's introduction to the project on funes-days                                                                               |
| [`STORY.md`](./STORY.md)                                                             | The origin of the name and the design philosophy (a founder's narrative)                                                             |
| [`docs/why-polydeukes.md`](./docs/why-polydeukes.md)                                 | Why Polydeukes? — the design whitepaper: the principles, the failure stories behind them, and the measurements that settled each one |
| [`CHANGELOG.md`](./CHANGELOG.md)                                                     | Release notes per milestone                                                                                                          |

<a id="license"></a>
## License

[MIT](./LICENSE)

<a id="learning-path"></a>
## Read the guide

Start with **installation → first judgment → connection and configuration → discipline authoring**.

| Your task                                       | Guide                                                      |
| ----------------------------------------------- | ---------------------------------------------------------- |
| Choose packages and extensions                  | [Install](./docs/how-to/install.md)                        |
| See an allowed and a blocked observation        | [First judgment](./docs/tutorials/first-judgment.md)       |
| Connect an agent, Git, or CI                    | [Connect surfaces](./docs/how-to/connect-surfaces.md)      |
| Turn recurring mistakes into a discipline       | [Write disciplines](./docs/how-to/write-disciplines.md)    |
| Retrieve decisions and evidence                 | [Use memory](./docs/how-to/use-memory.md)                  |
| Invoke judgment from a program                  | [SDKs and references](./docs/README.md#reference-packages) |
| Diagnose skips, blocks, and installation errors | [Troubleshooting](./docs/troubleshooting.md)               |
| Upgrade an earlier installation                 | [Migrate to Rust](./docs/how-to/migrate-to-rust.md)        |

The [documentation home](./docs/README.md) connects these learning paths with the command
references.
