# Configure the project

**English** · [한국어](./configure-project.ko.md)

Keep one configuration file at the project root, define the production files and verification
command, and choose how violations should affect work. Start with the
[first-judgment tutorial](../tutorials/first-judgment.md) if the package is not installed yet.

<a id="find-the-config"></a>
## Find the config file

Polydeukes reads exactly one of `polydeukes.config.yaml`, `polydeukes.config.yml`, or
`polydeukes.config.json` directly under the project root. It does not search parent directories.

- With no file, commands that need configuration fail rather than silently use defaults.
- With several files, merge the intended content and keep only one.
- The discovered file automatically joins `protectedPaths`, so changing the configuration itself
  is subject to protection.

`pdks docs` does not need project configuration. Consult the
[configuration reference](../reference/configuration/index.md) for exact field constraints.

<a id="add-ide-support"></a>
## Add IDE support

For YAML, add this line so the editor can use the installed schema:

```yaml
# yaml-language-server: $schema=node_modules/polydeukes/dist/schema/polydeukes.schema.json
```

The path is relative to the configuration file, not a module specifier. When the config sits in a
monorepo sub-package whose dependencies installed at the workspace root, count the levels up:

```yaml
# yaml-language-server: $schema=../../node_modules/polydeukes/dist/schema/polydeukes.schema.json
```

`pdks init` — which `pdks-claude-code init` runs for you — adds the schema line only when the
default path resolves relative to the generated config. If the line is absent, add a relative path
to the installed schema yourself.
An unresolvable `$schema` can disable editor validation without displaying an error.

If you installed `@polydeukes/core` directly rather than the umbrella, name its copy:

```yaml
# yaml-language-server: $schema=node_modules/@polydeukes/core/schema/polydeukes.schema.json
```

That is a file path an editor reads statically. Code that reads the schema at runtime uses the
exports subpath `@polydeukes/core/schema.json` instead. JSON configurations can use a `$schema`
property; the loader accepts it but leaves it out of the resolved configuration.

<a id="fill-the-language-block"></a>
## Fill the language block

`languages` must contain at least one entry. Each entry specifies production paths and a
verification command:

```yaml
languages:
  typescript:
    productionGlob: 'src/**'
    testCmd: 'pnpm test'
```

Language names are project-defined keys. Replace the installer's placeholder with meaningful
paths and a command; deleting the block or leaving it empty makes the configuration invalid.
Loading this setting does not itself run the command.

<a id="choose-advise-or-block"></a>
## Choose advise or block

| Setting | Effect on a violation |
|---|---|
| `enforce: advise` on an entry (or absent) | Record advice and let the call proceed, exit 0. |
| `enforce: block` on an entry | Refuse the judged call, exit 2. |

**Absent means `advise`.** There is no surface-level enforcement key in the config: each entry
carries its own level and nothing promotes an absent one. Protection of configured paths is
separate from that per-entry default — it blocks on the session surface, and on the commit
surface it lands `advised` unless the command is run with `--enforce block`. Assembly errors
still exit 2.

`protectedPaths` is a single top-level list that applies to both surfaces. On the commit surface
the judge only emits the exit code; whether the commit stops is your hook wiring.
See [surface connection and witnesses](./connect-surfaces.md#witness-and-recovery).

<a id="confirm-the-project"></a>
## Confirm the project

- `pdks explain` loads the configuration and shows registrations without judging a change.
- `git diff HEAD | pdks covenant check --diff` judges everything not yet committed.
- `git diff --cached | pdks covenant check --diff` observes staged changes — the pre-commit shape.
  The command never prompts; it exits 0 or 2 and your hook wiring decides the commit's fate.

Check stderr and telemetry as well as the exit code. Advice and some skipped observations exit 0.
If assembly fails, diagnose the named configuration or missing package before testing a discipline.
