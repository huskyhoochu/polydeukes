# Troubleshooting Polydeukes

**English** · [한국어](./troubleshooting.ko.md)

Diagnose the failed stage before changing policy. If a session blocks the repair command itself,
run the repair from your own terminal. `pdks docs` remains usable without project configuration
or the judging packages, provided its own installed documentation bundle is intact.

<a id="no-config"></a>
## No config found

Commands that need configuration exit 2 when none of `polydeukes.config.yaml`,
`polydeukes.config.yml`, or `polydeukes.config.json` exists directly at the project root.
Restore the intended file from Git, or use `pdks init` / `pdks-claude-code init` /
`pdks-grok init` / `pdks-codex init` for a new project. Then run `pdks explain`. No
configuration means no silent default policy.

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
open, however: a namespace nobody implements loads without being read by anything. After repair,
run `pdks explain` and check the assembled registrations.

Inside a session the repair itself is not locked out. While the config does not load, every
call fails closed except one: an Edit or Write whose only target is the config file, whose
starting text is the file as it is on disk, and whose result loads. That call passes with exit
0 and one `advised` row under the `covenant-check` label, written to the repaired config's own
`telemetry.logPath`, and the stderr line names the fault it repaired. The pass does not read
the `--enforce` posture: the session hook always runs with `--enforce block`, and a repair that
blocked under it would never run anywhere. A rewrite that still does not load is blocked like
any other call, and so is a call that touches the config together with another file, or one
whose evidence does not start from the bytes on disk. The change-set surface has no such path:
a commit that repairs the config is a human's commit, made from a terminal that can see the
error.

<a id="grok-witness"></a>
## Grok witness

A hook not yet loaded and an unavailable witness valve are different problems:

- After `pdks-grok init`, reload the Hooks tab or start a new session. Verify an actual call and
  its telemetry; a successful installer run does not prove the open host loaded the hook.
- Grok's ACP history does not supply the Claude-format human message required by the current
  session witness valve. Reloading does not add that capability. Perform a necessary repair
  from your own terminal rather than trying to send a Claude witness token through Grok.

A commit witness authorizes its staged check only. It cannot release a blocked Grok tool call.

<a id="codex-witness"></a>
## Codex witness

The same two problems are distinct here, and the first has its own cause:

- After `pdks-codex init`, hook trust is bound to the hash of the hook definition. A changed
  `.codex/hooks.json` is not trusted until you approve it through `/hooks`, so an installer that
  succeeded can still leave no hook running. Verify an actual call and its telemetry.
- Codex names a transcript path but documents the format as unstable, so no judgment reads it.
  The adapter records `UserPromptSubmit` and `PostToolUse` into its own session evidence file
  and removes it at `SessionEnd`; the IR carries that `session` without synthesizing `actor`.
- After an intentional block, send the configured witness token alone on the first line and
  retry. If stderr says no `UserPromptSubmit` evidence was recorded, confirm all four lifecycle
  entries are approved. If evidence is still unavailable, perform the repair from your own
  terminal; repeating the token cannot release an unobserved call.

A commit witness authorizes only its staged check; it does not substitute for the Codex session
witness.

<a id="config-fault"></a>
## Config-fault

A declaration that cannot compile into a judgment makes the configuration invalid: an
unregistered extraction step, a step argument the step does not take or of the wrong type, a
pipeline that begins with neither `source` nor a combinator, or a before/after pair where a
single extraction belongs. Loading fails as described in [Invalid config](#invalid-config), and
the message names the entry, the pipeline or relate entry, and the reason. Fix the named
declaration and run `pdks explain` again.

<a id="judge-cannot-be-loaded"></a>
## The judge cannot be loaded

A missing package or judging module fails closed. Reinstall the package or run the complete
workspace build from your own terminal. The generated hook delegates to the installed package;
it is not an independent copy of the judge. Verify another real call after repair. A failure
before telemetry can load may leave no row at all.

A failure the judge itself refuses — a missing or invalid config, an unbuilt judge — carries
`covenant check failed closed:` on both surfaces, because the hook delegates to
`pdks covenant check` and passes its message through. Only a failure *before* the judge could be
spawned — the adapter cannot find `polydeukes`, or the child exited without a verdict — carries
`covenant hook failed closed:`. The two shapes you will see:

```text
covenant hook failed closed: Cannot find package 'polydeukes' imported from …
covenant check failed closed: the covenant judges could not be loaded from … — run 'pnpm build' to rebuild them: Cannot find module './self-mod.js' …
covenant check failed closed: invalid config in polydeukes.config.yaml: … — fix polydeukes.config.yaml in one Edit or Write whose result loads; every other call stays blocked until it does
```

The first is the installed package missing; the second is a source checkout whose judge
build output is missing or partial; the third is a config that does not load, on the session
surface, where the line names the one call that would repair it.

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

The change-set surface does not prompt. By default it exits 0 on every verdict and records the
break as `advised`; it exits 2 only when the check runs with `--enforce block` (a protected
path or an entry set to `enforce: block` broke) or when it could not judge at all. Whether the
commit stops is your hook wiring — a hook that honours the exit code stops it, one that ignores
it does not. Git may report a different nonzero exit code for the failed commit.

A normal entry blocks only when it declares `enforce: block` and the check runs with
`--enforce block`; nothing in the config promotes a default-`advise` entry. Changing a level is
a policy decision, not a required repair. To let a judged break through, drop `--enforce block`
from the hook command rather than editing the config — the row is still written.

<a id="skipped-rows-on-the-change-set-surface"></a>
## `skipped` rows on the change-set surface

The change-set surface compiles `disciplines` and `changeSetDisciplines`.
Transcript- and command-reading entries belong in `sessionDisciplines` and are not compiled
for a diff. Putting either kind in a shared or change-set list causes a configuration error.

A change-set entry can record `supply-pass` when a source it reads is absent and its `supply`
policy is `pass`. Check `pdks explain`
and the log's reason field. A skip does not establish that the discipline was upheld.

On the session surface, a transcript-reading entry can use `supply: { session: 'pass' }`
when a host supplies no session history. See the [three discipline
lists](./reference/configuration/index.md#three-lists).

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
