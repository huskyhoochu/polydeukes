# Connect the surfaces

**English** · [한국어](../how-to/connect-surfaces.ko.md)

> Pick the surface that matches the job. Claude Code, Grok, and Codex wire the session surface;
git wires the change-set surface.

The two surfaces share the same config vocabulary, but they answer different moments. Use the
session surface when an AI partner is making edits, and use the change-set surface when history
is about to be written.

<a id="claude-code"></a>
## Claude Code session surface

Use this when the project is developed alongside an AI partner in Claude Code.

1. Install the three packages as project dependencies: `pnpm add -D polydeukes
   @polydeukes/core @polydeukes/adapter-claude-code`. A one-off `npx` run is not enough —
   both surfaces load the judge from the project's own installed package.
2. Wire the project from its root: `pnpm exec pdks-claude-code init`. The adapter ships this bin;
   it runs `pdks init` for the scaffold, then writes the Claude Code registration artifacts.
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

1. Install the three packages as project dependencies: `pnpm add -D polydeukes @polydeukes/core @polydeukes/adapter-grok`.
2. Wire the project from its root: `pnpm exec pdks-grok init`. The adapter ships this bin; it
   runs `pdks init` for the scaffold, then writes the Grok registration artifacts.
3. Reload the Hooks tab or open a new session after the installer finishes.

A Grok tree gets its own hook JSON and delegator under `.grok/hooks/`. Generated registrations
use a timeout of 60 seconds. The Grok host default is 5 seconds, and a timed-out hook fails
open. Installing more than one session adapter in one project can run the judge twice per call.

Grok does not supply the Claude-format human message needed by the session witness valve. The
session log is ACP `updates.jsonl`, not Claude's JSONL.
For an intentional blocked edit, use your own terminal. The change-set surface has no prompt, so
there is no way to authorize a blocked Grok tool call from that side either.

<a id="codex"></a>
## Codex session surface

Use this when the project is developed in Codex.

1. Install the three packages as project dependencies: `pnpm add -D polydeukes @polydeukes/core @polydeukes/adapter-codex`.
2. Wire the project from its root: `pnpm exec pdks-codex init`. The adapter ships this bin; it
   runs `pdks init` for the scaffold, then writes the Codex registration artifacts.
3. Approve the generated hook with `/hooks` in Codex. Until you do, it is skipped.

A Codex tree gets a delegator at `.codex/hooks/covenant-pretooluse.mjs` and an entry in
`.codex/hooks.json`. That JSON is merged, not overwritten: other events, other matchers, and
keys the installer does not know stay where they are. The scaffold config protects
`.codex/hooks` by default.

**Approval is not optional.** Codex records trust against the hash of a hook's definition, so a
newly written hook is listed for review and skipped until someone approves it — until then
nothing is judged. `init` writes a byte-identical command string on every run, so a re-install
does not invalidate an approval you already gave.

Codex normalises every file edit that reaches the hook into one tool, `apply_patch`, and sends
the patch text rather than a path argument. `Edit` and `Write` are matcher aliases you may
write in the hooks file; they never arrive as the tool name. One patch that touches several
files carries one IR element per file, and any one of them blocking blocks the whole call.

**An approved hook does not cover Code Mode.** In codex-cli 0.154 a Code Mode `exec` dispatch,
and the tool calls nested in its JavaScript, do not reach `PreToolUse`
([openai/codex#23411](https://github.com/openai/codex/issues/23411)), so an edit made that way
is neither judged nor logged even while `/hooks` shows the hook Active. `init` prints this as a
`note:` line; the [package reference](../reference/packages/adapter-codex.md#limits)
lists it with the other declared limits.

Codex supplies no transcript channel, so the session witness valve has no human message to read.
For an intentional blocked edit, use your own terminal. Installing more than one session adapter
in one project can run the judge twice per call.


<a id="change-set-surface"></a>
## Change-set surface

Use this when you want git to judge staged changes before they become history.

1. Create `polydeukes.config.yaml` at the project root.
2. Add the pre-commit hook.
3. Run `git diff HEAD | pnpm exec pdks covenant check --diff` when you want the same judgment
   on demand.

A minimal lefthook entry looks like this. The `git diff` flags pin what the judge receives:
no color codes, no external diff driver, no textconv rewrite, and the `a/`/`b/` prefixes the
translator strips — a user's git config cannot change the observation (see the CLI reference).

```yaml
pre-commit:
  commands:
    covenant:
      priority: 1
      run: git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | ./node_modules/.bin/pdks covenant check --diff
```

A husky hook looks like this:

```sh
# .husky/pre-commit
git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | ./node_modules/.bin/pdks covenant check --diff
```

A plain git hook works too:

```sh
#!/bin/sh
git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | ./node_modules/.bin/pdks covenant check --diff
```

If you use the plain hook, save it as `.git/hooks/pre-commit` and make it executable with
`chmod +x .git/hooks/pre-commit`. Integrate with an existing hook instead of overwriting it.
For lefthook, install it with your package manager and run its hook installer after saving the YAML.
For husky, save `.husky/pre-commit` through husky's own installer so git can find it.

The judge emits exit 0 or exit 2 and never prompts. By default every break on this surface — a
`protectedPaths` violation included — lands as a row with a diagnostic on stderr and exit 0: a
staged gate-file change has already passed the session surface or was made by a human, and
this surface has no valve a human could answer. Add `--enforce block` to the command when you
want a `protectedPaths` violation or an entry set to `enforce: block` to exit 2. Whether a commit
stops is your hook wiring: the entries above honour the exit code. Assembly errors always exit 2.

<a id="witness-and-recovery"></a>
## Witness and recovery

The witness token is the same idea on both surfaces, but the delivery is different.

- On the session surface, type the token on its own first line in a conversation message.
- The change-set surface has no prompt. Its judgment reaches you as an exit code, and your hook
  wiring decides what to do with it.

The valve is consulted after the judgment returns a block. You can supply the token before an
intentional edit; a previous failed attempt is not required. It does not change a passing verdict
and the session valve does not work with Grok's current transcript format.

If the hook was not picked up in Grok, reload the Hooks tab or start a new session. If the judge
cannot be loaded, reinstall the package or rebuild the workspace and try again.

<a id="what-to-check"></a>
## What to check after wiring

- `pdks explain` shows which registrations each surface assembled.
- `.polydeukes/roi.log` records the rows that the surfaces wrote.
- `git diff HEAD | pdks covenant check --diff` is a good on-demand check after a task.
- `git diff <base>..<head> | pdks covenant check --diff` is the shape to use before a PR.
