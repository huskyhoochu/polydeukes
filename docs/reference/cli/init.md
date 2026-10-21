# `pdks init` and adapter connection

**English** · [한국어](./init.ko.md)

Use the installed single `pdks` executable for project configuration and all three host connections.
No separate Node, npm, or project package installation is required. Every init command installs in
the current directory.

<a id="init-syntax"></a>
## Syntax

```sh
pdks init
pdks adapter claude-code init
pdks adapter codex init
pdks adapter grok init
```

<a id="init-common"></a>
## `pdks init` — the scaffold

Creates `polydeukes.config.yaml` and adds `.polydeukes/` to `.gitignore`. Existing configuration is
preserved. More than one `.yaml`, `.yml`, or `.json` configuration file is refused. The starter
configuration includes protected paths, a witness block, and discipline examples.

<a id="init-claude-code"></a>
## Claude Code — `pdks adapter claude-code init`

Creates the shared scaffold and registers the absolute executable and project-root paths in
`.claude/settings.json`. It merges `PreToolUse`, `UserPromptSubmit`, `PostToolUse`, and
`SessionEnd`, preserving other handlers and owner keys.

Also creates `.claude/rules/polydeukes.md` and the `discipline-draft` skill when absent. Reopen the
project in Claude Code.

<a id="init-grok"></a>
## Grok — `pdks adapter grok init`

Creates the shared scaffold and registers the absolute executable and project-root paths in
`.grok/hooks/covenant-pretooluse.json`. It merges `PreToolUse`, `UserPromptSubmit`, `PostToolUse`,
and `SessionEnd`, preserving other handlers and owner keys.

Approve project trust in Grok and reload its Hooks tab. Claude compatibility registrations are
skipped in the Grok environment, so Grok needs its own registration. Current Grok evidence cannot
open the witness valve; perform protected changes from your own terminal.

<a id="init-codex"></a>
## Codex — `pdks adapter codex init`

Creates the shared scaffold and registers the absolute executable and project-root paths in
`.codex/hooks.json`. It merges `PreToolUse`, `UserPromptSubmit`, `PostToolUse`, and `SessionEnd`,
preserving other handlers and owner keys.

Approve the definition through Codex `/hooks`. Trust is tied to its definition hash. Current prompts
do not establish human provenance and cannot open the witness valve; perform protected changes from
your own terminal.

<a id="init-results"></a>
## Results and migration

Success exits 0; invalid arguments, invalid settings JSON, ambiguous configuration, and write
failures exit 2. Output distinguishes `created`, `updated`, `unchanged`, and `preserved` paths and
reports required protected paths. Check that the existing configuration’s `protectedPaths` covers
them. Host deadlines are 60 seconds for PreToolUse, 30 for prompt/post events, and 5 for session
end.

Replace `pdks-claude-code`, `pdks-codex`, and `pdks-grok` with the commands above. The installer
replaces its own legacy handlers and removes generated `.mjs` files only when they match the
original. Modified delegators are preserved. After moving the executable or project, rerun init and
check host trust. Global settings are unchanged.

A write failure can leave partial artifacts. Repair the error and rerun.

<a id="init-examples"></a>
## Probe a hook directly

```sh
pdks adapter claude-code hook --project-root /absolute/project < event.json
```

This command judges a complete host event without executing the tool itself. Separately verify that
the real host loaded its registration.

<a id="init-see-also"></a>
## See also

- [Connect the surfaces](../../how-to/connect-surfaces.md)
