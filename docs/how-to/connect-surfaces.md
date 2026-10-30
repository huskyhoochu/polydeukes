# Connect the surfaces

**English** · [한국어](../how-to/connect-surfaces.ko.md)

> Pick the surface that matches the job. Claude Code, Grok, and Codex wire the session surface; git
> wires the change-set surface.

The two surfaces share the same config vocabulary, but they answer different moments. Use the
session surface when an AI partner is making edits, and use the change-set surface when history is
about to be written.

A write in a linked git worktree of the registered project is judged with the registered project's
config, by the file's absolute path: protected entries still match, while disciplines scoped by a
project-relative `target.path` pattern do not apply there. Its rows land in the registered project's
telemetry.

<a id="claude-code"></a>
## Claude Code session surface

```sh
pdks adapter claude-code init
```

Run the installed single executable from the project root. No separate Node, npm, or adapter
installation is required. Registration pins the absolute executable and project-root paths while
preserving other handlers and settings. Rerun after moving either.

Reopen the project and check telemetry for an actual call. Only messages identified by
`origin.kind: human` can support the witness valve.

[Registration details](../reference/cli/init.md#init-claude-code)

<a id="grok"></a>
## Grok session surface

```sh
pdks adapter grok init
```

Run the installed single executable from the project root. No separate Node, npm, or adapter
installation is required. Registration pins the absolute executable and project-root paths while
preserving other handlers and settings. Rerun after moving either.

Approve project trust and reload the Hooks tab. Grok needs its own registration. Under Grok’s
`GROK_WORKSPACE_ROOT`, the Claude compatibility callback is skipped to avoid duplicate judgment.
Current events supply no session history or human provenance, so protected changes requiring the
witness valve belong in your own terminal.

[Registration details](../reference/cli/init.md#init-grok)

<a id="codex"></a>
## Codex session surface

```sh
pdks adapter codex init
```

Run the installed single executable from the project root. No separate Node, npm, or adapter
installation is required. Registration pins the absolute executable and project-root paths while
preserving other handlers and settings. Rerun after moving either.

Approve the definition through `/hooks`. Code Mode coverage varies by version; verify actual nested
calls. Transcript files are never read, and current prompts do not establish human provenance.
Perform protected changes from your own terminal.

[Registration details](../reference/cli/init.md#init-codex)

<a id="change-set-surface"></a>
## Change-set surface

Use this when you want git to judge staged changes before they become history.

1. Create `polydeukes.config.yaml` at the project root.
2. Add the pre-commit hook.
3. Run `git diff HEAD | pdks covenant check --diff` when you want the same judgment on demand.

A minimal lefthook entry looks like this. The `git diff` flags pin what the judge receives: no color
codes, no external diff driver, no textconv rewrite, and the `a/`/`b/` prefixes the translator
strips — a user's git config cannot change the observation (see the CLI reference).

```yaml
pre-commit:
  commands:
    covenant:
      priority: 1
      run: git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff
```

A husky hook looks like this:

```sh
# .husky/pre-commit
git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff
```

A plain git hook works too:

```sh
#!/bin/sh
git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff
```

If you use the plain hook, save it as `.git/hooks/pre-commit` and make it executable with
`chmod +x .git/hooks/pre-commit`. Integrate with an existing hook instead of overwriting it. For
lefthook, install it with your package manager and run its hook installer after saving the YAML. For
husky, save `.husky/pre-commit` through husky's own installer so git can find it.

The judge emits exit 0, 2, or 3 (an input it could not read) and never prompts. By default every
break on this surface — a `protectedPaths` violation included — lands as a row with a diagnostic on
stderr and exit 0: a staged gate-file change has already passed the session surface or was made by a
human, and this surface has no valve a human could answer. Add `--enforce block` to the command when
you want a `protectedPaths` violation or an entry set to `enforce: block` to exit 2. Whether a
commit stops is your hook wiring: the entries above honour the exit code. Assembly errors always
exit 2.

<a id="witness-and-recovery"></a>
## Witness and recovery

In a Claude session that proves human provenance, send the configured token alone on the first line,
then retry the intentional change within its TTL. The witness valve is consulted after a blocking
result. Current Codex and Grok prompts do not establish that provenance; perform protected changes
from your own terminal. The change-set surface has no witness prompt; your hook acts on the exit
code.

A witness cannot repair a missing executable, unapproved trust, or a disabled hook. Repair the path
or host approval and verify another real call and its telemetry.

<a id="what-to-check"></a>
## What to check after wiring

- `pdks explain` shows which registrations each surface assembled.
- `.polydeukes/roi.log` records the rows that the surfaces wrote.
- `git diff HEAD | pdks covenant check --diff` is a good on-demand check after a task.
- `git diff <base>..<head> | pdks covenant check --diff` is the shape to use before a PR.
