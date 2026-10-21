# Troubleshooting Polydeukes

**English** · [한국어](./troubleshooting.ko.md)

Diagnose the failed stage before changing policy. If a session blocks the repair command itself,
run the repair from your own terminal. `pdks docs` remains usable without project configuration
or the judging packages, provided its own installed documentation bundle is intact.

<a id="no-config"></a>
## No config found

Commands that need configuration exit 2 when none of `polydeukes.config.yaml`,
`polydeukes.config.yml`, or `polydeukes.config.json` exists directly at the project root.
Restore the intended file from Git, or use `pdks init` / `pdks adapter claude-code init` /
`pdks adapter grok init` / `pdks adapter codex init` for a new project. Then run `pdks explain`. No
configuration means no silent default policy.

<a id="multiple-config"></a>
## More than one config file

An ambiguity error names the competing files. Merge their intended contents and retain exactly
one accepted filename. The loader will not choose one on your behalf. Retry `pdks explain`.

<a id="invalid-config"></a>
## Invalid config

Parsing or schema failures exit 2 and name the file; schema errors also identify the offending
field. Repair invalid YAML, custom tags, or unknown fields.
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

- After `pdks adapter grok init`, reload the Hooks tab or start a new session. Verify an actual call
  and
  its telemetry; a successful installer run does not prove the open host loaded the hook.
- Grok's ACP history does not supply the Claude-format human message required by the current
  session witness valve. Reloading does not add that capability. Perform a necessary repair
  from your own terminal rather than trying to send a Claude witness token through Grok.

The change-set surface has no witness prompt and cannot release a blocked Grok tool call.

<a id="codex-witness"></a>
## Codex witness

Approve the registration through `/hooks`, then verify an actual call and its telemetry. Trust is
tied to the definition hash, so moving paths may require approval again. Current `UserPromptSubmit`
events do not establish human provenance: sending a token cannot open the witness valve.
`PostToolUse` evidence is isolated by session and subagent and removed at `SessionEnd`. The unstable
transcript file is never read. Perform necessary protected changes from your own terminal.

<a id="config-fault"></a>
## Config-fault

A declaration that cannot compile into a judgment makes the configuration invalid: an
unregistered extraction step, a step argument the step does not take or of the wrong type, a
pipeline that begins with neither `source` nor a combinator, or a before/after pair where a
single extraction belongs. Loading fails as described in [Invalid config](#invalid-config), and
the message names the entry, the pipeline or relate entry, and the reason. Fix the named
declaration and run `pdks explain` again.

<a id="judge-cannot-be-loaded"></a>
## The judge cannot be started

Check that `pdks` exists and is executable at the registered absolute path. If the executable or
project moved, run `pdks adapter <host> init` from your own terminal at the new location and check
host trust again. The single executable contains the judge and all three adapters. A source checkout
using npm packages needs its dependencies and complete workspace build restored.

A failure before the hook starts may leave no telemetry. A started hook with invalid input sends
`--input-failure` to the shared judge, producing one diagnostic and one `blocked covenant-check`
row. Stdin EOF and child communication each have a 10-second internal deadline. Host trust,
disabling, and timeout handling are separate: check both actual refusal and telemetry.

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

When the valve could have opened a blocked call and did not, the block's last line says why.
`no witness is configured` names the config file to add `witness: { token, ttlMinutes }` to; until
then no message can open the block. `a person can open this for <n> minutes` means the valve is
configured and no token message is within its window; when it adds `the last witness expired at
<time>`, the token was sent and its window has passed, so it must be sent again. The line never
contains the token.

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
A clone without them does not reconstruct prior judgments. The memory query log
`.polydeukes/memory-log.jsonl` is local state too: the memory index can be rebuilt from the
documents, but the log of what queries returned cannot. The session hook records an absent
or invalid baseline and establishes one for subsequent comparisons; this is not proof that old
changes were judged. Preserve needed logs separately when migrating, and check any custom
`telemetry.logPath` rather than assuming `.polydeukes/` holds all records.

<a id="next-steps"></a>
## Next steps

- [Connect the surfaces](./how-to/connect-surfaces.md)
- [Configure the project](./how-to/configure-project.md)
- [Write disciplines](./how-to/write-disciplines.md)
