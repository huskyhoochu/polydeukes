# Polydeukes documentation

**English** · [한국어](./README.ko.md)

> A development discipline framework for building alongside an AI coding partner. Start where your
question is.

<a id="start-here"></a>
## Start here

| If you want to | Read |
|---|---|
| Get to a first visible judgment | [First judgment](./tutorials/first-judgment.md) — install, wire Claude Code, and watch one protected edit get judged |
| Connect Claude Code, Grok, or git | [Connect the surfaces](./how-to/connect-surfaces.md) — session and commit setup, including Grok |
| Shape the project config | [Configure the project](./how-to/configure-project.md) — discovery, IDE support, and advise versus block |
| Write a real discipline | [Write disciplines](./how-to/write-disciplines.md) — worked declarations, especially locale key pairing |
| Recover from a block or skip | [Troubleshooting](./troubleshooting.md) — the fail-closed states, the witness valve, and the log |
| Understand why the framework exists | [Why Polydeukes?](./why-polydeukes.md) — the design whitepaper |
| Contribute to these docs | [Contributing](./contributing.md) — bilingual pairs, stable IDs, catalog, and checks |

<a id="reference"></a>
## Reference

Every key, every subcommand, every exit code. These describe the present state only — nothing here
is aspirational.

| Document | Answers |
|---|---|
| [Configuration reference](./reference/configuration/index.md) | What may go in `polydeukes.config.yaml`, and what each key does |
| [`polydeukes` (the `pdks` CLI)](./reference/packages/polydeukes.md) | Package contract; subcommands live under [`reference/cli/`](./reference/cli/covenant-check.md) |
| [`@polydeukes/core`](./reference/packages/core.md) | The protocol, the input IR, the config schema, telemetry |
| [`@polydeukes/covenant`](./reference/packages/covenant.md) | The judge — dispatcher, discipline library, meta-covenants, the valve |
| [`@polydeukes/adapter-claude-code`](./reference/packages/adapter-claude-code.md) | Session surface — hook payloads become the input IR |
| [`@polydeukes/adapter-git`](./reference/packages/adapter-git.md) | Commit surface — staged, worktree, and range diffs become the input IR |

<a id="shape-of-the-thing"></a>
## The shape of the thing, in one page

Polydeukes judges what a developer or an AI agent is about to do, records the verdict, and by
default lets the work proceed. Three ideas carry the rest.

**A covenant is a promise, not a fence.** The disciplines it enforces are the ones a good developer
already imposes on themselves. They bind the human exactly as much as the AI, and the framework's
own authors get judged by them daily.

**Judging and stopping are separate decisions.** Every declared discipline is judged on every
matching call. What a break then does is a second question: by default it is recorded with its
reason and the call continues. `enforce: block` is a promotion the author chooses. The only things
that stop a call unasked are the framework's own protections.

**Every judgment leaves a row.** `.polydeukes/roi.log` holds one line per verdict, in a vocabulary
of six words. That record is how this project finds its own defects — including the ones described
in the whitepaper, which were all found by counting rows rather than by reading code.

<a id="two-surfaces"></a>
## Two surfaces

| Surface | Judges | Wired by | For |
|---|---|---|---|
| **Session** | A tool call, before it runs | `pdks init claude-code` or `pdks init grok` | A project developed with an AI partner |
| **Commit** | A diff — staged, the working tree, or a ref range | A pre-commit hook, or run on demand | A human developing alone, and CI |

The commit judge also answers on demand: `pdks covenant check --worktree` after a task, `--range`
before a PR. Same verdict a commit would receive, delivered as a report with no prompt and no gate.
