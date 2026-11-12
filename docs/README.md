# Polydeukes documentation

**English** · [한국어](./README.ko.md)

Polydeukes is a development discipline framework for building alongside an AI coding partner. Choose
a guide for your task below.


<a id="여기서-시작하십시오"></a>

<a id="start-here"></a>
## Get started

| Your task                                | Guide                                                |
| ---------------------------------------- | ---------------------------------------------------- |
| Choose packages and extensions           | [Install](./how-to/install.md)                       |
| See an allowed and a blocked observation | [First judgment](./tutorials/first-judgment.md)      |
| Connect an agent, Git, or CI             | [Connect surfaces](./how-to/connect-surfaces.md)     |
| Write project configuration              | [Configure a project](./how-to/configure-project.md) |

<a id="recipes"></a>
## Recipes

Choose a discipline for your task from the [recipe list](./recipes/index.md).

<a id="choose-a-tool"></a>
## Choose a tool

Read [when Polydeukes fits and when another tool does](./when-to-use-polydeukes.md) to choose a tool
for your check.

<a id="help"></a>
## Help

| Your task                                               | Guide                                                 |
| ------------------------------------------------------- | ----------------------------------------------------- |
| Diagnose skips, blocks, and installation errors         | [Troubleshooting](./troubleshooting.md)               |
| Turn recurring mistakes into a discipline               | [Write disciplines](./how-to/write-disciplines.md)    |
| Run the change-set check by hand, in CI, or from a hook | [Git hooks](./how-to/git-hooks.md)                    |
| Retrieve decisions and evidence                         | [Use memory](./how-to/use-memory.md)                  |
| Upgrade an earlier installation                         | [Migrate to Rust](./how-to/migrate-to-rust.md)        |
| Write and maintain documentation                        | [Contributing](./contributing.md)                     |
| Invoke judgment from a program                          | [SDKs and references](./README.md#reference-packages) |

<a id="reference"></a>
## Reference

Use the reference pages when you need exact keys and exit codes.

<a id="reference-cli"></a>
### CLI commands

| Command                                                    | Purpose                                                         |
| ---------------------------------------------------------- | --------------------------------------------------------------- |
| [`pdks covenant check`](./reference/cli/covenant-check.md) | Judge an input IR or unified diff; read verdicts and exit codes |
| [`pdks init`](./reference/cli/init.md)                     | Create project configuration                                    |
| [`pdks explain`](./reference/cli/explain.md)               | Inspect registered disciplines and enforcement                  |
| [`pdks docs`](./reference/cli/docs.md)                     | Search and retrieve installed documentation                     |
| [`pdks memory`](./reference/cli/memory.md)                 | Search current Markdown documents and open their sections       |

<a id="reference-configuration"></a>
### Configuration

[Configuration reference](./reference/configuration/index.md) covers `polydeukes.config.yaml` keys,
enforcement levels, discipline lists, and witness settings.

<a id="reference-declaration-language"></a>
### Declaration language

[Declaration language reference](./reference/declaration-language/index.md) lists every source,
extraction step, combinator, relation, and mechanism with its syntax and constraints.

<a id="reference-packages"></a>
### Packages

| Package                                                             | Responsibility                                                                                                                     |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| [`polydeukes` (the `pdks` CLI)](./reference/packages/polydeukes.md) | Package contract, and the judge that lives inside it; subcommands live under [`reference/cli/`](./reference/cli/covenant-check.md) |
| [Input IR / schemas](./reference/packages/core.md)                  | The protocol, the input IR, the config schema, telemetry                                                                           |
| [`pdks-claude-code`](./reference/packages/adapter-claude-code.md)   | Claude Code session surface — hook payloads become the input IR                                                                    |
| [`pdks-codex`](./reference/packages/adapter-codex.md)               | Codex session surface — hook payloads become the input IR, one element per file the patch touches                                  |
| [`@polydeukes/sdk-ts`](./reference/packages/sdk-ts.md)              | Call the judge from TypeScript and handle its result                                                                               |
| [`pdks-memory`](./reference/packages/memory.md)                     | Optional Markdown queries over current files                                                                                       |

[Host support](./reference/host-support.md)

[Rust SDK](./reference/packages/sdk-rust.md) · [Python SDK](./reference/packages/sdk-python.md)

<a id="further-reading"></a>
## Further reading

Read [the judgment model and observation limits](./concepts/judgment.md) to understand what your
disciplines can establish, and the [design explanation](./why-polydeukes.md) for the project's
design rationale.

<a id="the-shape-of-the-thing-in-one-page"></a>

<a id="shape-of-the-thing"></a>
### How it works

Polydeukes judges what a developer or an AI agent is about to do, records the verdict, and by
default lets the work proceed. Three ideas carry the rest.

**Covenants check agreed development practices.** The same disciplines apply to human and AI work.
This project's authors use them in daily development.

**Judging and stopping are separate decisions.** Every declared discipline is judged on matching
calls. By default, a violation is recorded with its reason and the call continues. Set
`enforce: block` on an entry to stop violations. The framework's own protections block session calls
by default.

**Judgments are recorded.** `.polydeukes/roi.log` stores verdicts and their context. Use the log to
investigate violations, skipped checks, and unexpected results. The
[design
explanation](./why-polydeukes.md)
describes how these records informed the project.
[When Polydeukes fits and when another tool does](./when-to-use-polydeukes.md) helps you choose a
tool for your check.

<a id="two-surfaces"></a>
### Two surfaces

| Surface     | Judges                                                             | Wired by                                                       | For                                    |
| ----------- | ------------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------- |
| **Session** | A tool call, before it runs                                        | `pdks-claude-code init` or `pdks-codex init`                   | A project developed with an AI partner |
| **Commit**  | A unified diff on stdin — staged, the working tree, or a ref range | A pre-commit hook piping `git diff --cached`, or run on demand | A human developing alone, and CI       |

The commit judge also answers on demand: `git diff HEAD | pdks covenant check --diff` after a task,
`git diff main...HEAD | …` before a PR. Same verdict a commit would receive, delivered as an exit
code with no prompt — the gate is whatever consumes that code.
