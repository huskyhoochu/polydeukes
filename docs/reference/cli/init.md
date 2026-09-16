# `pdks init`

**English** · [한국어](./init.ko.md)

`pdks init` creates the agent-neutral project scaffold: the config file and the telemetry ignore
line. It knows no agent. Registering a session surface is a separate command owned by that
agent's adapter — `pdks-claude-code init` for Claude Code, `pdks-grok init` for Grok, and
`pdks-codex init` for Codex.

<a id="init-syntax"></a>
## Syntax

```sh
pdks init
```

Any other argument prints usage and exits `2`. The command is idempotent: existing artifacts are
left in place and reported as skipped, and a preflight failure writes nothing and exits `2`.

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
npm install --save-dev polydeukes @polydeukes/core @polydeukes/adapter-claude-code
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
## Grok — `pdks-grok init`

The Grok session surface is installed by
[`@polydeukes/adapter-grok`](../packages/adapter-grok.md), which ships its own bin:

```sh
npm install --save-dev polydeukes @polydeukes/core @polydeukes/adapter-grok
npx pdks-grok init
```

That command runs `pdks init` for the scaffold, then writes the Grok registration artifacts:

- `.grok/hooks/covenant-pretooluse.mjs`
- `.grok/hooks/covenant-pretooluse.json`

It does not create or rewrite `.claude/` files. Generated registrations use a timeout of 60
seconds. The Grok host default is 5 seconds, and a timed-out hook fails open. Installing more
than one session adapter in one project can run the judge twice per call.

Grok does not supply the human-message evidence required by the Claude session witness valve.
The session log is ACP `updates.jsonl`, not Claude's JSONL.
See [Grok recovery](../../troubleshooting.md#grok-witness). Details are in
[Connect the surfaces](../../how-to/connect-surfaces.md#grok).

<a id="init-codex"></a>
## Codex — `pdks-codex init`

The Codex session surface is installed by
[`@polydeukes/adapter-codex`](../packages/adapter-codex.md), which ships its own bin:

```sh
npm install --save-dev polydeukes @polydeukes/core @polydeukes/adapter-codex
npx pdks-codex init
```

That command runs `pdks init` for the scaffold, then writes the Codex registration artifacts:

- `.codex/hooks/covenant-pretooluse.mjs`
- `.codex/hooks.json`

`hooks.json` is merged rather than overwritten: other events, other matchers, and keys the
installer does not know are left in place. The scaffold config protects `.codex/hooks` by
default, so the registration this installer writes is covered by the config it writes.

**Approving the hook is part of the install.** Codex records trust against the hash of a hook's
definition, so the generated hook is listed for review and skipped until you approve it with
`/hooks`. Until someone does, nothing is judged. This is why `init` writes a byte-identical
command string on every run — a changed string needs approving again.

Codex normalises every file edit into one tool, `apply_patch`, and delivers the patch text
rather than a path argument. `Edit` and `Write` are matcher aliases you may write in
`.codex/hooks.json`; they never arrive as the tool name. One patch that touches several files
carries one IR element per file, and any one of them blocking blocks the whole call.

Codex supplies no transcript channel, so the session witness valve has no human-message
evidence to read. For an intentional blocked edit, use your own terminal. Details are in
[Connect the surfaces](../../how-to/connect-surfaces.md#codex).

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
npx pdks-claude-code init
npx pdks-grok init
npx pdks-codex init
```

The installers are CLI commands. They are not symbols on the `polydeukes` contract.

<a id="init-see-also"></a>
## See also

- [`@polydeukes/adapter-claude-code`](../packages/adapter-claude-code.md) — the Claude Code
install unit and its bin.
- [`@polydeukes/adapter-grok`](../packages/adapter-grok.md) — the Grok install unit and its bin.
- [`@polydeukes/adapter-codex`](../packages/adapter-codex.md) — the Codex install unit and its
bin.
- [`pdks docs`](../packages/polydeukes.md#polydeukes-bin) — the installed documentation reader lives
in the same package.
- [`pdks explain`](./explain.md)
- [`Configuration reference`](../configuration/index.md)
- [`polydeukes`](../packages/polydeukes.md)
