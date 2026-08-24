# `polydeukes` — the umbrella

**English** · [한국어](./polydeukes.ko.md)

> Alpha. Everything below is read from the shipped package — the `pdks` bin, the barrel, and
> the exports map. For the procedures that use these, see [installation](../installation.md)
> and [troubleshooting](../troubleshooting.md).

The umbrella is the only package you install. It carries the core, the judge, and both
adapters as its own dependencies, and it is the only package allowed to assemble them —
every other dependency in this repository runs one way, through the core alone. That makes
this page the consumer-facing surface: the four scoped packages are transitive dependencies
you do not install and do not import.

| Package | Reference | Owns |
|---|---|---|
| `@polydeukes/core` | [core](./core.md) | The protocol, the config schema, telemetry |
| `@polydeukes/covenant` | [covenant](./covenant.md) | The judge — dispatcher, disciplines, meta-covenants, the valve |
| `@polydeukes/adapter-claude-code` | [adapter-claude-code](./adapter-claude-code.md) | Session surface — PreToolUse payloads → input IR |
| `@polydeukes/adapter-git` | [adapter-git](./adapter-git.md) | Commit surface — staged diffs → input IR |

## Subcommands

The bin is `pdks`, with `polydeukes` as an alias. There are no flags and no options
anywhere: two subcommands take an exact two-word form, `explain` takes one word, and
`docs` takes an optional topic.

### `pdks covenant check`

The commit-surface judgment runner, invoked from a pre-commit hook. It discovers the config
at the working directory, collects the staging area through the git adapter, translates it
into the covenant input IR, and dispatches it through the same judge bodies the session hook
spawns.

| Situation | Result |
|---|---|
| Staged changes break nothing | exit `0` |
| A staged change breaks a covenant, `enforce: block`, config has a `witness` block | Prompts once on `/dev/tty` for the witness token; an unanswered or wrong answer exits `2` |
| The same, with no `witness` block in the config | exit `2` with no prompt — the valve is built from that block, so without it nothing can open a block |
| A staged change breaks a covenant, `enforce: advise` | One advisory line on stderr, exit `0`, recorded `advised` |
| Empty staging area | exit `0` — an explicit pass, not a skipped run |
| No config, more than one config, or an invalid one | exit `2` |
| A judge body that cannot be loaded | exit `2` |

Context-family disciplines (`requirePrecedent`) assemble here like any other entry, but this
surface has no session to read: a match records `skipped` and the commit proceeds. That is a
permanent condition of the commit surface, not a fault.

### `pdks init claude-code`

The session-surface installer. It proves that `polydeukes` resolves from the directory it
was invoked in **before writing anything**, then creates five artifacts:

| Artifact | Kind |
|---|---|
| `.claude/hooks/covenant-pretooluse.mjs` | Created — a delegator that loads the judge from the installed package |
| `.claude/settings.json` | Merged — the PreToolUse registration is added to whatever the file already carries |
| `polydeukes.config.yaml` | Created — the starter policy, with a placeholder `languages` block |
| `.claude/rules/polydeukes.md` | Created — tells the AI partner to ask [`pdks docs`](#pdks-docs-topic) instead of searching the web |
| `.gitignore` | Appended — one line for `.polydeukes/` |

Nothing existing is overwritten: an artifact already present is reported as skipped and left
alone, so a re-run is a no-op. A precondition failure — the package not resolving, two
coexisting config spellings, an unparseable settings file — writes zero files and exits `2`,
never a half-wired tree.

### `pdks docs [topic]`

The offline documentation reader. The guides and this reference layer ship inside the
package, so the answer comes from the installed version rather than from the network.

| Call | Result |
|---|---|
| `pdks docs` | The topic list on stdout, exit `0` |
| `pdks docs <topic>` | That topic's section, followed by a `See also:` line, exit `0` |
| `pdks docs <unknown>` | The known topics named on stderr, exit `2` |
| `pdks docs a b` | The usage line on stderr, exit `2` |

| Topic | Answers from |
|---|---|
| `install` | [installation](../installation.md), in full |
| `config` | [the configuration reference](./configuration.md), in full |
| `discipline` | [the configuration reference](./configuration.md) — the `disciplines` section |
| `covenant` | [configuration](../configuration.md) — What enforcement looks like |
| `witness` | [the configuration reference](./configuration.md)'s `witness` section, then [troubleshooting](../troubleshooting.md)'s valve section |

**Every failure leaves stdout at zero bytes.** A missing bundled document, a heading the
document no longer carries, an unknown topic — each names what was missing on stderr and
exits `2`. A partially written answer is one an agent reads as the document and quotes
onward, so there is no such state.

The bundle carries the English text only. Answers are returned verbatim, so the
`[한국어](./X.ko.md)` link at the top of each document points at a mirror that lives in the
[repository](https://github.com/huskyhoochu/polydeukes/tree/main/docs) rather than inside
the package.

`pdks init claude-code` writes a discovery file that points an AI partner at this
subcommand; see the artifact table above.

### `pdks explain`

The assembly reader. It loads the config at the working directory, assembles both surfaces'
registration sets through the same functions the two judgment runners use, and prints them
without judging — no judge body is spawned, no telemetry row is written, no transcript is
read.

```text
pdks explain — polydeukes.config.yaml

surface: session (claude-code hook)
  registrations 23 · judged 11 · skip 9 · meta 3 · excluded 0
  meta     self-mod                 paths 13 (common; includes the config file itself)
  judge    covenant-vocabulary      forbid · in packages/*/src/** · except … · why ✓
  skip     covenant-vocabulary      a shell write in scope whose result this layer cannot compute
  ...
surface: commit (git pre-commit) · enforce: advise
  registrations 10 · judged 3 · skip 6 · meta 1 · excluded 3
  skip     manifest-needs-npm-view  no session transcript to read
  excluded hooks-stay-armed         forbidCommand — no shell axis on this surface
```

One line per registration, in the order the surface dispatches them. The kind column has
four words: `meta` (the registrations protecting the judging chain — `self-mod`,
`shell-mod`, and on the session surface `transcript-mod`), `judge` (an entry with a judge
body, with its family, routing scope, and whether it carries a `why`), `skip` (a registration
that records `skipped` instead of judging, with the reason the compiler gave — the reason
that otherwise reaches stderr only on a config fault), and `excluded` (a `forbidCommand`
entry on the commit surface, which has no shell axis). `registrations` counts the first
three; `excluded` is tallied apart because an excluded entry never becomes a registration.
The commit surface's header also names its `adapters.git.enforce` level, since an advising
surface records the same table but blocks nothing.

The session surface is rendered as the hook sees it under a normal payload — with a
transcript present — so `transcript-mod` and the context family appear as they do in a
session; the commit surface shows the context family as skips, which is that surface's
permanent condition.

| Call | Result |
|---|---|
| `pdks explain` | Both surfaces on stdout, exit `0` |
| `pdks explain <anything>` | The usage line on stderr, exit `2` |
| no config, two configs, or an invalid one | `pdks explain: <reason>` on stderr, stdout at zero bytes, exit `2` |

### Any other argument form

Anything that is not one of these forms writes
`usage: pdks covenant check | pdks explain | pdks init claude-code | pdks docs [topic]` to
stderr and exits `2`.

## Exit codes

Three codes exist, and they live at two layers. **What a consumer's hook observes is only
`0` or `2`** — both composition roots return `Promise<{ exitCode: 0 | 2 }>`.

| Code | Constant | Emitted by | Means |
|---|---|---|---|
| `0` | `EXIT_UPHOLD` | Judge body, wrapper, bin | The promise was upheld — the call or commit proceeds |
| `1` | `EXIT_BREAK_NON_BLOCKING` | Judge body only | A break reported as a signal. The wrapper translates it — into `2` under `enforce: block`, into `0` + an `advised` row under `advise`. It never reaches the surface either way |
| `2` | `EXIT_BREAK_BLOCKING` | Wrapper, bin, fail-closed paths | The call or commit is refused |

The asymmetry is the protocol's responsibility boundary. A covenant body decides *whether* a
promise was broken and says so with `0` or `1`; deciding what a break *costs* belongs to the
wrapper, and that is the one place `enforce` is read. A body can therefore be run, tested, and
reasoned about without knowing whether the surface it runs under blocks or advises. Only the
verdict relaxes: every unjudgeable outcome — a body exit of `2` or higher, a signal death —
stays `2` at either level.

**Everything unjudgeable resolves to `2`.** A missing config, an invalid one, an
unparseable payload, a judge body that was never built — each fails closed. The one
direction that stays open is measurement: a telemetry write that fails never changes a
verdict.

## Programmatic surface

The barrel (`import … from 'polydeukes'`) exports six symbols plus one re-exported type.
This is the whole public API; the scoped packages are not part of it.

### `loadConfig`

**Type signature:**

```ts
function loadConfig(rootDir: string): LoadedConfig;

type LoadedConfig = {
  config: ResolvedConfig;  // protectedPaths already includes the config file itself
  configPath: string;      // rootDir-relative path of the discovered file
};
```

Discovers exactly one `polydeukes.config` file (`.yaml`, `.yml`, or `.json`) directly under
`rootDir`. **Every failure branch throws** — none found, more than one found, a parse error,
a schema violation. There are no silent defaults, because a silently defaulted config means
a silently unprotected project.

### `runCovenantCheck`

**Type signature:**

```ts
function runCovenantCheck(spec: CovenantCheckSpec): Promise<{ exitCode: 0 | 2 }>;

type CovenantCheckSpec = {
  repoRoot: string;                                  // config discovery and staged collection anchor here
  telemetryPath?: string;                            // overrides the config's log path
  covenantDist?: string;                             // overrides the resolved judge directory
  ttyPrompt?: (prompt: string) => string | null;     // the TTY valve seam
};
```

The commit surface's composition root — what [`pdks covenant
check`](#pdks-covenant-check) runs.

`ttyPrompt` absent means a non-TTY environment, and the valve then has no way to open — an
agent-spawned commit and a CI run reach the same state. The valve is a human at a terminal
or nothing.

### `runClaudeCodeHook`

**Type signature:**

```ts
function runClaudeCodeHook(spec: ClaudeCodeHookSpec): Promise<{ exitCode: 0 | 2 }>;

type ClaudeCodeHookSpec = {
  repoRoot: string;         // config discovery and discipline glob scoping anchor here
  rawPayload?: string;      // absent means read fd 0 — the hook's real stdin
  telemetryPath?: string;
  covenantDist?: string;
};
```

The session surface's composition root — what the generated hook delegator calls. Reach it
through the [`polydeukes/claude-code`](#subpaths) subpath rather than the barrel.

**Neither composition root throws.** An uncaught rejection would exit the delegator
non-blocking, which is the cheapest bypass there is, so both resolve their failures into
`{ exitCode: 2 }` with a telemetry record instead.

### `ResolvedConfig`

Re-exported from [`@polydeukes/core`](./core.md) so a consumer reading `loadConfig`'s result
needs no second dependency.

## Subpaths

| Specifier | Carries |
|---|---|
| `polydeukes` | The barrel — `loadConfig`, `runCovenantCheck`, `runClaudeCodeHook`, their spec types, `ResolvedConfig` |
| `polydeukes/claude-code` | `runClaudeCodeHook` and `ClaudeCodeHookSpec` alone |
| `polydeukes/schema.json` | The config JSON Schema, copied from the core at build time |

The generated hook delegator imports the subpath, not the barrel. ESM imports are eager, so
importing the barrel would load the commit-surface runner — and the git adapter behind it —
on every session tool call that will never use them. The subpath is the session surface's
own entry point, and the barrel is for programmatic consumers.

`polydeukes/schema.json` is for code that reads the schema. A `$schema` line names the file
path instead — an editor reads that string statically, so no module resolver runs on it. Both
spellings are in [configuration.md's IDE section](../configuration.md#ide-support).
