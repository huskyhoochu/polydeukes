# Configuring Polydeukes

**English** · [한국어](./configuration.ko.md)

> Alpha. This guide covers the config surface as shipped today (schema v2, loader, and
> the four built-in discipline predicates). Fields and predicates will grow; what is
> written here is tested and enforced now.

`polydeukes.config.yaml` is the one file where a project declares its disciplines — the
promises the human and the AI partner both agree to be bound by. It is **data, not code**:
nothing in it can compute, so nothing in it can lie. The core validates it, the covenant
package enforces it, and every judgment it causes is measured.

This is the guide layer: the file itself, how discovery fails, the IDE wiring, and what
enforcement looks like. Every key, with its full rules and pitfalls, lives in
[the configuration reference](./reference/configuration.md).

## The file

Put exactly one of these at the project root:

| Filename | Note |
|---|---|
| `polydeukes.config.yaml` | canonical |
| `polydeukes.config.yml` | accepted variant |
| `polydeukes.config.json` | accepted variant (read by the same parser — YAML is a JSON superset) |

Discovery is deliberately strict, and every failure refuses loudly instead of guessing:

- **No config found** → error naming all three candidate filenames. A missing config never
  silently loads defaults — silent defaults would mean silently unprotected.
- **More than one found** → error naming the collisions. Ambiguity never picks a winner.
- **Parse error, or a custom YAML tag** → error naming the file. Custom tags are rejected
  even though the parser cannot execute them — config data stays uncomputable by contract.
- **Schema violation** → error naming the key and the file. Unknown keys are rejected
  wherever the core owns the vocabulary — the top level, and the fixed keys inside a
  discipline entry — so `protectedPath:` for `protectedPaths:`, or `adaptors:` for
  `adapters:`, is caught here. Two maps stay open, because their keys are your values
  rather than the core's: language names under `languages`, and adapter names under
  `adapters`. A misspelt adapter name is accepted and its block simply goes unread, which
  leaves that adapter on its defaults — check the name against the adapter's own reference.
  Inside a namespace the vocabulary belongs to that adapter: the core passes contents
  through verbatim, and the adapter's own validator rejects what it does not recognise,
  naming the full field path (see
  [the `adapters` reference](./reference/configuration.md#adapters)).

## IDE support

The JSON Schema gives autocompletion and validation in editors. It ships inside the
`polydeukes` package, so the line names a path into your own `node_modules`:

```yaml
# yaml-language-server: $schema=node_modules/polydeukes/dist/schema/polydeukes.schema.json
```

For a JSON config, use the standard top-level key instead. The loader accepts it and drops
it from the resolved config:

```json
{ "$schema": "node_modules/polydeukes/dist/schema/polydeukes.schema.json" }
```

**The path is resolved against the directory your config sits in**, not against a project
root the editor infers. The spelling above is right when the two are the same place. When
they are not — a config in a monorepo sub-package whose dependencies installed at the
workspace root — count the levels up yourself:

```yaml
# yaml-language-server: $schema=../../node_modules/polydeukes/dist/schema/polydeukes.schema.json
```

`pdks init claude-code` writes the line only when the schema is where the plain spelling
names it. If the generated config has no such line, that is the case above, and the prefix
is yours to add — an unresolvable path costs you validation without reporting anything.

If you installed `@polydeukes/core` directly rather than the umbrella, name its own copy:

```yaml
# yaml-language-server: $schema=node_modules/@polydeukes/core/schema/polydeukes.schema.json
```

Every value here is a **file path**, not a module specifier: `$schema` is a static string an
editor reads, so no module resolver runs on it. Code that reads the schema at runtime uses
the package subpath `polydeukes/schema.json` instead.

## What enforcement looks like

A `disciplines:` entry lands at **advise** by default: a break is recorded as `advised`
with the discipline's `id` in the telemetry record, the break message with its `why` goes
to stderr, and the call proceeds (exit 0) — the judgment measures instead of stopping.
Writing `enforce: block` on an entry is the promotion: that entry then **blocks (exit 2)**
before the call runs. The sanctioned valve on a block is the witness — a human supplying
the pass condition on a judgment that actually blocked, recorded as `witnessed` — never
silent.

What blocks without being asked is the judging chain's own protection, a finite list: the
`protectedPaths` entries (tool-axis and shell-axis mutations, and mentions without a
read-only head), the session transcript, and the assembly itself — a missing, ambiguous, or
invalid config, an unbuilt judge, an unparseable payload, or a routing that could not
answer. At either level the system fails closed on these, because a dead gate that waves
things through is the cheapest bypass of all. On the commit surface `adapters.git.enforce: advise` relaxes
the protected-path verdicts to `advised` as well — it is the observer's setting — while an
assembly that cannot judge still fails closed.
