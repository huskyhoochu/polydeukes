# Move an existing installation to Rust

**English** · [한국어](./migrate-to-rust.ko.md)

Use this checklist when upgrading from the Node judge or the earlier all-in-one executable. Do the
configuration and hook edits from your own terminal, then open a fresh agent session.

<a id="inventory"></a>
## Record the installation you have

Record `pdks --version`, the executable path, and your current configuration and host settings. Keep
a copy before editing. The main executable now supplies `covenant check`, `init`, `explain`, and
`docs`; install Claude Code, Codex, and memory separately using the
[installation
guide](./install.md).

<a id="configuration"></a>
## Update configuration and commands

| Earlier interface                                | Current interface                                                 |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `pdks adapter claude-code init`                  | `pdks-claude-code init` or `pdks claude-code init`                |
| `pdks adapter codex init`                        | `pdks-codex init` or `pdks codex init`                            |
| `pdks memory ingest`                             | Run search/show directly; each command reads current Markdown     |
| `languages` configuration                        | Remove the key; the Rust configuration does not accept it         |
| Schemas under installed `@polydeukes/core`       | Use the repository's versioned `schema/` files for editor support |
| `pdks-linux-x64` / `pdks-darwin-arm64` downloads | Executable-specific target archives; see installation             |

`pdks init` creates project configuration and the telemetry ignore entry. Host-specific protection
and hook registration are provided by the adapter's init. Generated configuration does not add a
YAML language-server schema comment. Check your editor's schema path separately.

<a id="hooks"></a>
## Replace old hook registrations

Inspect `.claude/settings.json` or `.codex/hooks.json`. Remove the old Polydeukes handler entries,
including obsolete Node or `.mjs` delegators, while preserving other tools' handlers and settings.
Rust init adds or updates its current registrations; it does not clean up the old TypeScript
handlers or generated `.mjs` files. Remove a delegator file only after confirming no remaining
handler uses it.

Run the chosen adapter's init from the project root. Inspect the resulting executable and root
paths. New registrations carry neither `onFailure` nor `|| exit 2`. Reopen Claude Code, or approve
the Codex definition through `/hooks`, then make an ordinary call and confirm a new telemetry row.
Use the [direct probes](../tutorials/first-judgment.md) to check the judge separately from host
loading.

<a id="behavior"></a>
## Recheck observations your disciplines depend on

Shell protection conservatively considers protected-path mentions. A shell write can lack the file
contents needed by a content discipline and produce `skipped` with `no-observation`; check the
finished diff as well. Codex records tool history but does not establish human messages, so a
witness token in its prompt cannot open a protected edit. Claude Code requires human provenance in
the transcript; an SDK-originated session may not supply it. Use your terminal for protected edits
when the host has no human channel.

Memory keeps no index file and needs no ingest step. Search JSON has `results` and no `ingestedAt`.
Update consumers of the earlier SDK ingest verb to call search directly; the TypeScript SDK needs
Node 24 or newer. SDKs invoke the executable process, and their current contracts are in the
[SDK
references](../README.md#reference-packages).

<a id="verify"></a>
## Confirm the migration

```sh
pdks --version
pdks explain
git diff HEAD | pdks covenant check --diff
pdks memory search configuration
```

The last command requires memory installation and a configured document corpus. Check stderr and
telemetry, not just exit 0: advice and skipped observations also return success. If the executable
cannot start, repair its installation or path before retrying the host. See
[troubleshooting](../troubleshooting.md).
