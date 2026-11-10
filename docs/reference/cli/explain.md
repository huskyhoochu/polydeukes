# `pdks explain`

**English** · [한국어](./explain.ko.md)

`pdks explain` renders the assembled registration table without judging anything. It uses the same
assembly functions that the two runners use, so the output is a view of the real dispatch table, not
a second opinion.

<a id="explain-syntax"></a>
## Syntax

```sh
pdks explain
```

Any extra argument is invalid. The command reads the config at the working directory, assembles both
surfaces, and prints the result.

<a id="explain-what-it-shows"></a>
## What it shows

The output is a surface-by-surface summary. Each surface lists one line per registration, then a
tally line.

The row kinds are:

- `meta` — one of the registrations that protect the judging chain itself
- `declare` — one compiled discipline entry
- `skip` — a registration that could not be judged and records a skip reason
- `draft` — an unpromoted entry with `draft: true`

The command does not dispatch, does not write telemetry, and does not read a transcript file. The
session surface is rendered with a no-op transcript so the `transcript-mod` row appears exactly as
it would under a normal hook payload.

<a id="explain-failure-conditions"></a>
## Failure conditions

| Situation                               | Result                         |
| --------------------------------------- | ------------------------------ |
| Config loads and both surfaces assemble | exit `0`                       |
| Any extra argument                      | exit `2`, usage line on stderr |
| Missing, ambiguous, or invalid config   | exit `2`                       |
| Any assembly failure                    | exit `2`                       |

The command leaves stdout at zero bytes on failure. It never prints a partial table.

<a id="explain-example"></a>
## Example

```sh
pdks explain
```

The output starts with the config file path, then one block for the session surface and one for the
change-set surface. The `pdks init` starter config with no extra disciplines looks like this (`N`
stands for the number of protected paths the assembly counts). The `skip` row describes shell
commands whose write target cannot be determined:

```text
pdks explain — polydeukes.config.yaml

input: call IR (one call, stdin) · disciplines 0 · sessionDisciplines 0 · disciplines: advise unless enforce: block · meta: block
  registrations 3 · declare 0 · skip 1 · meta 2 · draft 0
  meta     self-mod          paths N (common; includes the config file itself)
  meta     transcript-mod    content predicate · conditional: session.evidencePath
  skip     shell-unjudgeable a shell command whose write target this layer cannot determine

input: --diff (change set, stdin) · disciplines 0 · disciplines: advise unless enforce: block
  registrations 2 · declare 0 · skip 1 · meta 1 · draft 0
  meta     self-mod          paths N (common; includes the config file itself)
  skip     shell-unjudgeable a shell command whose write target this layer cannot determine
```

**The surface headers name the lists and their counts before assembly.** The session header is
`input: call IR (one call, stdin) · disciplines <n> · sessionDisciplines <m> · disciplines: advise unless enforce: block · meta: block`.
The change-set header is
`input: --diff (change set, stdin) · disciplines <n> · disciplines: advise unless enforce: block`.
The change-set surface compiles only `disciplines`; `sessionDisciplines` is judged only on the
session surface.

A `declare` row uses the entry `id` as its label and a catalogue coordinate as its description. In
the session section, a `changes` reader appears at its config position as a `skip` row reading
`reads changes — judged on the change-set surface`. It counts under `skip` in the tally. On a live
call whose target is in scope, it records `skipped <id> <path> no-observation`. A `draft` row is
`unpromoted — no judgment`.

Every other declared discipline row in the session section ends with ` · unattended: judge` or
` · unattended: skip`. A declaration body containing a `userTexts` step shows `skip`: a call made
with `--unattended` (an SDK call with no human in it) does not judge that body. Other bodies show
`judge`. Reading the transcript's `userMessages` through `select`/`field` shows `judge` and is
judged over an empty message list in an unattended call. If the witness block contains a `userTexts`
step, the row also ends with ` · unattended: valve closed`: that discipline's witness valve does not
open in an unattended call.

<a id="explain-see-also"></a>
## See also

- [`pdks covenant check`](./covenant-check.md)
- [`pdks init`](./init.md)
- [The judge (`covenant` module)](../packages/polydeukes.md#covenant-module)
- [`Configuration reference`](../configuration/index.md)
