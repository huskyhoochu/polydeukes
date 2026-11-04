# `pdks init`

**English** · [한국어](./init.ko.md)

Create project configuration, then connect a host with its installed adapter. Each init installs in
the current directory.

<a id="init-syntax"></a>
## Syntax

```sh
pdks init
pdks-claude-code init
pdks-codex init
```

Adapters are optional installations. See [installation](../../how-to/install.md).

<a id="init-common"></a>
## Project configuration

Creates `polydeukes.config.yaml` and the `.polydeukes/` entry in `.gitignore`. Existing
configuration is preserved; multiple config candidates are refused. The starter has witness settings
and empty discipline lists. Adapter init adds host protection paths; the loader automatically
protects the configuration file it loaded.

<a id="init-claude-code"></a>
## claude-code

```sh
pdks-claude-code init
```

Runs `pdks init` and registers `PreToolUse`. Protected paths are
`.claude/settings.json, .claude/settings.local.json`. Registration pins the absolute project root,
adapter, and judge found on PATH. Other tools’ handlers and owner settings are preserved.

Creates `.claude/rules/polydeukes.md` and the `discipline-draft` skill when absent. Reopen Claude
Code and verify a new telemetry row for a real call.

<a id="init-codex"></a>
## codex

```sh
pdks-codex init
```

Runs `pdks init` and registers `PreToolUse, PostToolUse, SessionEnd`. Protected paths are
`.codex/hooks.json, .codex/config.toml`. Registration pins the absolute project root, adapter, and
judge found on PATH. Other tools’ handlers and owner settings are preserved.

Approve the definition through Codex `/hooks`. PostToolUse records tool history; SessionEnd removes
it. Human-message evidence is absent, so make protected edits from your own terminal.

<a id="init-results"></a>
## Results and path changes

Success exits 0; argument, configuration, and write errors exit 2. Rerun init after moving the
project or executable and recheck host trust. Registrations carry neither `onFailure` nor
`|| exit 2`. If the adapter cannot start, the host may proceed silently. If the adapter cannot start
the judge, it prints installation guidance and lets the call proceed. Verify judgment in the log.

Old TypeScript handlers and `.mjs` files are not removed automatically. Follow the
[migration
procedure](../../how-to/migrate-to-rust.md#hooks).
A write failure can leave partial artifacts; repair the error and rerun.

<a id="init-examples"></a>
## Direct probe

```sh
pdks-claude-code hook --project-root /absolute/project --pdks /absolute/bin/pdks < event.json
```

Both paths are absolute and flags stay in this order. This judges the event without executing its
tool. Run the complete examples in [first judgment](../../tutorials/first-judgment.md).

<a id="init-see-also"></a>
## See also

[Connection guide](../../how-to/connect-surfaces.md)
