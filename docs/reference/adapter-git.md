# `@polydeukes/adapter-git`

**English** · [한국어](./adapter-git.ko.md)

> **The commit surface's translator** — a staged diff becomes the covenant input IR, and
> the `adapters.git` config namespace is defined here.
>
> Alpha. A transitive dependency of the umbrella: you do not install it and you do not
> import it. The commit surface reaches it through
> [`pdks covenant check`](./polydeukes.md#pdks-covenant-check).

## What this package owns

The boundary where git's vocabulary is translated away. A staged diff becomes the same
agent-neutral input IR the session surface produces — the same judgment for every hand,
AI or human.

| Unit | What it does |
|---|---|
| Staged-change collection | Reads the staging area into a list of changes with their content baselines |
| Pure translation | Folds those changes into one `CovenantInput` |
| Settings vocabulary | Validates this adapter's own config namespace |

This is a pure library. It knows the staged-diff shape and nothing about installation, hook
runners, or valves — wiring it into a pre-commit hook is a deployment act that lives in the
umbrella.

## Staged collection and the `adapters.git` namespace

**Collection is deliberately narrow about what it trusts.**

| Decision | Why |
|---|---|
| `--no-renames` forced on | A rename is judged as a deletion plus an addition. A `git mv` of a protected file must not slip through as one opaque rename entry |
| `pre` from the HEAD blob, `post` from the **staged** blob | Never the worktree, which may have diverged after `git add` |
| A binary blob yields null content | Rather than lossily decoded bytes |
| The unborn first commit narrows to all-added | Rather than throwing |

Translation produces one tool call per change, under the adapter-owned names `staged-write`
and `staged-delete`. A deletion always carries its evidence. A write carries it unless the
staged blob was binary — there is no text to compare, so the call arrives with no
`fileChange` at all and is judged on its path alone, the same as any unproven call.
**The session collections are honestly empty** — the commit surface has no session, and a
key is never fabricated to look like one.

**The namespace is this adapter's own vocabulary.** The core validates only the container
shape — one settings object per adapter — and passes the contents through verbatim, so the
vocabulary, its validator, and its defaults all live here.

| Key | Values | Default | Means |
|---|---|---|---|
| `adapters.git.enforce` | `block` \| `advise` | `block` | What a commit-surface verdict *does* |
| `adapters.git.protectedPaths` | string[] | `[]` | The commit surface's **additive** protection scope, judged on top of the common list |

An unknown key, an `enforce` outside the two values, or a `protectedPaths` that is not an
array of strings each fail fast with the full field path. The writing reference is
[the configuration reference's `adapters` section](./configuration.md#adapters).

**The additive scope is additive for a reason.** The level belongs to the observer, and so
does the scope: entries listed here are judged when work becomes history, and the session
surface never reads them. That is what lets a repository leave judge *sources* editable in
a session while still stopping the commit that promotes them.

Under `enforce: advise` the valve is structurally absent: a verdict is recorded as
`advised`, one advisory line lands on stderr, and the commit proceeds. Only the verdict is
relaxed — a run that cannot judge still fails closed at exit `2` at either level.

## Where the consumer touches it

- **The `adapters.git` block** in your config.
- **The pre-commit hook** that runs `pdks covenant check`, wired by hand — the manual
  procedure for three hook managers is in
  [installation](../installation.md#the-commit-surface--developing-by-yourself).

No import.

## Declared limits

- **The context family cannot be judged here.** `requirePrecedent` needs session history
  and a commit has none, so a matching entry records `skipped`. A permanent condition of
  this surface, not a fault in the entry.
- **A commit never shows a gitignored file.** Anything outside version control — a built
  `dist`, a generated hook script — is invisible to this surface by nature. That is why the
  session surface carries those paths on the common list instead.
- **The valve needs a human at a terminal.** No TTY means no prompt and no way through: a
  CI run and an agent-spawned `git commit` reach the same closed door. Nothing is ever
  persisted, so one answer never covers a later commit.
