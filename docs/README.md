# Polydeukes documentation

**English** · [한국어](./README.ko.md)

> A development discipline framework for building alongside an AI coding partner. Start
> wherever your question is.

## Start here

| If you want to | Read |
|---|---|
| Understand why this exists at all | [Why Polydeukes?](./why-polydeukes.md) — the design whitepaper |
| Get it running on a project | [Installing Polydeukes](./installation.md) — both surfaces, from empty project to a first judged call |
| Declare your own disciplines | [Configuring Polydeukes](./configuration.md) — the file, discovery, and what enforcement looks like |
| Fix something that is refusing you | [Troubleshooting](./troubleshooting.md) — the fail-closed states, reading verdicts, opening the valve |
| Follow the project as it is built | [Build in public](./build-in-public/) — one post per milestone |

## Reference

Every key, every subcommand, every exit code. These describe the present state only —
nothing here is aspirational.

| Document | Answers |
|---|---|
| [Configuration reference](./reference/configuration.md) | What may go in `polydeukes.config.yaml`, and what each key does |
| [`polydeukes` (the `pdks` CLI)](./reference/polydeukes.md) | Subcommands, flags, exit codes, and what the umbrella assembles |
| [`@polydeukes/core`](./reference/core.md) | The protocol, the input IR, the config schema, telemetry |
| [`@polydeukes/covenant`](./reference/covenant.md) | The judge — dispatcher, discipline library, meta-covenants, the valve |
| [`@polydeukes/adapter-claude-code`](./reference/adapter-claude-code.md) | Session surface — hook payloads become the input IR |
| [`@polydeukes/adapter-git`](./reference/adapter-git.md) | Commit surface — staged, worktree, and range diffs become the input IR |

## The shape of the thing, in one page

Polydeukes judges what a developer or an AI agent is about to do, records the verdict, and
by default lets the work proceed. Three ideas carry the rest.

**A covenant is a promise, not a fence.** The disciplines it enforces are the ones a good
developer already imposes on themselves. They bind the human exactly as much as the AI, and
the framework's own authors get judged by them daily.

**Judging and stopping are separate decisions.** Every declared discipline is judged on
every matching call. What a break then does is a second question: by default it is recorded
with its reason and the call continues. `enforce: block` is a promotion the author chooses.
The only things that stop a call unasked are the framework's own protections.

**Every judgment leaves a row.** `.polydeukes/roi.log` holds one line per verdict, in a
vocabulary of six words. That record is how this project finds its own defects — including
the ones described in the whitepaper, which were all found by counting rows rather than by
reading code.

## Two surfaces

| Surface | Judges | Wired by | For |
|---|---|---|---|
| **Session** | A tool call, before it runs | `pdks init claude-code` | A project developed with an AI partner |
| **Commit** | A diff — staged, the working tree, or a ref range | A pre-commit hook, or run on demand | A human developing alone, and CI |

The commit judge also answers on demand: `pdks covenant check --worktree` after a task,
`--range` before a PR. Same verdict a commit would receive, delivered as a report with no
prompt and no gate.
