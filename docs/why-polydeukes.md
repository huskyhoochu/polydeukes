# Why Polydeukes?

**English** · [한국어](./why-polydeukes.ko.md)

Polydeukes is a development **discipline framework** for people working with an AI coding
partner, or applying the same practices to their own commits. It makes selected promises
explicit, judges the evidence a connected surface can observe, and records what happened.
Its purpose is to reduce the supervision needed to verify work, not to claim that every action
is visible or every generated change is correct.

## The problem is unverifiable completion

An agent saying “done, tests pass” is not the same as evidence that the relevant tests ran.
A prompt can describe a good practice, but the instruction alone does not show whether it was
followed. A useful development system must distinguish a passing check, a detected violation,
a check that could not run, and work that never entered its observation boundary.

This distinction came from developing Polydeukes itself. A file edit could be refused while a
script produced the same contents outside the observed tool path. A supposedly safe test probe
could miss routing entirely. An overly broad path comparison could reject legitimate operations.
These were different defects, not interchangeable examples of a successful block.

The response is to make narrower, testable claims: which path was observed, what evidence was
available, which comparison ran, and which result was recorded. More blocking is not necessarily
better verification.

## What exists now

Five packages provide a shared input vocabulary, a judge, Claude Code and Git adapters, and the
`polydeukes` umbrella with the `pdks` command. Two observation surfaces serve different purposes:

- The **session surface** judges supported tool calls before execution. Claude Code and Grok have
  installers, but their available history and witness capabilities differ.
- The **commit surface** judges staged changes, the working tree, or a revision range. It works
  without an AI agent. A project may connect either or both surfaces according to its needs.

A discipline is configuration data with extraction steps and relations. Seven relations and
eighteen mechanism names form the current vocabulary; `delegated-scope` is reserved rather than
usable. The mechanism restricts a declaration's shape, while the surface determines which evidence
it can supply. An `added-only` declaration can tolerate existing matches; this is not the behavior
of every discipline. A pairing declaration, for example, compares the selected key sets.

See [how judgment works](./concepts/judgment.md), [write
disciplines](./how-to/write-disciplines.md),
and the [configuration reference](./reference/configuration/index.md).

## Principles and their limits

### Shared covenants

A covenant is a promise the developer accepts too, not a restriction imposed only on an AI.
Configured protection applies to the observed action, regardless of who initiated it. It does not
prevent every possible edit outside connected surfaces. Protecting the discovered config file is
a built-in behavior; protecting other source files depends on the configured paths.

A human witness can allow a blocking judgment without rewriting the policy. In a supported session,
the token must stand alone on the first line of a human message and remain within its TTL. A staged
commit uses a TTY prompt instead. Both consult the valve after judgment. Neither repairs a broken
assembly, and a commit answer cannot authorize a pending session call.

### Deterministic judgment, explicit enforcement

The judge evaluates supplied data without opening files or making network requests. Reproducing
a verdict requires the same declaration and supplied evidence, not merely the same path name.
The two surfaces need not produce the same result when their observations differ.

An ordinary discipline defaults to `advise`. Promotion to `block` is the author's decision after
exercising both valid and violating cases. A surface's level and an entry's level compose with the
lenient side winning. Assembly errors remain failures; telemetry write failures do not change a
verdict. Missing evidence follows the declared supply policy rather than an invented empty source.

### Evidence with a stated boundary

`passed`, `blocked`, `witnessed`, `advised`, and `skipped` describe judgment outcomes.
`unattributed` records a baseline finding, not a verdict. An empty observation, a skipped
registration, or a successful command exit is not proof that the whole project meets its promises.

Arbitrary child-process writes are not individually observed as session tool calls. Baseline
comparison can reveal unexplained protected changes afterward, but cannot reconstruct the missing
judgment. Logs and baseline files are local state; a Git clone does not transfer the history.
Instructions read by an agent are also not proof that a host invokes the installed hook.

## What the measurements say

These are historical observations from this repository, not a benchmark of other projects or a
measurement of the current release. The dated [development posts](./build-in-public/) retain the
circumstances and terminology of their periods.

| Period | Recorded observations |
|---|---|
| First self-use ticket | 133 rows: 75 passes, 2 blocks, 56 valve openings. |
| v0.1 milestone | 1,020 verdicts across three tickets: 455 passes, 13 blocks, 552 valve openings. The milestone audit also found five path-matching escapes to repair. |
| Five rounds before the advisory-default decision | No measured case of a real-time block preventing a bad edit; 93% of human valve openings concerned repairs to the judging chain. These are findings within those rounds, not proof that blocking is always useless. |
| Through 2026-08-26, five weeks | 7,446 rows: 6,438 `passed`, 686 `skipped`, 173 `blocked`, 88 `advised`, 47 `unattributed`, 14 `witnessed`. |
| v0.5.0 advisory round | 73 of 735 advised rows, or 9.9%, had a later pass on the same target in the same session. One read-first discipline reached 77%; another reached 0% across 292 rows. |
| v0.5.0 blocking observations | 88% of 162 blocks protected the judging chain; no false-block reports were filed. An assembly failure refused and recorded eight calls in 71 seconds. |

The advisory denominator counts calls, not independent decisions. An ignored advisory may recur.
A later pass is the measurement's operational definition of consumption, not proof that advice
caused improvement. No false-block reports is not proof that no false blocks occurred.

There is also selection bias: an agent may reshape a call before submitting it to avoid a predicted
refusal. In the project's interpretation, `passed` is an upper bound on compliance and `blocked`
a lower bound on intended violations. Neither count measures unsubmitted actions. The earlier
aspiration of “90-plus” predictability is a design goal, not an achieved rate.

The measurements motivated advice by default, a time-limited witness, and more explicit observation
records. They do not establish that the current delivery of advice is sufficient. In the recorded
host probe, stderr advice did not reach the model; the generated skill therefore asks the agent to
read telemetry at task boundaries. Host behavior must be checked rather than assumed.

<a id="decisions-the-measurements-forced"></a>
### Decisions the measurements forced

Four incidents changed a mechanism rather than a number. They are listed here because the
current design is hard to explain without them.

- **A banned word that edits respected and a shell heredoc did not.** The tool axis refused
  an edit carrying a banned word. The same content inside a heredoc reached the repository
  without a row, because the call never reached judgment. The shell axis gained
  heredoc-aware analysis and write detection for redirects (development post #1).
- **A token that opened the valve from the middle of a sentence.** The witness token was
  matched anywhere in a human message, so asking when the witness would expire extended the
  window. The rule became first line, alone (development post #2).
- **A request accepted as evidence.** The first `precedent` judgment counted a call that had
  merely been issued, so `echo "npm view yaml"` satisfied it more cheaply than running the
  check. Evidence now means a call that ran and reported success.
- **One file protected through its ancestors.** Protecting a single path by ancestry made the
  whole home directory protected; `cd` into it was refused for two weeks before anyone
  noticed. That path is now judged by full-path equality, and anything above the project
  root is out of scope.

## What remains a plan

A verifiable **ledger**, searchable local **memory**, and adversarial **verification** are roadmap
components, not shipped services. Telemetry is not the future ledger, documentation search is not
a memory system, and running a test suite is not an implemented adversarial review service.

Polydeukes is not an agent runtime or a sandbox. It complements linters and tests: some declarations
compare file contents, others require observed process evidence. It does not execute a fresh
benchmark during judgment or prove that a natural-language explanation is true.

The name's story is in [STORY.md](../STORY.md). To try the implemented system, follow
[the first-judgment tutorial](./tutorials/first-judgment.md). For current limits and recovery, see
[troubleshooting](./troubleshooting.md). The project remains alpha; its claims should be read with
those limits, not as a promise of complete supervision-free development.
