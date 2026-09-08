# `pdks init`

**English** · [한국어](./init.ko.md)

`pdks init` creates the agent-neutral project scaffold: the config file and the telemetry ignore
line. It knows no agent. Registering a session surface is a separate command owned by that
agent's adapter — `pdks-claude-code init` for Claude Code, and `pdks init grok` for Grok.

<a id="init-syntax"></a>
## Syntax

```sh
pdks init
pdks init grok
```

Those are the two forms the command accepts. Any other argument prints usage and exits `2`.
Both forms are idempotent: existing artifacts are left in place and reported as skipped, and a
preflight failure writes nothing and exits `2`.

<a id="init-common"></a>
## `pdks init` — the scaffold

The command does two things in order:

1. Resolve `polydeukes` from the target project.
2. Create the shared project-side scaffold: config and telemetry ignore line.

The scaffold is the same one every surface starts from:

- `polydeukes.config.yaml`
- `.gitignore` with `.polydeukes/`

The config file starts with the language block, a protection list, a witness block, and commented
discipline examples. It is a starter policy, not a complete project policy.

<a id="init-claude-code"></a>
## Claude Code — `pdks-claude-code init`

The Claude Code session surface is installed by
[`@polydeukes/adapter-claude-code`](../packages/adapter-claude-code.md), which ships its own bin:

```sh
npm install --save-dev polydeukes @polydeukes/adapter-claude-code
npx pdks-claude-code init
```

That command runs `pdks init` for the scaffold, then writes the Claude Code registration
artifacts:

- `.claude/hooks/covenant-pretooluse.mjs`
- `.claude/settings.json`
- `.claude/rules/polydeukes.md`
- `.claude/skills/discipline-draft/SKILL.md`

Details and the per-artifact behaviour are in
[Connect the surfaces](../../how-to/connect-surfaces.md#claude-code).

<a id="init-grok"></a>
## `pdks init grok`

This form installs the Grok session surface.

Created artifacts:

- `.grok/hooks/covenant-pretooluse.mjs`
- `.grok/hooks/covenant-pretooluse.json`
- `polydeukes.config.yaml`
- `.gitignore`

What differs from the Claude Code installer:

- It does not create `.claude/` files.
- It writes a Grok hook JSON registration instead of `.claude/settings.json`.
- If a Claude delegator already exists, the Grok JSON names it instead of creating another
  delegator. Run this form after `pdks-claude-code init`; in the other order each surface keeps
  its own delegator and a tree carrying both spawns two judges per call.
- Generated registrations use a timeout of 60 seconds. The Grok host default is 5 seconds, and a
  timed-out hook fails open. When Claude settings register the same command, the Grok matcher
  follows that registration so command and matcher agree.
- A custom command is left alone; an existing timeout stays.
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
pdks init
pdks init grok
npx pdks-claude-code init
```

The installers are CLI commands. They are not symbols on the `polydeukes` contract.

<a id="init-see-also"></a>
## See also

- [`@polydeukes/adapter-claude-code`](../packages/adapter-claude-code.md) — the Claude Code
install unit and its bin.
- [`pdks docs`](../packages/polydeukes.md#polydeukes-bin) — the installed documentation reader lives
in the same package.
- [`pdks explain`](./explain.md)
- [`Configuration reference`](../configuration/index.md)
- [`polydeukes`](../packages/polydeukes.md)
