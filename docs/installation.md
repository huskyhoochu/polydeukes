# Installing Polydeukes

**English** · [한국어](./installation.ko.md)

> Alpha. This guide covers the install paths that ship today, and everything here is the
> measured behaviour of the published packages.

One devDependency, one command per surface. The umbrella package `polydeukes` is the only
thing you install — it carries the core, the judge, and the adapters as its own
dependencies, and `pdks` is its CLI (an alias of `polydeukes`).

**Two surfaces ship, for two different situations — pick the one that matches how the
project is developed.** A project built alongside an AI partner in Claude Code wires the
**session surface**: a PreToolUse hook that judges every editing tool call and shell
command as it is declared. A project you develop yourself wires the **commit surface**: a
pre-commit hook that judges the staged diff, so the discipline you declared for yourself
is applied at the moment work becomes history. They enforce the same config vocabulary,
but they answer different situations — there is no general reason to wire both in one
project.

## Prerequisites

- **Node.js ≥ 24** — the engines floor of every published package.
- **A package manager** — pnpm and npm both work; examples below use pnpm.
- **Claude Code** — only for the session surface. The commit surface needs no AI tool at
  all: just git and a way to run a pre-commit hook.

## Install

```sh
pnpm add -D polydeukes
```

(or `npm install --save-dev polydeukes`.)

This must be a real project dependency, not a one-off `npx` run — both surfaces load the
judge from your project's own installed package.

## The session surface — developing with an AI partner

From the project root:

```sh
pnpm exec pdks init claude-code
```

The command installs into the directory it is invoked from, and it proves the `polydeukes`
package resolves there **before writing anything** — if it does not (say, the install step
was skipped), it prints the install command and exits 2 with zero files written, never a
half-wired tree.

Four artifacts, none ever overwritten — whatever already exists is reported and left alone,
so re-running is always safe:

| Artifact | What it is |
|---|---|
| `.claude/hooks/covenant-pretooluse.mjs` | The hook — a thin delegator that loads the judge from the installed package. Upgrading the package upgrades the judge; this file never changes. |
| `.claude/settings.json` | The PreToolUse registration for editing tools and shell calls. **Merged, never replaced** — your other hooks and permissions stay. |
| `polydeukes.config.yaml` | The starter protection policy: a placeholder `languages` block, a minimum `protectedPaths` list, and the witness block. The comments in the file explain why each entry is there. |
| `.gitignore` | One appended entry, `.polydeukes/` — telemetry is local observation data and never belongs in history. |

## First edit — `languages`

The generated config ships a placeholder language profile, because the installer cannot
know your stack:

```yaml
languages:
  placeholder:
    productionGlob: 'src/**'
    testCmd: 'echo "set a verification command for {scope}"'
```

Rename the key to your language, point `productionGlob` at your production sources, and put
your real verification command in `testCmd`. (On the commit-surface path you write this
block yourself as part of the config below.) The placeholder is valid as generated and no
judgment path reads these values yet, so it cannot produce a wrong verdict while it waits —
but `languages` is the schema's one required block, so *removing* it (or emptying it) makes
the config invalid, and an invalid config blocks every call. Edit it, don't delete it.

## The commit surface — developing by yourself

This path is for applying your own discipline to your own commits — no AI tool involved.
It has no installer today; the wiring is three small manual steps.

**First, the config.** Create `polydeukes.config.yaml` at the project root (there is no
generator on this path — the file is yours from the first line):

```yaml
languages:
  typescript:
    productionGlob: 'src/**'
    testCmd: 'pnpm test'

# Judged at commit time: a staged change to these paths stops the commit
# until you answer the witness prompt in person.
protectedPaths:
  - 'db/migrations'

witness:
  token: 'pdks witness'
  ttlMinutes: 10
```

Add `.polydeukes/` to your `.gitignore` too — telemetry is local observation data.

**Then, the hook.** One command judges what is currently staged and exits 2 on a broken
covenant:

```sh
pnpm exec pdks covenant check
```

Register it as a pre-commit hook. With **lefthook**:

```yaml
# lefthook.yml
pre-commit:
  commands:
    covenant:
      priority: 1
      interactive: true   # keep the witness prompt visible — see below
      run: ./node_modules/.bin/pdks covenant check
```

With **husky**:

```sh
# .husky/pre-commit
./node_modules/.bin/pdks covenant check
```

With plain **`.git/hooks`** (make it executable):

```sh
#!/bin/sh
# .git/hooks/pre-commit
./node_modules/.bin/pdks covenant check
```

Two things to know about this surface:

- **The valve is a TTY prompt.** At the default `block` level, a commit that stages a
  protected change stops at a prompt only a human at a terminal can answer. Configure your
  hook runner so it does not swallow that prompt (lefthook needs `interactive: true`).
- **The commit surface has its own additive scope.** Paths that are fine to edit freely
  but whose promotion into history deserves a judged checkpoint go under the adapter
  namespace, judged on top of the shared list:

  ```yaml
  adapters:
    git:
      protectedPaths:
        - 'src/policy'
  ```

## The witness valve

Both surfaces carry the same valve, spelled for their situation. It sits **after** the
verdict — only a judgment that actually blocked can be witnessed open — and every allowance
is recorded as `witnessed`, never silent.

```yaml
witness:
  token: 'pdks witness'
  ttlMinutes: 10
```

- **Session surface:** a human types the token so it stands alone on the first line of a
  conversation message; the window holds for `ttlMinutes`, then blocking resumes. An agent
  cannot open the valve for itself — only human-authored messages count.
- **Commit surface:** the blocked commit shows a TTY prompt, and typing the full token
  there opens that one commit.

Change the token and window as you like — the token is not a secret; the defence is
provenance, not confidentiality. **Keep the block**: on the session surface the generated
protection list covers `.claude/hooks`, so without a valve the first blocked call would
freeze the project until a human edits the config from their own terminal.

## Prove the gate is live

Prove it once on the surface you wired, then read the telemetry.

- **Session surface:** ask your agent to append a line to
  `.claude/hooks/covenant-pretooluse.mjs` (a protected path). The call must come back
  blocked.
- **Commit surface:** stage an edit to a path on your protection list and run
  `git commit`. It must stop at the witness prompt (answer it, or abort with Ctrl-C).

```sh
cat .polydeukes/roi.log
```

Every judgment appends exactly one record — `passed`, `blocked`, `witnessed`, `advised`, or
`skipped` — so the block you just caused is the last line. A gate you have watched block
once is a gate you know is wired.

From here: [the configuration reference](./configuration.md) for every field and for
writing your own disciplines, and [troubleshooting](./troubleshooting.md) when something
blocks and you don't know why.
