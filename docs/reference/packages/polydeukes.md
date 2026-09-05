# `polydeukes`

**English** · [한국어](./polydeukes.ko.md)

The umbrella package is the only package a consumer installs. It owns the CLI bin, the config
loader, the commit-surface runner, the session-surface runner subpath, and the bundled schema
artifact.

<a id="polydeukes-entry-points"></a>
## Entry points

| Specifier | What it exports |
|---|---|
| `polydeukes` | `loadConfig`, `runCovenantCheck`, and `ResolvedConfig` |
| `polydeukes/claude-code` | `runClaudeCodeHook` and its spec/outcome types |
| `polydeukes/schema.json` | The bundled config JSON Schema |

The package has one executable name in `bin`: `pdks`, with `polydeukes` as an alias.

<a id="polydeukes-bin"></a>
## CLI surface

| Command | Purpose |
|---|---|
| `pdks covenant check` | Judge the staged diff, the working tree, or a ref range |
| `pdks init claude-code` | Install the Claude Code session surface |
| `pdks init grok` | Install the Grok session surface |
| `pdks explain` | Render the assembled registration table without judging |
| `pdks docs [topic]` | Read a bundled topic |
| `pdks docs search <query>` | Search the bundled docs |
| `pdks docs show <document-id>` | Show one bundled document or section |

`pdks docs` is offline. It reads the installed package, not the network. Flags, JSON, and
exit codes are in [`pdks docs`](../cli/docs.md).

<a id="polydeukes-export-map"></a>
## Export map

<a id="root-export"></a>
### `.` root export

| Symbol | Kind | Notes |
|---|---|---|
| `loadConfig` | function | Discovers exactly one `polydeukes.config.*` file under `rootDir`; throws on missing, ambiguous, parse, or validation failure. |
| `runCovenantCheck` | function | Runs the commit-surface runner and resolves to `{ exitCode: 0 \| 2 }`. |
| `ResolvedConfig` | type | Re-export from `@polydeukes/core`. |
| `LoadConfigSpec`, `LoadedConfig` | types | Configuration loader input and result. |
| `CovenantCheckSpec`, `CovenantCheckOutcome`, `CheckDomain` | types | Commit runner input, result, and observation selection. |

<a id="session-export"></a>
### `./claude-code`

| Symbol | Kind | Notes |
|---|---|---|
| `runClaudeCodeHook` | function | Runs the session-surface runner and resolves to `{ exitCode: 0 \| 2 }`. |
| `ClaudeCodeHookSpec` | type | Input for the session runner. |
| `ClaudeCodeHookOutcome` | type | Session runner result. |

The generated hook imports this subpath, not the barrel. ESM imports are eager, so importing the
barrel would load the commit-surface runner — and the git adapter behind it — on every session tool
call that will never use them.

<a id="schema-export"></a>
### `./schema.json`

| Artifact | Notes |
|---|---|
| `polydeukes.schema.json` | The config schema copy that ships with the umbrella package. |

<a id="polydeukes-signatures"></a>
## Signatures and examples

```ts
function loadConfig(spec: LoadConfigSpec): LoadedConfig;

type LoadConfigSpec = { rootDir: string };

type LoadedConfig = {
  config: ResolvedConfig;
  configPath: string;
};

function runCovenantCheck(spec: CovenantCheckSpec): Promise<CovenantCheckOutcome>;

type CovenantCheckSpec = {
  repoRoot: string;
  telemetryPath?: string;
  covenantDist?: string;
  ttyPrompt?: (prompt: string) => string | null;
  domain?: CheckDomain;
};

type CheckDomain =
  | { kind: 'staged' }
  | { kind: 'worktree' }
  | { kind: 'range'; base: string; head: string; ancestry?: 'merge-base' };

function runClaudeCodeHook(spec: ClaudeCodeHookSpec): Promise<ClaudeCodeHookOutcome>;

type ClaudeCodeHookSpec = {
  repoRoot: string;
  rawPayload?: string;
  telemetryPath?: string;
  covenantDist?: string;
};
```

`ancestry: 'merge-base'` is the `<base>...<head>` reading. `rawPayload` absent means the hook reads
fd 0. The hook types live on `polydeukes/claude-code`, not on the root barrel.

```ts
import { loadConfig, runCovenantCheck } from 'polydeukes';
import { runClaudeCodeHook } from 'polydeukes/claude-code';

const { configPath } = loadConfig({ rootDir: process.cwd() });
const check = await runCovenantCheck({ repoRoot: process.cwd() });
const hook = await runClaudeCodeHook({ repoRoot: process.cwd(), rawPayload: '{}' });
```

<a id="polydeukes-failure-boundaries"></a>
## Failure boundaries

- `loadConfig()` throws on missing, ambiguous, parse, or validation failure.
- `runCovenantCheck()` and `runClaudeCodeHook()` never throw; they resolve to `{ exitCode: 0 \| 2
}`.
- The numeric codes are `EXIT_UPHOLD` (`0`), `EXIT_BREAK_NON_BLOCKING` (`1`), and
  `EXIT_BREAK_BLOCKING` (`2`) from `@polydeukes/core`. The umbrella runners expose only `0` or
  `2`; they never return `1`.
- `pdks covenant check` prompts for a witness token only for the staged domain, never for
`--worktree` or `--range`.
- `pdks docs` and `pdks explain` print nothing partial on failure.

<a id="polydeukes-see-also"></a>
## See also

- [`pdks covenant check`](../cli/covenant-check.md)
- [`pdks init`](../cli/init.md)
- [`pdks explain`](../cli/explain.md)
- [`Configuration reference`](../configuration/index.md)
