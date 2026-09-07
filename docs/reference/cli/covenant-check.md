# `pdks covenant check`

**English** · [한국어](./covenant-check.ko.md)

`pdks covenant check` runs the commit-surface judgment against the installed package. It reads the
config from the working directory, takes one observation from **stdin**, and dispatches the same
judge bodies that the session hook uses. It never opens a repository and never calls `git`: the
caller produces the observation, the command judges it and answers with an exit code.

<a id="covenant-check-syntax"></a>
## Syntax

```sh
pdks covenant check [--diff] [--enforce advise|block]
```

Without `--diff`, stdin is the covenant input IR — the JSON document `@polydeukes/core` defines
(`toolCalls`, `subagentSpawns`, `userMessages`, and the two optional keys a host adds:
`tools`, its tool roster, and `session`, the evidence a live agent session carries). With
`--diff`, stdin is a unified diff and the command translates it into that IR first.
`--enforce` is the observer's posture for the run and
defaults to `advise`: every break lands as a row and exit 0. `--enforce block` makes a protected
path or an entry set to `enforce: block` exit 2. Each flag at most once, in either order; any
other argument is a usage error. stdin is read to EOF.

<a id="covenant-check-boundaries"></a>
## Observation boundaries

The command judges exactly what stdin carries. Which diff you pipe decides the observation:

| Pipe | Observed set |
|---|---|
| `git diff --cached \| pdks covenant check --diff` | Staged changes — the pre-commit shape |
| `git diff HEAD \| pdks covenant check --diff` | The working tree against HEAD |
| `git diff <base>..<head> \| pdks covenant check --diff` | The change set between two refs (`...` for the merge-base reading) |
| `pdks covenant check < input.json` | Whatever IR the caller built |

The diff format is VCS-neutral: git, jj, hg, and a hand-written `diff -u` all produce it.

An IR built by a host carries what the repository's disk cannot show. `tools` names which tool
names change a file and which carry a command line (`mutating`, `shell`, `commandArgs`) — values,
never vocabulary — and without it only the staged names a diff produces are routed. `session`
carries the human messages with their timestamps (what the TTL witness reads), the calls already
made with their outcomes (what a precedent declaration reads), the absolute path the evidence was
read from (protected by equality for the run), and the spawn sidecar text. The command reads the
working tree itself for every file a declaration names; an IR that supplies its own `world` is
refused. A session input is one call of a change set the command cannot see, so a change-set
declaration records `skipped` there, and the protected entries are compared against the stored
baseline around the judgment exactly as the session surface does.

<a id="diff-translation"></a>
## How a diff becomes the IR

One `toolCall` per file block, in input order. The tool name is `staged-write` for a creation or
modification and `staged-delete` for a deletion; `args.file_path` is the repo-relative path with
one `a/` or `b/` prefix stripped and quoted paths unescaped.

| Diff block | Evidence |
|---|---|
| `--- /dev/null` → `+++ b/P` | `create`, `post` = every `+` line |
| `--- a/P` → `+++ /dev/null` | `delete`, `pre` = every `-` line |
| `--- a/P` → `+++ b/P` with hunks | `modify`, `pre` = the `-` lines, `post` = the `+` lines |
| Same path, no hunks (a mode change) | `modify` with empty `pre` and `post` |
| `rename from O` / `rename to N` | `staged-delete` O, then `staged-write` N as `modify` over the hunks |
| `Binary files … differ` / `GIT binary patch` | The path only — no evidence, so only path judgments apply |

**A modification's `pre` and `post` are the hunk lines, not the whole file.** Context lines and
the `\ No newline at end of file` marker are dropped. Every shipped discipline that reads `pre`
and `post` compares keyed lines, so the verdict is the one the whole file would give; a
declaration that needs a file's full text names it as a `source`, and that is read from the
world axis below. Creations and deletions carry the full text.

**The world axis is the working tree.** A file a declaration names by `source` is read from disk
under the working directory — not from the index, not from a ref. When the index and the disk
differ (a partially staged file), the judged text is the disk's. The change set (`world.changes`)
is the list of paths whose toolCalls carry evidence.

**No actor.** A diff proves no author, so the translated IR carries no `actor` key; actor-scoped
disciplines skip on this surface.

<a id="covenant-check-results"></a>
## Results and exit codes

| Situation | Result |
|---|---|
| No covenant breaks | exit `0`; a toolCall no registration routed leaves one `passed` row under the `covenant-check` label |
| A break on a discipline entry (default `advise`) | exit `0`, one `advised` row, the `why` and one advisory summary on stderr |
| A break on a protected path or an entry set to `enforce: block`, default posture | exit `0`, one `advised` row — this surface has no valve a human could answer, and a staged gate-file change already passed the session surface |
| The same break under `--enforce block` | exit `2`, one `blocked` row |
| 0 bytes on stdin with `--diff` | exit `0`, no rows — nothing staged is nothing to judge |
| 0 bytes on stdin without `--diff` | exit `2` — an empty payload is not an IR |
| Unparseable JSON, a non-object, or a missing `toolCalls` array | exit `2`, one `blocked` `covenant-check` row |
| An IR carrying its own `world` key | exit `2` — the world axis is the command's to fill |
| A `tools` whose lists are missing or hold a non-string name, or a `session` without `userMessages` and `toolCalls` arrays | exit `2`, one `blocked` `covenant-check` row — a shape the command cannot judge is a block, never a default |
| A `session` whose token message is fresh under the config's `witness` | the blocked verdict lands `witnessed`, exit `0` — the same valve the session surface opens |
| A combined diff (`diff --cc`), an unmatched `---`/`+++`, or an unknown hunk line | exit `2`, one `blocked` `covenant-check` row |
| Any other argument | exit `2` with the usage line on stderr, stdin unread |
| Missing, ambiguous, or invalid config | exit `2` |
| Judge body cannot load | exit `2` |

The posture lives on the command line, not in the config, and there is no prompt. The command
answers success or failure; whether a commit proceeds is decided by the hook that spawned it. A
row records the verdict, not the commit's fate — a `blocked` row can sit beside a commit that
landed because the wiring ignored the exit code.

<a id="covenant-check-examples"></a>
## Examples

```sh
git diff --cached | pdks covenant check --diff                    # pre-commit, record only
git diff --cached | pdks covenant check --diff --enforce block    # pre-commit, refuse a break
git diff HEAD | pdks covenant check --diff                        # after a task
git diff main...HEAD | pdks covenant check --diff                 # before a PR
pdks covenant check < input.json                                   # an IR another program built
```

<a id="pin-the-producer"></a>
## Pin the producer

The observation is produced by a process outside this package, and git's own configuration
can change its text. Wire a hook with these flags so the judged text is the staged text:

| Flag | What it prevents |
|---|---|
| `--no-color` | `color.ui=always` wraps every line in escape codes; the translator recognizes no block and the run fails closed (exit 2) |
| `--no-ext-diff` / `--no-textconv` | `diff.external` or a `.gitattributes` textconv driver substitutes text that exists nowhere on disk, and the disciplines judge that text |
| `--src-prefix=a/ --dst-prefix=b/` | `diff.mnemonicPrefix` prints `c/`, `i/`, `w/`; the translator strips exactly `a/` and `b/`, so any other prefix survives into the judged path |

A producer that dies mid-stream leaves 0 bytes on stdin, which is the empty observation and
exit 0. Where the shell supports it, `set -o pipefail;` in front of the pipeline makes git's
failure the hook's failure.

A lefthook command that records every verdict and stops the commit only on a fail-closed run:

```yaml
pre-commit:
  commands:
    covenant:
      run: git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | ./node_modules/.bin/pdks covenant check --diff
```

Append `--enforce block` to that line to stop the commit on a protected-path break too.

Another program embeds the judgment by spawning `pdks covenant check` and writing its input IR
or diff to that process's stdin; the exit code is the verdict.

<a id="covenant-check-see-also"></a>
## See also

- [`pdks explain`](./explain.md)
- [`@polydeukes/core`](../packages/core.md)
- [The judge (`covenant` module)](../packages/polydeukes.md#covenant-module)
- [Configuration reference](../configuration/index.md)
