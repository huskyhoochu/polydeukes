# `@polydeukes/core`

**English** · [한국어](./core.ko.md)

> **The protocol every covenant speaks** — the input IR, the verdict shape, the config
> schema, and the telemetry collector.
>
> Alpha. A transitive dependency of the umbrella: you do not install it and you do not import
> it. The consumer entry point is [`polydeukes`](./polydeukes.md).

## What this package owns

The protocol every covenant speaks, and nothing that knows what a covenant is *about*.

| Area | What it is |
|---|---|
| Covenant protocol | The stdin-JSON input IR, the verdict shape, the exit-code contract |
| Config schema | `defineConfig()` validates parsed yaml/json data; the matching JSON Schema ships as a sibling artifact |
| ROI telemetry | One append-only line collector every package writes through |
| Fail policy | One table deciding fail-open against fail-closed per failure kind |
| Protected-path normalization | The declared list becomes the literal strings the dispatcher matches |
| Transcript seam | The query interface a covenant uses to ask about session history |

Two constraints hold this package's shape. **Zero runtime dependencies** — validation is
hand-rolled and the published JSON Schema is a sibling artifact the source never reads.
**No agent, tool, or language literals** — editor tool verbs and test-runner names are
*values* supplied by configs and adapters, so the core's agent-neutrality is a claim a grep
can check. Every other package depends on this one; this one depends on none of them.

## The judged protocol

This is the contract the shipped judge bodies speak: a body reads a `CovenantInput` from
stdin and answers with an exit code. Every row in `.polydeukes/roi.log` traces back to one
of these verdicts, so this vocabulary is what a blocked row is written in.

```ts
type CovenantInput = {
  toolCalls: { name: string; args?: Record<string, unknown>; fileChange?: FileChange }[];
  subagentSpawns: { kind: string }[];
  userMessages: { text: string }[];
};

type FileChange =
  | { kind: 'create'; path: string; post: string }
  | { kind: 'modify'; path: string; pre: string; post: string }
  | { kind: 'delete'; path: string; pre?: string };

type CovenantVerdict = { upheld: true } | { upheld: false; reason: string };
```

The vocabulary carries no tool or agent names. A concrete tool name is a *value* an adapter
fills into `name`; `kind` on a spawn is likewise a value. `FileChange` is a discriminated
union so that a deletion is first-class evidence rather than an unrepresentable case, and
impossible states — a deletion carrying resulting content, a creation carrying a baseline —
cannot be written down. `delete.pre` is absent when the baseline was a binary blob, because
a deletion needs no content to be judged.

**Evidence has exactly one home: the call it belongs to.** `fileChange` absent means *this
call is unproven*, and no sibling call's evidence stands in for it.

```ts
function parseInput(stdinJson: string):
  | { ok: true; value: CovenantInput }
  | { ok: false; exitCode: 2 };

function verdictToExitCode(verdict: CovenantVerdict): 0 | 1;

function allFileChanges(input: CovenantInput): FileChange[];
```

`parseInput` never throws. Unparseable JSON, an empty payload, a non-object, a missing
required collection — each resolves to a blocking `{ ok: false, exitCode: 2 }`, so an
unjudgeable input can never be mistaken for a valid one.

`verdictToExitCode` returns `0` or `1` and never `2`. Translating a break into a block is
the wrapper's policy, not the body's — see [exit codes](./polydeukes.md#exit-codes).

`allFileChanges` flattens every call's evidence in call order for consumers that need no
attribution. Calls without evidence are skipped, never substituted for.

## Where the consumer touches it

Three places, all of them indirect.

- **The config file.** Its schema is defined here. The vocabulary reference is
  [the configuration reference](./configuration.md).
- **The JSON Schema artifact** — `@polydeukes/core/schema.json`, an exports subpath, for a
  project that installs this package directly. A consumer of the umbrella names the copy
  bundled there instead; both spellings are in
  [configuration.md's IDE section](../configuration.md#ide-support).
- **The protocol above** — reading a `blocked` row means reading the vocabulary a body
  answered in.

Everything else here is reached through `polydeukes`.

## Declared limits

- **Adapter namespaces are validated by shape, not by name.** `defineConfig()` checks that
  `adapters` is a map of plain objects and that each namespace value is an object. It does
  not check that a namespace *name* is one anybody implements, and it does not look inside
  the namespace at all. Unknown vocabulary inside `adapters.git` is rejected by the git
  adapter's own validator, at its own layer — not here.
- **`requirePrecedent` evidence is layered the same way.** The core fully validates the
  `command` key, because a shell command is the surface where an agent crosses into the
  system. Every other key is validated for container shape alone — a flat object holding
  exactly one key — and its value passes through verbatim for the owning adapter to judge.
- **The default transcript is a noop.** A consumer that injects no real transcript
  converges on "nothing happened", which is the safe direction for a valve: it never opens.
  Real transcripts live behind adapters.
- **Telemetry is fail-open, alone.** A logging failure never changes a verdict. Every other
  failure kind in the table resolves toward blocking.
