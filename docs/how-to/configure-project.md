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

`pdks init claude-code` adds the schema line only when the default path resolves relative to the
generated config. If the line is absent, add a relative path to the installed schema yourself.
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
| `adapters.git.enforce: advise` | Record advice and let the commit continue, without a witness prompt. |
| `adapters.git.enforce: block` | Refuse a blocking judgment; the staged path can offer a TTY witness prompt. |

An ordinary discipline also has its own level, defaulting to `advise`. **The lenient level wins.**
Setting only the adapter to `block` does not promote an ordinary entry. Protection of configured
paths is separate from that per-entry default. Assembly errors still exit 2 at either level.

Top-level `protectedPaths` applies to both surfaces. `adapters.git.protectedPaths` adds commit-only
paths. Use the latter for files that may be edited in a session but need protection when committed.
See [surface connection and witnesses](./connect-surfaces.md#witness-and-recovery).

<a id="confirm-the-project"></a>
## Confirm the project

- `pdks explain` loads the configuration and shows registrations without judging a change.
- `pdks covenant check --worktree` compares HEAD with disk, including untracked, non-ignored files.
- `pdks covenant check` observes staged changes. A blocking result can prompt only when a TTY is
  available; the command does not prompt merely because the adapter is set to `block`.

Check stderr and telemetry as well as the exit code. Advice and some skipped observations exit 0.
If assembly fails, diagnose the named configuration or missing package before testing a discipline.
