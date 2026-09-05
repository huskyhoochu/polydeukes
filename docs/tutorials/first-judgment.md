# Install and get your first judgment

**English** · [한국어](./first-judgment.ko.md)

Use an empty example project to install Polydeukes and check a protected write without changing
the protected file. You need Node.js 24 or later, pnpm, and git. Claude Code is needed to observe
live session calls, but not to run the hook probe below.

<a id="claude-code"></a>

## Install Claude Code integration and check a write

Run these commands in your own terminal, outside an existing protected project:

```sh
mkdir pdks-example
cd pdks-example
git init
printf '{"name":"pdks-example","private":true}\n' > package.json
pnpm add -D polydeukes   # a project dependency, not a one-off npx run
pnpm exec pdks init claude-code
```

The installer reports `created` or `skipped` for each artifact. It creates a starter config,
the hook delegator, the Claude Code registration, a documentation discovery file, the
`discipline-draft` skill, and a telemetry ignore entry. Existing user files are preserved;
settings are merged rather than replaced.

Now send the generated hook an observation of a proposed write to its settings file:

```sh
printf '%s\n' '{"tool_name":"Write","tool_input":{"file_path":".claude/settings.json","content":"{}"}}' \
  | node .claude/hooks/covenant-pretooluse.mjs
printf 'exit=%s\n' "$?"
tail -n 5 .polydeukes/roi.log
```

Expect `exit=2`, a diagnostic naming the protected path on stderr, and a `blocked` row in the
log. This command only asks for a judgment. It does **not** perform the proposed write, so the
settings file stays unchanged and there is no destructive edit to undo.

Repeat with a path outside the protection list:

```sh
printf '%s\n' '{"tool_name":"Write","tool_input":{"file_path":"example.txt","content":"hello"}}' \
  | node .claude/hooks/covenant-pretooluse.mjs
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

- [Configure the project](../how-to/configure-project.md) to replace the placeholder language
  and test command.
- [Connect the surfaces](../how-to/connect-surfaces.md) for Grok or a git pre-commit hook.
- [Write a discipline](../how-to/write-disciplines.md) and observe an advisory before choosing
  whether it should block.

An exit code alone does not describe all observations. `advised` and `skipped` can accompany
exit 0. Read the diagnostic and the [verdict vocabulary](../troubleshooting.md#reading-verdict).
