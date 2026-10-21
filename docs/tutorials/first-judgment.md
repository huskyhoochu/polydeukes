# Install and get your first judgment

**English** · [한국어](./first-judgment.ko.md)

Use an empty example project to check protected and ordinary writes. Place the installed single
`pdks` executable on PATH. No separate Node or npm is required. Claude Code is needed for live
session observations, but not for the direct probes below.

<a id="claude-code"></a>

## Install Claude Code integration and check a write

Run these commands in your own terminal, outside an existing protected project:

```sh
mkdir pdks-example
cd pdks-example
git init
pdks adapter claude-code init
```

The installer creates starter configuration, `.claude/settings.json` registrations, documentation
discovery, the `discipline-draft` skill, and a telemetry ignore entry. Existing settings and other
handlers are preserved. Send an observation of a proposed settings write:

```sh
printf '%s\n' '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":".claude/settings.json","content":"{}"}}' \
  | pdks adapter claude-code hook --project-root "$PWD"
printf 'exit=%s\n' "$?"
tail -n 5 .polydeukes/roi.log
```

Expect `exit=2`, a diagnostic naming the protected path on stderr, and a `blocked` row in the
log. This command only asks for a judgment. It does **not** perform the proposed write, so the
settings file stays unchanged and there is no destructive edit to undo.

Repeat with a path outside the protection list:

```sh
printf '%s\n' '{"hook_event_name":"PreToolUse","tool_name":"Write","tool_input":{"file_path":"example.txt","content":"hello"}}' \
  | pdks adapter claude-code hook --project-root "$PWD"
printf 'exit=%s\n' "$?"
tail -n 5 .polydeukes/roi.log
```

Expect `exit=0` and a `passed` row for this starter configuration. Again, no file is written.
You have checked both a blocked and an allowed observation using the installed judge.

Open Claude Code in this project to use the same hook on actual tool calls. Ask it to create
an ordinary text file, then confirm that a new row appears in `.polydeukes/roi.log`. The direct
probe above does not prove that a particular host session loaded its hook registration.

**Before the first config edit:** the loader automatically protects the discovered config
file, even though it is not written in `protectedPaths`. For an intentional session edit, read
`witness.token` and type that token yourself on the first line of a message, with nothing else
on that line. The starter token is `pdks witness` and its window is ten minutes. The valve
supplies permission only after a blocking verdict; an agent cannot supply the human message
for you. Alternatively, make the deliberate configuration edit from your own terminal.

If the probe fails because the package or configuration cannot load, repair the named file or
reinstall from your own terminal. A witness cannot repair a failure that occurs before the
valve is assembled. See [configuration errors](../troubleshooting.md#invalid-config) and
[missing judge](../troubleshooting.md#judge-cannot-be-loaded).

<a id="next-step"></a>

## Continue with a real project

- [Configure the project](../how-to/configure-project.md) to choose whether a violation advises
  or blocks.
- [Connect the surfaces](../how-to/connect-surfaces.md) for Grok, Codex, or a git pre-commit
  hook.
- [Write a discipline](../how-to/write-disciplines.md) and observe an advisory before choosing
  whether it should block.

An exit code alone does not describe all observations. `advised` and `skipped` can accompany
exit 0. Read the diagnostic and the [verdict vocabulary](../troubleshooting.md#reading-verdict).
