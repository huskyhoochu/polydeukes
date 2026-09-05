# Connect the surfaces

**English** · [한국어](../how-to/connect-surfaces.ko.md)

> Pick the surface that matches the job. Claude Code and Grok wire the session surface; git wires
the commit surface.

The two surfaces share the same config vocabulary, but they answer different moments. Use the
session surface when an AI partner is making edits, and use the commit surface when history is about
to be written.

<a id="claude-code"></a>
## Claude Code session surface

Use this when the project is developed alongside an AI partner in Claude Code.

1. Install the package as a project dependency: `pnpm add -D polydeukes`. A one-off `npx` run is
   not enough — both surfaces load the judge from the project's own installed package.
2. Wire the project: `pnpm exec pdks init claude-code`.
3. Keep the generated hook file, settings merge, starter config, discovery rule, and
discipline-draft skill.
4. Reopen the project when the hook changes. The generated hook is a delegator, so upgrading the
package upgrades the judge without rewriting the hook file.

The installer writes `.claude/settings.json` only by merging. Existing hooks and permissions stay in
place. It also writes `.claude/rules/polydeukes.md`, which tells the agent to use `pdks docs`
instead of searching the web, and `.claude/skills/discipline-draft/SKILL.md`, which turns a
described problem into either a judged entry or a draft entry.

<a id="grok"></a>
## Grok session surface

Use this when the project is developed in Grok.

1. Install the package as a project dependency: `pnpm add -D polydeukes`.
2. Wire the project: `pnpm exec pdks init grok`.
3. Reload the Hooks tab or open a new session after the installer finishes.

A Grok tree gets its own hook JSON under `.grok/hooks/`. When a Claude hook already exists, the Grok
command points at that file so the host does not spawn two judges. If the tree also has
`.claude/settings.json`, the Grok matcher follows the Claude registration that names the same
command, because Grok collapses the two registrations only when command and matcher match.
Generated registrations use a timeout of 60 seconds. The Grok host default is 5 seconds, and a
timed-out hook fails open.

Grok does not supply the Claude-format human message needed by the session witness valve. The
session log is ACP `updates.jsonl`, not Claude's JSONL.
For an intentional blocked edit, use your own terminal. A commit-surface prompt witnesses only
that commit; it cannot authorize a blocked Grok tool call.

<a id="commit-surface"></a>
## Commit surface

Use this when you want git to judge staged changes before they become history.

1. Create `polydeukes.config.yaml` at the project root.
2. Add the pre-commit hook.
3. Run `pnpm exec pdks covenant check` when you want the same judgment on demand.

A minimal lefthook entry looks like this:

```yaml
pre-commit:
  commands:
    covenant:
      priority: 1
      interactive: true
      run: ./node_modules/.bin/pdks covenant check
```

A husky hook looks like this:

```sh
# .husky/pre-commit
./node_modules/.bin/pdks covenant check
```

A plain git hook works too:

```sh
#!/bin/sh
./node_modules/.bin/pdks covenant check
```

If you use the plain hook, save it as `.git/hooks/pre-commit` and make it executable with
`chmod +x .git/hooks/pre-commit`. Integrate with an existing hook instead of overwriting it.
For lefthook, install it with your package manager and run its hook installer after saving the YAML.
For husky, save `.husky/pre-commit` through husky's own installer so git can find it.

`adapters.git.enforce: advise` records violations as `advised`, writes diagnostics to stderr,
and lets the commit continue. With `block`, protected-path violations and entries explicitly set
to `enforce: block` can stop the commit. An ordinary entry still defaults to `advise`; the surface
does not promote it. When configured and attached to a terminal, the staged path offers a witness
prompt on `/dev/tty`. `--worktree` and `--range` report without prompting. Assembly errors remain
exit 2 at either level.

<a id="witness-and-recovery"></a>
## Witness and recovery

The witness token is the same idea on both surfaces, but the delivery is different.

- On the session surface, type the token on its own first line in a conversation message.
- On the commit surface, type the full token into the TTY prompt.

The valve is consulted after the judgment returns a block. You can supply the token before an
intentional edit; a previous failed attempt is not required. It does not change a passing verdict
and the session valve does not work with Grok's current transcript format.

If the hook was not picked up in Grok, reload the Hooks tab or start a new session. If the judge
cannot be loaded, reinstall the package or rebuild the workspace and try again.

<a id="what-to-check"></a>
## What to check after wiring

- `pdks explain` shows which registrations each surface assembled.
- `.polydeukes/roi.log` records the rows that the surfaces wrote.
- `pdks covenant check --worktree` is a good on-demand check after a task.
- `pdks covenant check --range <base>..<head>` is the shape to use before a PR.
