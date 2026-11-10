# pdks

**English** · [한국어](./polydeukes.ko.md)

<a id="polydeukes-entry-points"></a>
## Executable

Rust `pdks` is the covenant judge. Homebrew, crates.io, npm, and PyPI distribute the executable. The
npm package is named `polydeukes`; consumers run the `pdks` command. See
[installation](../../how-to/install.md).

<a id="polydeukes-bin"></a>
## Commands

| Command                      | Purpose                 |
| ---------------------------- | ----------------------- |
| `pdks init`                  | Project configuration   |
| `pdks explain`               | Assembled registrations |
| `pdks covenant check`        | Input IR on stdin       |
| `pdks covenant check --diff` | Unified diff on stdin   |
| `pdks docs`                  | Embedded documentation  |
| `pdks --version`             | Executable version      |

See the [command references](../../README.md#reference-cli) for arguments and exit codes.

<a id="surface-from-input-mode"></a>
## Input and surface

IR input selects the session surface: it compiles every entry in `disciplines` followed by
`sessionDisciplines`. A `changes` reader is recorded as `skipped` rather than judged for an in-scope
file change. A compile fault in it is a load error on both surfaces. Diff input selects the
change-set surface and compiles only `disciplines` for result verification. `sessionDisciplines`
supplies process and human evidence only to the session surface. The IR session field carries
observed history; it does not select a surface. File tools and diffs supply different content
boundaries. Read [the judgment model](../../concepts/judgment.md).

<a id="extensions"></a>
## Extension dispatch

`pdks <name> [args...]` finds pdks-<name> on PATH, forwards arguments, and inherits stdin, stdout,
and stderr. Names contain ASCII letters, digits, underscores, or hyphens and do not start with a
hyphen. Built-in commands take precedence. Use `pdks memory search ...`, `pdks claude-code init`, or
`pdks codex init`. A missing extension produces an installation diagnostic and an error.

<a id="covenant-module"></a>
## Judgment and observation

Judgment compares declarations with supplied evidence. Protected file paths, protected-path mentions
in shell commands, and transcript protection can block session calls. Even a read-only shell command
can be blocked when it mentions a protected path. Shell writes without content evidence are skipped
by content disciplines with no-observation. Check the finished change through a diff.

<a id="ownership"></a>
## Assembly and records

Command assembly reads configuration and declaration-named files, then supplies evidence to the
judge. Telemetry is written to `.polydeukes/roi.log`. An assembly failure, a violation, and a
skipped observation are different outcomes. Use
[troubleshooting](../../troubleshooting.md#reading-verdict) to interpret them.

<a id="schema-export"></a>
## Schemas and program integration

The repository schema directory contains configuration, declaration, input IR, and memory-search
schemas. TypeScript, Rust, and Python SDKs provide process invocation and result handling. Start
with [the input contract](./core.md).
