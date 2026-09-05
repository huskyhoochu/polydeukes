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

The judge and the two adapters take the core as a `peerDependency` rather than a dependency
of their own, so they share one copy of the vocabulary instead of each carrying its own. The
umbrella's ordinary dependency on the core is what satisfies that peer, which is why
installing this one package is still all a consumer does.

| Package | Reference | Owns |
|---|---|---|
| `@polydeukes/core` | [core](./core.md) | The protocol, the config schema, telemetry |
| `@polydeukes/covenant` | [covenant](./covenant.md) | The judge — dispatcher, disciplines, meta-covenants, the valve |
| `@polydeukes/adapter-claude-code` | [adapter-claude-code](./adapter-claude-code.md) | Session surface — PreToolUse payloads → input IR |
| `@polydeukes/adapter-git` | [adapter-git](./adapter-git.md) | Commit surface — staged diffs → input IR |

## Subcommands

The bin is `pdks`, with `polydeukes` as an alias. Every argument form is matched against a
finite table: `covenant check` takes an optional domain flag, `init claude-code` and
`init grok` are exact, `explain` takes one word, and `docs` takes an optional topic.

### `pdks covenant check`

`pdks covenant check [--worktree | --range <base>..<head>]` — the commit-surface judgment
runner. It discovers the config at the working directory,
collects one observation of the repository through the git adapter, translates it into the
covenant input IR, and dispatches it through the same in-process judges the session hook calls.
Which observation is the domain flag's choice — the same violation receives the same verdict
in all three:

| Form | Domain | `pre` → `post` |
|---|---|---|
| `pdks covenant check` | The staging area — what a pre-commit hook judges | HEAD blob → staged blob |
| `pdks covenant check --worktree` | The working tree, untracked (non-ignored) files included | HEAD blob → bytes on disk |
| `pdks covenant check --range <base>..<head>` | Two refs; `<base>...<head>` reads from their merge-base, the PR reading | base blob → head blob |

`--worktree` and `--range` are diagnostic calls — run them after a task, before a PR, or in
CI. Only the staged form is a gate, so only it can prompt for the witness token; the other
two report exit `2` without a prompt, since there is no commit for a human to open.

| Situation | Result |
|---|---|
| The domain's changes break nothing | exit `0` |
| A staged change breaks a covenant, `enforce: block`, config has a `witness` block | Prompts once on `/dev/tty` for the witness token; an unanswered or wrong answer exits `2` |
| The same, with no `witness` block in the config | exit `2` with no prompt — the valve is built from that block, so without it nothing can open a block |
| A worktree or range change breaks a covenant, `enforce: block` | exit `2`, never a prompt |
| A change breaks a covenant, `enforce: advise` | One advisory line on stderr, exit `0`, recorded `advised` |
| Empty domain (nothing staged, a clean tree, identical refs) | exit `0` — an explicit pass, not a skipped run |
| A range naming a ref git cannot resolve, or two refs with no merge-base | exit `2`, one `blocked` row |
| `--range` without an argument, an argument without `..`, both flags at once, or an unknown flag | The usage line on stderr, exit `2` |
| No config, more than one config, or an invalid one | exit `2` |
| A judge body that cannot be loaded | exit `2` |

Declarations that read the session (`precedent` and the other history mechanisms) assemble
here like any other entry, but this surface has no session to read: a match records
`skipped` and the commit proceeds. That is a permanent condition of the commit surface, not a
fault.

### `pdks init claude-code`

The session-surface installer. It proves that `polydeukes` resolves from the directory it
was invoked in **before writing anything**, then creates six artifacts:

| Artifact | Kind |
|---|---|
| `.claude/hooks/covenant-pretooluse.mjs` | Created — a delegator that loads the judge from the installed package |
| `.claude/settings.json` | Merged — the PreToolUse registration is added to whatever the file already carries |
| `polydeukes.config.yaml` | Created — the starter policy, with a placeholder `languages` block |
| `.claude/rules/polydeukes.md` | Created — tells the AI partner to ask [`pdks docs`](#pdks-docs-topic) instead of searching the web |
| `.claude/skills/discipline-draft/SKILL.md` | Created — the classification procedure: a described problem becomes a config entry (judged at advise, or `draft: true`), and advised rows are consulted in the telemetry log |
| `.gitignore` | Appended — one line for `.polydeukes/` |

Nothing existing is overwritten: an artifact already present is reported as skipped and left
alone, so a re-run is a no-op. A precondition failure — the package not resolving, two
coexisting config spellings, an unparseable settings file — writes zero files and exits `2`,
never a half-wired tree.

### `pdks init grok`

The Grok session-surface installer. Same preflight and the same shared scaffold (config and
the `.polydeukes/` ignore line). A Grok-only tree gets four artifacts (hook JSON, the grok
delegator, config, ignore line) and no `.claude/` directory. The JSON registration carries
`timeout` 60 (the host default is 5 seconds; a timed-out hook fails open). If
`.claude/hooks/covenant-pretooluse.mjs` already exists, the JSON command points at that file
so the host does not spawn two judges. A later run of either installer retargets an
installer-generated grok-mjs command the same way, and the JSON matcher follows the
`.claude/settings.json` entry for that command (Grok collapses two registrations only when
command and matcher both match); a command pointed elsewhere is left alone.

An already-open Grok session keeps the hook snapshot from start; reload from the Hooks tab
(`r`) or start a new session. The witness valve does not open on Grok: the session log is
ACP `updates.jsonl`, not Claude's JSONL.

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
without judging — no judge thunk is called, no telemetry row is written, no transcript is
read.

```text
pdks explain — polydeukes.config.yaml

surface: session (claude-code hook) · disciplines: advise unless enforce: block · meta: block
  registrations 42 · declare 18 · skip 21 · meta 3 · draft 1
  meta     self-mod                      paths 14 (common; includes the config file itself)
  declare  covenant-vocabulary           added-only · change · empty nothing-added · scope target.path · include 1 · exclude 1 · sources 0 · valve — · why ✓
  declare  pnpm-only                     forbidden-command · change · empty no-npm-mutation · scope command · include 0 · exclude 0 · sources 0 · valve — · why ✓
  declare  manifest-needs-evidence       precedent · history · nonEmpty npm-view, context7 · scope target.path · include 1 · exclude 0 · sources 1 (transcript 1) · valve — · why ✓
  skip     covenant-vocabulary           a shell write in scope whose result this layer cannot compute
  ...
surface: commit (git pre-commit) · enforce: advise · disciplines: advise unless enforce: block
  registrations 21 · declare 19 · skip 1 · meta 1 · draft 1
  declare  manifest-needs-evidence       precedent · history · nonEmpty npm-view, context7 · scope target.path · include 1 · exclude 0 · sources 1 (transcript 1) · valve — · why ✓
  declare  sqlite-only-under-knowledge   naming · change · empty placed · scope target.path · include 1 · exclude 0 · sources 0 · valve — · why ✓
```

One line per registration, in the order the surface dispatches them. The kind column has
four words: `meta` (the registrations protecting the judging chain — `self-mod`,
`shell-mod`, and on the session surface `transcript-mod`), `declare` (a declaration entry,
with its mechanism, axes and relations, its scope source, the sizes of its include and
exclude lists, its sources, and whether it carries a valve and a `why`), `skip` (a
registration that records `skipped` instead of judging, with the reason the compiler gave —
the reason that otherwise reaches stderr only on a config fault), and `draft` (an unpromoted
`draft: true` entry, shown on both surfaces since it belongs to neither). `registrations`
counts `meta`, `declare`, and `skip`; `draft` is tallied apart because it never becomes a
registration.
The commit surface's header also names its `adapters.git.enforce` level, since an advising
surface records the same table but blocks nothing.

The session surface is rendered as the hook sees it under a normal payload — with a
transcript present — so `transcript-mod` and the session-reading declarations appear as they
do in a session; on the commit surface those declarations record `skipped` when matched,
which is that surface's permanent condition.

| Call | Result |
|---|---|
| `pdks explain` | Both surfaces on stdout, exit `0` |
| `pdks explain <anything>` | The usage line on stderr, exit `2` |
| no config, two configs, or an invalid one | `pdks explain: <reason>` on stderr, stdout at zero bytes, exit `2` |

### Any other argument form

Anything that is not one of these forms writes the usage line —
`usage: pdks covenant check [--worktree | --range <base>..<head>] | pdks explain |
pdks init claude-code | pdks init grok | pdks docs [topic]` — to stderr and exits `2`.

## Exit codes

Three codes exist, and they live at two layers. **What a consumer's hook observes is only
`0` or `2`** — both composition roots resolve to a named outcome carrying `exitCode: 0 | 2`.

| Code | Constant | Emitted by | Means |
|---|---|---|---|
| `0` | `EXIT_UPHOLD` | Judge outcome, wrapper, bin | The promise was upheld — the call or commit proceeds |
| `1` | `EXIT_BREAK_NON_BLOCKING` | Judge outcome only | A break reported as a signal. The wrapper translates it — into `2` under `enforce: block`, into `0` + an `advised` row under `advise`. It never reaches the surface either way |
| `2` | `EXIT_BREAK_BLOCKING` | Wrapper, bin, fail-closed paths | The call or commit is refused |

The asymmetry is the protocol's responsibility boundary. A judge decides *whether* a
promise was broken and answers `0` or `1` in its outcome; deciding what a break *costs* belongs
to the wrapper, and that is the one place `enforce` is read. A judge can therefore be run,
tested, and reasoned about without knowing whether the surface it runs under blocks or advises.
Only the verdict relaxes: every unjudgeable outcome — an outcome of `2` or higher, a throw
from the judge — stays `2` at either level.

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
function loadConfig(spec: LoadConfigSpec): LoadedConfig;

type LoadConfigSpec = { rootDir: string };

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
function runCovenantCheck(spec: CovenantCheckSpec): Promise<CovenantCheckOutcome>;

type CovenantCheckOutcome = { exitCode: 0 | 2 };

type CovenantCheckSpec = {
  repoRoot: string;                                  // config discovery and collection anchor here
  telemetryPath?: string;                            // overrides the config's log path
  covenantDist?: string;                             // overrides the resolved judge directory
  ttyPrompt?: (prompt: string) => string | null;     // the TTY valve seam
  domain?: CheckDomain;                              // which observation to judge; absent = staged
};

type CheckDomain =
  | { kind: 'staged' }
  | { kind: 'worktree' }
  | { kind: 'range'; base: string; head: string; ancestry?: 'merge-base' };
```

The commit surface's composition root — what [`pdks covenant
check`](#pdks-covenant-check) runs. `ancestry: 'merge-base'` is the `<base>...<head>`
reading; the adapter resolves the merge-base.

`ttyPrompt` absent means a non-TTY environment, and the valve then has no way to open — an
agent-spawned commit and a CI run reach the same state. The valve is a human at a terminal
or nothing.

### `runClaudeCodeHook`

**Type signature:**

```ts
function runClaudeCodeHook(spec: ClaudeCodeHookSpec): Promise<ClaudeCodeHookOutcome>;

type ClaudeCodeHookOutcome = { exitCode: 0 | 2 };

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
| `polydeukes` | The barrel — `loadConfig`, `runCovenantCheck`, their spec and outcome types, `ResolvedConfig`. The session hook lives on its own subpath below and nowhere else |
| `polydeukes/claude-code` | `runClaudeCodeHook`, `ClaudeCodeHookSpec`, and `ClaudeCodeHookOutcome` alone |
| `polydeukes/schema.json` | The config JSON Schema, copied from the core at build time |

The generated hook delegator imports the subpath, not the barrel. ESM imports are eager, so
importing the barrel would load the commit-surface runner — and the git adapter behind it —
on every session tool call that will never use them. The subpath is the session surface's
own entry point, and the barrel is for programmatic consumers.

`polydeukes/schema.json` is for code that reads the schema. A `$schema` line names the file
path instead — an editor reads that string statically, so no module resolver runs on it. Both
spellings are in [configuration.md's IDE section](../configuration.md#ide-support).
