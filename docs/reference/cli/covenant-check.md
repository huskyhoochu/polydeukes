# `pdks covenant check`

**English** · [한국어](./covenant-check.ko.md)

`pdks covenant check` runs the commit-surface judgment against the installed package. It reads the
config from the working directory, collects one repository observation, translates it into covenant
input IR, and dispatches the same judge bodies that the session hook uses.

<a id="covenant-check-syntax"></a>
## Syntax

```sh
pdks covenant check
pdks covenant check --worktree
pdks covenant check --range <base>..<head>
pdks covenant check --range <base>...<head>
```

The default form judges the staged diff. `--worktree` judges the working tree. `--range` judges two
refs; the `...` form reads from their merge-base.

<a id="covenant-check-boundaries"></a>
## Observation boundaries

The command is explicit about what it observes.

| Form | Observed set | `pre` → `post` | Notes |
|---|---|---|---|
| `pdks covenant check` | Staged changes only | HEAD blob → staged blob | This is the pre-commit gate. |
| `pdks covenant check --worktree` | Working tree changes | HEAD blob → bytes on disk | Includes untracked files that are not ignored. |
| `pdks covenant check --range <base>..<head>` | The change set between two refs | base blob → head blob | Fails if the refs cannot be resolved. |
| `pdks covenant check --range <base>...<head>` | The merge-base reading of two refs | merge-base blob → head blob | Uses the common ancestor of the refs. |

Untracked, non-ignored files are part of `--worktree`. Untracked ignored files are not
observed. A file git already tracks still appears even if it later matches `.gitignore`. The commit
surface never prompts for a witness token on `--worktree` or `--range` because those forms are
diagnostic only.

<a id="worktree"></a>
## Inspect the working tree with `--worktree`

Run `pdks covenant check --worktree` from a git repository with a valid Polydeukes configuration.
It compares HEAD to the bytes currently on disk, not to the staged contents. Untracked,
non-ignored files are included as additions; tracked files missing from disk are deletions.
Before the first commit, existing tracked and non-ignored untracked files have no `pre` value.

This observation does not create a commit or ask for a witness token. It still applies the
configured enforcement: exit 0 can include advice or skips; an unwitnessed block or assembly
failure exits 2. A clean observation set does not prove that unrelated files or session history
were judged. It appends telemetry for judgments; it is not a read-only query like `pdks docs`.

<a id="covenant-check-results"></a>
## Results and exit codes

| Situation | Result |
|---|---|
| No covenant breaks | exit `0` |
| A break under `enforce: advise` | exit `0`, one `advised` row on stderr and telemetry |
| A staged break under `enforce: block` with a configured witness block | Prompts once on `/dev/tty`; a correct token opens the block, a missing or wrong answer exits `2` |
| A staged break under `enforce: block` without a witness block | exit `2`, no prompt |
| A break on `--worktree` or `--range` under `enforce: block` | exit `2`, no prompt |
| Empty domain | exit `0` |
| Invalid flag syntax | exit `2` with the usage line on stderr |
| Missing, ambiguous, or invalid config | exit `2` |
| Unresolved range or missing merge-base | exit `2` |
| Judge body cannot load | exit `2` |

An entry defaults to `advise`; `adapters.git.enforce: block` does not promote it. Protected-path
violations and entries explicitly set to `enforce: block` can block when the surface is also at
`block`. A witness prompt additionally requires a configured token and an accessible terminal.

`exit 0` can mean passing, advising, skipping, or an empty observation set. `exit 2` means the run
was fail-closed or the witness token did not open the gate.

<a id="covenant-check-examples"></a>
## Examples

```sh
pdks covenant check
pdks covenant check --worktree
pdks covenant check --range main..HEAD
pdks covenant check --range main...feature
```

```ts
import { runCovenantCheck } from 'polydeukes';

const result = await runCovenantCheck({ repoRoot: process.cwd() });
// result is { exitCode: 0 | 2 }
```

<a id="covenant-check-see-also"></a>
## See also

- [`pdks explain`](./explain.md)
- [`@polydeukes/adapter-git`](../packages/adapter-git.md)
- [`@polydeukes/covenant`](../packages/covenant.md)
- [`Configuration reference`](../configuration/index.md#adapters-git)
