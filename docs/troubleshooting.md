# Troubleshooting Polydeukes

**English** · [한국어](./troubleshooting.ko.md)

Diagnose the failed stage before changing policy. If a session blocks the repair command itself,
run the repair from your own terminal. `pdks docs` remains usable without project configuration
or the judging packages, provided its own installed documentation bundle is intact.

<a id="no-config"></a>
## No config found

Commands that need configuration exit 2 when none of `polydeukes.config.yaml`,
`polydeukes.config.yml`, or `polydeukes.config.json` exists directly at the project root.
Restore the intended file from Git, or use `pdks init claude-code` / `pdks init grok` for a new
project. Then run `pdks explain`. No configuration means no silent default policy.

<a id="multiple-config"></a>
## More than one config file

An ambiguity error names the competing files. Merge their intended contents and retain exactly
one accepted filename. The loader will not choose one on your behalf. Retry `pdks explain`.

<a id="invalid-config"></a>
## Invalid config

Parsing or schema failures exit 2 and name the file; schema errors also identify the offending
field. Repair invalid YAML, custom tags, unknown fields, or an empty `languages` object.
Custom YAML tags are rejected even if the parser cannot execute them: configuration is data.

Typos such as `protectedPath:` or `adaptors:` are refused. Adapter namespace names are deliberately
open, however: `adapters.gti:` can load but is not read by the Git adapter. Its actual key is
`adapters.git`. After repair, run `pdks explain` and check the assembled registrations.

<a id="grok-witness"></a>
## Grok witness

A hook not yet loaded and an unavailable witness valve are different problems:

- After `pdks init grok`, reload the Hooks tab or start a new session. Verify an actual call and
  its telemetry; a successful installer run does not prove the open host loaded the hook.
- Grok's ACP history does not supply the Claude-format human message required by the current
  session witness valve. Reloading does not add that capability. Perform a necessary repair
  from your own terminal rather than trying to send a Claude witness token through Grok.

A commit witness authorizes its staged check only. It cannot release a blocked Grok tool call.

<a id="config-fault"></a>
## Config-fault

The configuration loaded, but an entry could not compile into a judgment. A matching registration
records `skipped` with `config-fault`; `pdks explain` shows the fault. Check extraction step names,
arguments, regex syntax, and paired versus single extraction use. Fix the named declaration and
repeat the same observation. A skipped entry is not a passing one.

<a id="judge-cannot-be-loaded"></a>
## The judge cannot be loaded

A missing package or judging module fails closed. Reinstall the package or run the complete
workspace build from your own terminal. The generated hook delegates to the installed package;
it is not an independent copy of the judge. Verify another real call after repair. A failure
before telemetry can load may leave no row at all.

The session hook prefixes the message with `covenant hook failed closed:` and the commit check
with `covenant check failed closed:`. The two shapes you will see:

```text
covenant hook failed closed: Cannot find package 'polydeukes' imported from …
covenant check failed closed: the covenant judges could not be loaded from … — run 'pnpm build' to rebuild them: Cannot find module './self-mod.js' …
```

The first is the installed package missing; the second is a source checkout whose judge
build output is missing or partial.

<a id="reading-verdict"></a>
## Reading a verdict

| Record | Meaning |
|---|---|
| `passed` | The observed input was judged and upheld the covenant. |
| `blocked` | A violation stopped the operation. |
| `witnessed` | A blocking result was allowed through its witness valve. |
| `advised` | A violation was recorded without stopping the operation, on either surface. |
| `skipped` | No judgment was possible for the matching registration. This is not a pass. |
| `unattributed` | Baseline comparison found protected changes without an explaining judgment, or could not read a valid baseline. This is an observation, not a verdict. |

Judgments append telemetry at `.polydeukes/roi.log` unless `telemetry.logPath` changes the location.
Logging is fail-open: a write failure does not alter the verdict. Exit 0 means the operation may
continue, not that every discipline passed.

<a id="opening-a-blocked-call"></a>
## Opening a blocked call

In a supported Claude Code session, type the configured witness token alone on the first line
of a human message, then retry within its configured TTL. The message may also precede an
intentional protected edit; no previous failed attempt is required. The token is not a secret.
The valve checks human provenance and applies only to a blocking judgment. A successful retry
appends a `witnessed` row; it does not rewrite the earlier blocked row.

A witness cannot repair missing modules or other failures that prevent judgment assembly.

<a id="blocked-commit"></a>
## A blocked commit

Run the commit from your own terminal and answer its TTY prompt with the complete configured
token. A non-interactive staged check cannot obtain that answer. The check exits 2 when it refuses;
Git may report a different nonzero exit code for the failed commit.

A normal entry blocks only when its own level and the adapter's level both permit blocking.
Setting only `adapters.git.enforce: block` does not promote default-`advise` entries. Changing a
level is a policy decision, not a required repair. The prompt is separate from a session message.

<a id="skipped-rows-on-the-commit-surface"></a>
## `skipped` rows on the commit surface

A transcript-reading declaration with `supply: { session: 'pass' }` records `supply-pass` when the
commit surface has no session. Use the session surface for that promise; a skip does not verify
history. Other unavailable channels can produce `no-observation`. Inspect the registration and
reason instead of treating every missing source as the same failure.

A command-scoped declaration does not match a staged diff's absent command line and records no
judgment there. Configuration, scope matching, supply, and the final comparison are separate steps.

<a id="local-state"></a>
## Moving a project between machines

Telemetry and `.polydeukes/baseline.json` are local state, not a portable history supplied by Git.
A clone without them does not reconstruct prior judgments. The session hook records an absent
or invalid baseline and establishes one for subsequent comparisons; this is not proof that old
changes were judged. Preserve needed logs separately when migrating, and check any custom
`telemetry.logPath` rather than assuming `.polydeukes/` holds all records.

<a id="next-steps"></a>
## Next steps

- [Connect the surfaces](./how-to/connect-surfaces.md)
- [Configure the project](./how-to/configure-project.md)
- [Write disciplines](./how-to/write-disciplines.md)
