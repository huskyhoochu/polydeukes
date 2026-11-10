# Run the change-set check from git

**English** · [한국어](./git-hooks.ko.md)

The change-set surface judges a finished diff. You can run it by hand, in CI, or from a commit hook.
This page gives the command and the setup for four hook tools.

<a id="contract"></a>
## The contract

```sh
git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff
```

The command reads `polydeukes.config.yaml` from the working directory, never calls git itself, and
never prompts. The file must exist at the project root; see
[Configure a project](./configure-project.md). Measured without a configuration file, the command
exits 2 with a line beginning `covenant check failed closed: no Polydeukes config found`, so a hook
wired before the file exists stops every commit.

Exit 0 means the run finished; by default, every covenant break is recorded as `advised`. With
`--enforce block`, exit 2 means a protected path or an entry set to `enforce: block` was broken; a
configuration that does not load also exits 2. Exit 3 means the input could not be read and nothing
was judged. Any tool that runs a command and stops on a non-zero exit code can run this check.

The judge sees only what arrives on stdin. If `git diff` itself fails, nothing arrives; an empty
diff is nothing to judge, and the command exits 0. Measured with a base ref that does not exist, the
pipeline exited 0 in bash and 128 (git's own code) with `set -o pipefail;` in front. Where the shell
supports it, put `set -o pipefail;` before the pipeline so git's failure fails the step. The
branch-against-base example in [Without a hook](#without-a-hook) shows this form.

The `git diff` flags fix the color, external diff, textconv, and path-prefix settings; see
[Pin the producer](../reference/cli/covenant-check.md#pin-the-producer). Rows are appended to
`.polydeukes/roi.log`.

The results quoted on this page come from runs in a clean Linux x64 container with the released
judge. With a staged change to a path in `protectedPaths`, the line above exited 0, created the
commit, and wrote one `advised` row. stderr contained `staged-write would modify protected path` and
the path, plus an advisory summary line. Appending `--enforce block` made `pdks` exit 2: the hook
failed, no commit was created, and one `blocked` row was written. With only unprotected files staged
and `--enforce block`, the run exited 0 and wrote one `passed` row.

<a id="without-a-hook"></a>
## Without a hook

The check needs no hook. Judge staged changes with blocking enabled:

```sh
git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff --enforce block
```

Judge the working tree against `HEAD`:

```sh
git diff --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ HEAD | pdks covenant check --diff
```

Measured with a tracked protected file changed but not staged, this exited 0 and wrote one `advised`
row. `git diff HEAD` does not list untracked files, so a new file that has not been added is not
judged by this line.

Judge a branch against its base in CI or before a pull request:

```sh
set -o pipefail; git diff --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ main...HEAD | pdks covenant check --diff --enforce block
```

Measured, this exited 2 when the branch changed a protected path and 128 when the base ref did not
exist. A CI checkout that does not fetch the base branch is the usual way to meet the second case,
so fetch the base before this step. In CI, this is an ordinary shell step that fails on a non-zero
exit code.

<a id="tools"></a>
## Hook tools

Each tool section gives the configuration, how that tool's hook is turned off, and the pattern for
it. Git's own switches and the discipline that uses the patterns are in the section after the tools.

<a id="plain-hook"></a>
### Plain git hook

**Set up.** Measured with git 2.55.0. Save this as `.git/hooks/pre-commit`:

```sh
#!/bin/sh
git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff
```

Then run `chmod +x .git/hooks/pre-commit`. If the hook file already exists, add the line to it
instead of replacing the file, and make sure its exit code becomes the hook's: a shell script exits
with the code of its last command. Measured with `--enforce block` and another command after the
line, the commit was created although the check exited 2; with `|| exit $?` appended to the line,
the commit stopped: `… | pdks covenant check --diff --enforce block || exit $?`. `.git/hooks` is not
versioned, so each clone needs the file.

**Turning it off.** A plain hook has no switch of its own;
[git's own switches](#judge-the-off-switch) apply.

<a id="lefthook"></a>
### lefthook

**Set up.** Measured with lefthook 2.2.2, installed by `npm install --save-dev lefthook`. Add this
to `lefthook.yml`:

```yaml
pre-commit:
  commands:
    covenant:
      run: git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff
```

Then run `npx lefthook install`.

**Turning it off.** Each measured case created the commit and wrote no row:

- Put `LEFTHOOK=0` or `LEFTHOOK=false` in front of `git commit`.
- Run `npx lefthook uninstall`, which removes the installed hook file.
- [Git's own switches](#judge-the-off-switch) also apply.

**Judging the off switch.** Add this pattern to the `re` of the discipline in
[Judging a command that turns the hook off](#judge-the-off-switch), joined with `|`:

```text
LEFTHOOK=(0|false)\b|lefthook\s+uninstall
```

Measured matches:

- `LEFTHOOK=0 git commit -m "msg"`
- `LEFTHOOK=false git commit -m "msg"`
- `export LEFTHOOK=0`
- `npx lefthook uninstall`

Measured non-matches:

- `git commit -m "msg"`
- `npx lefthook install`
- `LEFTHOOK=1 git commit -m "msg"`

<a id="husky"></a>
### husky

**Set up.** Measured with husky 9.1.7, installed by `npm install --save-dev husky`. Run
`npx husky init` first: it writes `.husky/pre-commit` containing `npm test`, sets `core.hooksPath`
to `.husky/_`, and adds a `prepare` script to `package.json`. Then replace the content of
`.husky/pre-commit`:

```sh
git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff
```

**Turning it off.** Measured ways to turn the hook off:

- Put `HUSKY=0` in front of `git commit`.
- [Git's own switches](#judge-the-off-switch) also apply.

**Judging the off switch.** Add this pattern to the `re` of the discipline in
[Judging a command that turns the hook off](#judge-the-off-switch), joined with `|`:

```text
HUSKY=0\b
```

Measured matches:

- `HUSKY=0 git commit -m "msg"`
- `export HUSKY=0`

Measured non-matches:

- `git commit -m "msg"`
- `HUSKY=1 git commit -m "msg"`

<a id="pre-commit"></a>
### pre-commit

**Set up.** Measured with pre-commit 4.7.0, installed by `uv tool install pre-commit`. Add this to
`.pre-commit-config.yaml`:

```yaml
repos:
  - repo: local
    hooks:
      - id: covenant
        name: pdks covenant check
        entry: sh -c 'git diff --cached --no-color --no-ext-diff --no-textconv --src-prefix=a/ --dst-prefix=b/ | pdks covenant check --diff'
        language: system
        pass_filenames: false
        always_run: true
```

Then run `pre-commit install`. pre-commit hides a hook's output when the hook succeeds, so in the
default posture the advisory lines do not appear on screen although the `advised` row is written;
adding `verbose: true` to the hook showed them.

**Turning it off.** Measured ways to turn the hook off:

- Put `SKIP=covenant` in front of `git commit`; the value is the hook `id`.
- Run `pre-commit uninstall`.
- [Git's own switches](#judge-the-off-switch) also apply.

**Judging the off switch.** Add this pattern to the `re` of the discipline in
[Judging a command that turns the hook off](#judge-the-off-switch), joined with `|`:

```text
\bSKIP=|pre-commit\s+uninstall
```

Measured matches:

- `SKIP=covenant git commit -m "msg"`
- `pre-commit uninstall`

Measured non-matches:

- `git commit -m "msg"`
- `pre-commit install`
- `pre-commit run --all-files`

<a id="judge-the-off-switch"></a>
## Judging a command that turns the hook off

Turning a hook off is your own choice in your terminal. A session discipline can record or stop the
same command when an agent runs it.

These are git's own switches and work under every tool on this page. Each measured case created the
commit and wrote no row:

- `git commit --no-verify`
- `git commit -n`, the short form
- A `core.hooksPath` that points somewhere else: `git -c core.hooksPath=<dir> commit` or
  `git config core.hooksPath <dir>`

Use this pattern for git's own switches:

```text
git\b[^|;&]*\bcommit\b[^|;&]*\s(--no-verify\b|-[a-zA-Z]*n)|(?i:core\.hooksPath)
```

```yaml
sessionDisciplines:
  - id: "hooks-stay-on"
    why: "a command that turns the commit hook off skips the change-set check."
    declare:
      mechanism: "forbidden-command"
      scope: { source: "command" }
      extract:
        hits:
          - { op: "source", of: "command" }
          - { op: "lines" }
          - {
              op: "matches",
              re: 'git\b[^|;&]*\bcommit\b[^|;&]*\s(--no-verify\b|-[a-zA-Z]*n)|(?i:core\.hooksPath)',
            }
      relate:
        - { id: "hook-runs", relation: { op: "empty", of: "hits" }, message: "{value}" }
```

This is a session discipline, so it is judged where an agent's shell command is observed (Claude
Code or Codex), not by the change-set check. Without `enforce: block`, a match is recorded as
`advised` and the command proceeds. See the
[configuration reference](../reference/configuration/index.md) for the entry syntax.

Measured matches:

- `git commit --no-verify -m "msg"`
- `git commit -n -m "msg"`
- `git commit -nm "msg"`
- `git commit -anm "msg"`
- `git -c core.hooksPath=/dev/null commit -m "msg"`
- `git config core.hooksPath .nohooks`

Measured non-matches:

- `git commit -m "msg"`
- `git commit -am "msg"`
- `git commit --amend --no-edit`
- `git commit --dry-run`
- `git clean -n`

The pattern reads the command line as text, so a commit message containing one of these spellings
can also match; the skip-option alternatives stop at `|`, `;`, or `&`, including inside a message.

To cover a tool's own switch as well, join that tool's pattern from its section above to the same
`re` with `|`.

<a id="other-tools"></a>
## Other tools

A tool not listed here works the same way: put the command from [The contract](#contract) wherever
that tool runs a command before a commit, and let it stop on a non-zero exit code. Nothing in the
judge is specific to a hook tool.

<a id="see-also"></a>
## See also

- [`pdks covenant check`](../reference/cli/covenant-check.md)
- [Configuration reference](../reference/configuration/index.md)
- [Connect the surfaces](./connect-surfaces.md)
