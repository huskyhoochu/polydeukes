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

Any extra argument is invalid. The command reads the config at the working directory, assembles
both surfaces, and prints the result.

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

| Situation | Result |
|---|---|
| Config loads and both surfaces assemble | exit `0` |
| Any extra argument | exit `2`, usage line on stderr |
| Missing, ambiguous, or invalid config | exit `2` |
| Any assembly failure | exit `2` |

The command leaves stdout at zero bytes on failure. It never prints a partial table.

<a id="explain-example"></a>
## Example

```sh
pdks explain
```

The output starts with the config file path, then one block for the session surface and one for the
change-set surface. A starter config with no extra disciplines looks like this:

```text
pdks explain — polydeukes.config.yaml

input: call IR (one call, stdin) · disciplines 0 · sessionDisciplines 0 · disciplines: advise unless enforce: block · meta: block
  registrations 3 · declare 0 · skip 0 · meta 3 · draft 0
  meta     self-mod        paths N (common; includes the config file itself)
  meta     shell-mod       paths N (common)
  meta     transcript-mod  content predicate · conditional: session.evidencePath

input: --diff (change set, stdin) · disciplines 0 · changeSetDisciplines 0 · disciplines: advise unless enforce: block
  registrations 2 · declare 0 · skip 0 · meta 2 · draft 0
  meta     self-mod   paths N (common; includes the config file itself)
  meta     shell-mod  paths N (common)
```

**The surface header names the lists that surface compiles and how many entries each holds.**
The session header prints `disciplines <n> · sessionDisciplines <n>` and the change-set header
prints `disciplines <n> · changeSetDisciplines <n>`, both counted from the config as written,
before assembly. Reading the two headers is how the placement of every entry is checked without
running a judgment: an entry that moved between lists moves one count in each header.

`N` is the assembled path count. A `declare` row uses the entry `id` as its label and a
catalogue coordinate as its description. A `skip` row names a skip reason. A `draft` row is
`unpromoted — no judgment`.

<a id="explain-see-also"></a>
## See also

- [`pdks covenant check`](./covenant-check.md)
- [`pdks init`](./init.md)
- [The judge (`covenant` module)](../packages/polydeukes.md#covenant-module)
- [`Configuration reference`](../configuration/index.md)
