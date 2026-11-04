# Configure the project

**English** · [한국어](./configure-project.ko.md)

Keep one configuration file at the project root and choose how violations should affect work. Start
with the [first-judgment tutorial](../tutorials/first-judgment.md) if the package is not installed
yet.

<a id="find-the-config"></a>
## Find the config file

Polydeukes reads exactly one of `polydeukes.config.yaml`, `polydeukes.config.yml`, or
`polydeukes.config.json` directly under the project root. It does not search parent directories.

- With no file, commands that need configuration fail rather than silently use defaults.
- With several files, merge the intended content and keep only one.
- The discovered file automatically joins `protectedPaths`, so changing the configuration itself is
  subject to protection.

`pdks docs` does not need project configuration. Consult the
[configuration
reference](../reference/configuration/index.md)
for exact field constraints.

<a id="add-ide-support"></a>
## Connect an editor schema

Use the repository's [configuration schema](../../schema/polydeukes.schema.json) from the same
release as your executable. If you copy the schema into your project, name its path relative to the
configuration file:

```yaml
# yaml-language-server: $schema=./schema/polydeukes.schema.json
```

This example assumes you copied `schema/polydeukes.schema.json`. `pdks init` does not install the
schema or add this comment. Verify the path in your editor and run `pdks explain` to validate with
the actual judge. A JSON configuration's `$schema` property is not used for judgment.

<a id="choose-advise-or-block"></a>
## Choose advise or block

| Setting                                   | Effect on a violation                           |
| ----------------------------------------- | ----------------------------------------------- |
| `enforce: advise` on an entry (or absent) | Record advice and let the call proceed, exit 0. |
| `enforce: block` on an entry              | Refuse the judged call, exit 2.                 |

**Absent means `advise`.** There is no surface-level enforcement key in the config: each entry
carries its own level and nothing promotes an absent one. Protection of configured paths is separate
from that per-entry default — it blocks on the session surface, and on the change-set surface it
lands `advised` unless the command is run with `--enforce block`. Assembly errors still exit 2.

`protectedPaths` is a single top-level list that applies to both surfaces. On the change-set surface
the judge only emits the exit code; whether the commit stops is your hook wiring. See
[surface
connection and witnesses](./connect-surfaces.md#witness-and-recovery).

<a id="confirm-the-project"></a>
## Confirm the project

- `pdks explain` loads the configuration and shows registrations without judging a change.
- `git diff HEAD | pdks covenant check --diff` judges everything not yet committed.
- `git diff --cached | pdks covenant check --diff` observes staged changes — the pre-commit shape.
  The command never prompts; it exits 0, 2, or 3 (an input it could not read) and your hook wiring
  decides the commit's fate.

Check stderr and telemetry as well as the exit code. Advice and some skipped observations exit 0. If
assembly fails, diagnose the named configuration or missing package before testing a discipline.
