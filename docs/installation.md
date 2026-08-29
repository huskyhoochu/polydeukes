# Installing Polydeukes

**English** · [한국어](./installation.ko.md)

> Alpha. This guide covers the install paths that ship today, and everything here is the
> measured behaviour of the published packages.

This is the getting-started layer: from an empty project to a first judged call.

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
pnpm exec pdks init claude-code    # Claude Code
pnpm exec pdks init grok           # Grok
```

The command installs into the directory it is invoked from, and it proves the `polydeukes`
package resolves there **before writing anything** — if it does not (say, the install step
was skipped), it prints the install command and exits 2 with zero files written, never a
half-wired tree.

Nothing existing is overwritten. What exists is reported and kept — the hook, the config,
and the discipline files are left alone, the settings file is merged, and `.gitignore` is
only ever appended to — so re-running is always safe. One command-field exception: if
`.grok/hooks/covenant-pretooluse.json` still names the grok delegator and a Claude
delegator is on disk, the JSON `command` is rewritten to that Claude file so the host
does not spawn two judges. Grok collapses two registrations only when `command` AND
`matcher` are identical, so every grok entry naming that Claude file also takes the matcher
of the `.claude/settings.json` entry that registers the same command — on a fresh write and
on every re-run; `timeout` stays. A command you pointed elsewhere is left as it was.

`pdks init claude-code` writes six artifacts:

| Artifact | What it is |
|---|---|
| `.claude/hooks/covenant-pretooluse.mjs` | The hook — a thin delegator that loads the judge from the installed package. Upgrading the package upgrades the judge; this file never changes. |
| `.claude/settings.json` | The PreToolUse registration for editing tools and shell calls. **Merged, never replaced** — your other hooks and permissions stay. |
| `polydeukes.config.yaml` | The starter protection policy: a placeholder `languages` block, a minimum `protectedPaths` list, and the witness block. The comments in the file explain why each entry is there. |
| `.claude/rules/polydeukes.md` | A scoped discipline file telling your AI partner that `pdks docs` exists and which topic answers what. It carries `paths` frontmatter, so it loads when a Polydeukes path is in play rather than sitting in every session's context. |
| `.claude/skills/discipline-draft/SKILL.md` | The classification procedure. Describe a recurring problem to your AI partner and it lands as a config entry — judged at advise when a current family can express it, a `draft: true` entry otherwise — and the same file tells the agent to consult `advised` rows in the telemetry log at task boundaries. |
| `.gitignore` | An appended ignore rule for `.polydeukes/`, with its comment line — telemetry is local observation data and never belongs in history. |

`pdks init grok` shares the scaffold (config and the ignore line) and writes Grok's own
registration. A Grok-only tree has four artifacts, and no `.claude/` directory:

| Artifact | What it is |
|---|---|
| `.grok/hooks/covenant-pretooluse.mjs` | The hook — the same delegator text, only when no Claude delegator is already on disk. |
| `.grok/hooks/covenant-pretooluse.json` | The PreToolUse matcher, `timeout` 60 (the host default is 5 seconds, and a timed-out hook fails open), and the command that names one delegator file. In a tree that also has `.claude/settings.json`, the matcher is copied from the settings entry with the same command — Grok reads that file too, and collapses the two registrations into one spawn only when `command` and `matcher` match exactly. That copy leans on Grok's tool-name aliases, so if you later remove `.claude/settings.json`, delete this JSON and run `pdks init grok` again to get the Grok-native matcher back. |
| `polydeukes.config.yaml` | The same starter policy as above. |
| `.gitignore` | The same appended ignore line. |

If `.claude/hooks/covenant-pretooluse.mjs` already exists, the JSON command points at that
file instead of planting a second one. A later `pdks init grok` or `pdks init claude-code`
retargets an installer-generated grok-mjs command the same way.

An already-open Grok session keeps the hook snapshot from start. Reload from the Hooks tab
(`r`) or start a new session. The witness valve does not open on Grok — the session log is
ACP `updates.jsonl`, not Claude's JSONL. A block is recovered from another terminal or the
commit-surface TTY.

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
It has no installer today; the wiring is two small manual steps.

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

Three things to know about this surface:

- **The valve is a TTY prompt.** At the default `block` level, a commit that stages a
  protected change stops at a prompt only a human at a terminal can answer. Configure your
  hook runner so it does not swallow that prompt (lefthook needs `interactive: true`).
- **Two discipline families judge here.** A staged diff carries file changes and nothing
  else, so protection lists and the delta and path families (`forbid`, `immutable`) judge
  in full. A command-family entry (`forbidCommand`) has no command line to read in a
  staged diff and is not assembled on this surface, and a context-family entry
  (`requirePrecedent`) is recorded as `skipped` — declare those two where an AI partner's
  session exists to be judged.
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
protection list covers `.claude/hooks` and `.grok/hooks`, so without a valve the first
blocked call would freeze the project until a human edits the config from their own
terminal.

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

From here: [the configuration guide](./configuration.md) for the file and its wiring,
[the configuration reference](./reference/configuration.md) for every field and for
writing your own disciplines, and [troubleshooting](./troubleshooting.md) when something
blocks and you don't know why.
