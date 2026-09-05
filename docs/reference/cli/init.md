# `pdks init`

**English** · [한국어](./init.ko.md)

`pdks init` wires a project into the session surface. The command has two forms: `claude-code` and
`grok`. Both start with the same preflight: the package must resolve from the target project before
anything is written.

<a id="init-syntax"></a>
## Syntax

```sh
pdks init claude-code
pdks init grok
```

Both forms are idempotent. Existing artifacts are left in place and reported as skipped. A preflight
failure writes nothing and exits `2`.

<a id="init-common"></a>
## Shared preflight and scaffold

The installer does three things in order:

1. Resolve `polydeukes` from the target project.
2. Create the shared project-side scaffold: config and telemetry ignore line.
3. Add the surface-specific registration artifacts.

The shared scaffold is the same for both installers:

- `polydeukes.config.yaml`
- `.gitignore` with `.polydeukes/`

The config file starts with the language block, a protection list, a witness block, and commented
discipline examples. It is a starter policy, not a complete project policy.

<a id="init-claude-code"></a>
## `pdks init claude-code`

This form installs the Claude Code session surface.

Created artifacts:

- `.claude/hooks/covenant-pretooluse.mjs`
- `.claude/settings.json`
- `.claude/rules/polydeukes.md`
- `.claude/skills/discipline-draft/SKILL.md`
- `polydeukes.config.yaml`
- `.gitignore`

What each artifact does:

- The hook file is a delegator that imports `polydeukes/claude-code`.
- The settings file merges a PreToolUse registration instead of replacing the whole file.
- The discovery file tells the AI partner to use `pdks docs` instead of web search.
- The skill file turns a described discipline problem into a config entry.
- The config and ignore line come from the shared scaffold.

Existing hook, config, discovery, and skill files are preserved. Settings registrations are
merged and the ignore entry is appended if absent. Re-running can also reconcile a generated
Grok registration as described below; it is not an unconditional no-op.

Package upgrades do not overwrite a customized skill. Generate a fresh copy in a disposable
project, compare it with the existing file, and merge the selected changes after taking a backup.
Do not delete the working project's skill merely to force regeneration.

<a id="init-grok"></a>
## `pdks init grok`

This form installs the Grok session surface.

Created artifacts:

- `.grok/hooks/covenant-pretooluse.mjs`
- `.grok/hooks/covenant-pretooluse.json`
- `polydeukes.config.yaml`
- `.gitignore`

What differs from the Claude Code form:

- It does not create `.claude/` files.
- It writes a Grok hook JSON registration instead of `.claude/settings.json`.
- If a Claude delegator already exists, the Grok JSON names it instead of creating another
delegator.
- Generated registrations use a timeout of 60 seconds. The Grok host default is 5 seconds, and a
  timed-out hook fails open. When Claude settings register the same command, the Grok matcher
  follows that registration so command and matcher agree.
- Re-running either installer can retarget a generated Grok-delegator command to the existing
  Claude file and reconcile its matcher. A custom command is left alone; an existing timeout stays.
- If you later remove Claude settings, regenerate the Grok JSON to restore the Grok-native matcher.
  Back up custom settings first. Reload Grok's Hooks tab or start a new session after changes.

Grok does not supply the human-message evidence required by the Claude session witness valve.
The session log is ACP `updates.jsonl`, not Claude's JSONL.
See [Grok recovery](../../troubleshooting.md#grok-witness).

<a id="init-results"></a>
## Results and failure conditions

| Situation | Result |
|---|---|
| Package resolves and the target tree can be scaffolded | exit `0` |
| A requested artifact already exists | Reported as skipped, but the command still exits `0` |
| The package cannot be resolved from the target project | exit `2`, nothing written |
| The config path is ambiguous | exit `2`, nothing written |
| The settings file is unreadable or unparseable | exit `2`, nothing written |
| Any other preflight or write failure | exit `2` |

Preflight failures occur before writing. A later filesystem write failure can leave some
artifacts created; the installer is not an atomic transaction. Inspect the error, repair the
filesystem problem, and rerun rather than assuming every failed installation left an empty tree.

<a id="init-examples"></a>
## Examples

```sh
pdks init claude-code
pdks init grok
```

The installer is a CLI command. It is not a symbol on the `polydeukes` or
`polydeukes/claude-code` contract.

<a id="init-see-also"></a>
## See also

- [`pdks docs`](../packages/polydeukes.md#polydeukes-bin) — the installed documentation reader lives
in the same package.
- [`pdks explain`](./explain.md)
- [`Configuration reference`](../configuration/index.md)
- [`polydeukes`](../packages/polydeukes.md)
