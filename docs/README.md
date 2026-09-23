# Polydeukes documentation

**English** · [한국어](./README.ko.md)

Polydeukes is a development discipline framework for building alongside an AI coding partner.
Choose a guide for your task below.

<a id="start-here"></a>
## Start here

| If you want to | Read |
|---|---|
| Get to a first visible judgment | [First judgment](./tutorials/first-judgment.md) — install, wire Claude Code, and watch one protected edit get judged |
| Connect Claude Code, Grok, Codex, or git | [Connect the surfaces](./how-to/connect-surfaces.md) — session and commit setup, including Grok and Codex |
| Shape the project config | [Configure the project](./how-to/configure-project.md) — discovery, IDE support, and advise versus block |
| Write a real discipline | [Write disciplines](./how-to/write-disciplines.md) — worked declarations, especially locale key pairing |
| Recover from a block or skip | [Troubleshooting](./troubleshooting.md) — the fail-closed states, the witness valve, and the log |
| Understand why the framework exists | [Why Polydeukes?](./why-polydeukes.md) — the design whitepaper |
| Contribute to these docs | [Contributing](./contributing.md) — bilingual pairs, stable IDs, catalog, and checks |

<a id="reference"></a>
## Reference

<a id="reference-cli"></a>
### CLI commands

| Command | Purpose |
|---|---|
| [`pdks covenant check`](./reference/cli/covenant-check.md) | Judge an input IR or unified diff; read verdicts and exit codes |
| [`pdks init`](./reference/cli/init.md) | Create project configuration |
| [`pdks explain`](./reference/cli/explain.md) | Inspect registered disciplines and enforcement |
| [`pdks docs`](./reference/cli/docs.md) | Search and retrieve installed documentation |

<a id="reference-configuration"></a>
### Configuration

[Configuration reference](./reference/configuration/index.md) covers `polydeukes.config.yaml`
keys, enforcement levels, discipline lists, and witness settings.

<a id="reference-declaration-language"></a>
### Declaration language

[Declaration language reference](./reference/declaration-language/index.md) lists every source,
extraction step, combinator, relation, and mechanism with its syntax and constraints.

<a id="reference-packages"></a>
### Packages

| Package | Responsibility |
|---|---|
| [`polydeukes` (the `pdks` CLI)](./reference/packages/polydeukes.md) | Package contract, and the judge that lives inside it; subcommands live under [`reference/cli/`](./reference/cli/covenant-check.md) |
| [`@polydeukes/core`](./reference/packages/core.md) | The protocol, the input IR, the config schema, telemetry |
| [`@polydeukes/adapter-claude-code`](./reference/packages/adapter-claude-code.md) | Claude Code session surface — hook payloads become the input IR |
| [`@polydeukes/adapter-grok`](./reference/packages/adapter-grok.md) | Grok session surface — hook payloads become the input IR |
| [`@polydeukes/adapter-codex`](./reference/packages/adapter-codex.md) | Codex session surface — hook payloads become the input IR, one element per file the patch touches |
| [`@polydeukes/sdk-ts`](./reference/packages/sdk-ts.md) | Call the judge from TypeScript and handle its result |

<a id="the-shape-of-the-thing-in-one-page"></a>
<a id="shape-of-the-thing"></a>
## How it works

Polydeukes judges what a developer or an AI agent is about to do, records the verdict, and by
default lets the work proceed. Three ideas carry the rest.

**Covenants check agreed development practices.** The same disciplines apply to human and AI
work. This project's authors use them in daily development.

**Judging and stopping are separate decisions.** Every declared discipline is judged on matching
calls. By default, a violation is recorded with its reason and the call continues. Set
`enforce: block` on an entry to stop violations. The framework's own protections block session
calls by default.

**Judgments are recorded.** `.polydeukes/roi.log` stores verdicts and their context. Use the log
to investigate violations, skipped checks, and unexpected results. The
[design explanation](./why-polydeukes.md) describes how these records informed the project.

<a id="two-surfaces"></a>
## Two surfaces

| Surface | Judges | Wired by | For |
|---|---|---|---|
| **Session** | A tool call, before it runs | `pdks-claude-code init`, `pdks-grok init`, or `pdks-codex init` | A project developed with an AI partner |
| **Commit** | A unified diff on stdin — staged, the working tree, or a ref range | A pre-commit hook piping `git diff --cached`, or run on demand | A human developing alone, and CI |

The commit judge also answers on demand: `git diff HEAD | pdks covenant check --diff` after a task,
`git diff main...HEAD | …` before a PR. Same verdict a commit would receive, delivered as an exit
code with no prompt — the gate is whatever consumes that code.
