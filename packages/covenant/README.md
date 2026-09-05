# @polydeukes/covenant

**English** ·
[한국어](https://github.com/huskyhoochu/polydeukes/blob/main/packages/covenant/README.ko.md)

> Deterministic edit- and command-time blocks. A covenant is not a fence around the AI — it is a
> promise the human and the AI share, enforced by exit codes instead of etiquette.

**Alpha.** This package is already self-hosting: the repository develops itself under these
covenants (self-dogfooding since 2026-07-14), and every call they judge lands in the ROI
telemetry.

## What lives here

- **`runCovenant` wrapper** — runs a covenant body, translates its non-blocking break (`1`) into
  the blocking `2`, and logs every call — upheld, blocked, or witnessed — to the shared
  telemetry. No covenant runs unmeasured.
- **Path-routing dispatcher** — registers covenants against protected paths and runs *every*
  matching covenant (no short-circuit, so the telemetry never under-counts). Unparseable input
  blocks; unmatched input passes.
- **Self-mod meta-covenant (tool axis)** — the first real covenant: it protects the covenant
  substrate itself from editor-tool mutations. A witness seam lets a human open a judgment that
  actually blocked — always recorded as `witnessed`, never silent.
- **Shell-mod meta-covenant (Bash axis)** — a heredoc-aware, multi-line shell analyzer with
  write-detection rules (redirects, `tee`, `sed -i`) and path-segment matching that also catches
  parent-directory manipulation and quote-split paths. A command that mentions a protected path
  passes only if its leading word proves it read-only; anything unprovable fails closed.
- **TTL witness** — a sudo-style, time-boxed valve judged over the canonical transcript seam,
  consulted only after a verdict blocked: the judge always runs, and only a real block can be
  witnessed open. AI-synthesized messages do not qualify, expiry re-blocks, and every witnessed
  pass is measured as `witnessed`.
- **Standard discipline library** — config `disciplines:` entries become enforcement without a
  line of code: every judged entry is a `declare` block, an algebra declaration the engine below
  judges. Each observation is supplied as one world — a file change under its path, or a shell
  call that changes no file under the subject `-` with its command line as the fixed source
  `command`. One entry compiles into one registration: per-discipline telemetry labels, a
  generic judged body, and the same witness seam. A declaration that binds the session's
  transcript (`precedent`, `phase-order`, `turn-locality`, `stated-ground`) reads the history
  the surface injects, flattened into a plain snapshot at supply time; routing is by scope alone,
  so an admitted call runs its judge and records `passed` even when the evidence was there —
  that the gate checked at all is worth measuring.
- **Unjudgeable is a third result, not a failure** — a declaration the compiler cannot resolve
  (a step outside the registry, an argument outside a step's keys, a mechanism whose shape the
  syntax does not fit) compiles to a **skip registration** — routing intact, no body — and a
  match records one `skipped` instead of judging; a source the world lacks is the declaration's
  own `supply` policy's to dispose of. Assembly
  therefore never throws: one unresolvable entry cannot take down its siblings, both
  meta-covenants, and the witness valve, which would leave no way to fix the config that caused
  it. A configuration fault names itself on stderr; an absent session stays quiet.
- **Declaration engine** — `compileDeclaration` · `judgeDeclaration` · `witnessOpens` run an
  algebra declaration (`@polydeukes/core`'s `AlgebraDeclaration`) over a `World` value: named
  extract pipelines over a registry of unary steps and three binary combinators, then the
  seven relations, each answering a witness list rather than a boolean. The engine reads
  nothing but the `World` it is handed — no files, no process, no session — and a step name
  outside the registry is a config fault returned at compile time, never a throw.
  `worldsFromInput` is the live supply: one world per file change, under the source names
  `target.path`, `pre`, `post`, `state`, and `changes` (the observation's change set — the
  input's own, or the host's `world.changes` when it observes more than it dispatches). A
  declaration's `sources` bindings join each world from the change's own `post` when the input
  changes that file, from `world.files` otherwise — a channel binding from
  `world.channels`, which no change can overlap (a channel has no path), and a transcript
  binding from the `CanonicalTranscript` the root injects, flattened once into a plain session
  snapshot (`observedAtMs`, user turns, tool calls, each with its observation ordinal) that the
  five history steps read; no session means the key is absent and the declaration's `supply`
  policy answers.
- **Supply layer** — `planSources` folds the registrations' `sources` bindings into one
  deduplicated path list plus the channel kinds they name, and `supplySources` fills both
  through the readers a composition root injects (`read(path)` and the optional
  `readChannel(kind)` answer `undefined` for an absence and throw for any other failure; a
  root with no session injects no channel reader, and every channel is absent there).
  Neither opens a file: how a surface observes the tree — disk, index, or a commit —
  belongs to the supply body the root wires in, and the result reaches `dispatchCovenants`
  as `world`.

## Design stance

No blocklists. Enumerating bypass patterns is always one step behind, so the logic is inverted: a
mention of a protected path blocks unless proven safe. Complete containment is a non-goal —
residual vectors such as indirect path computation are telemetry targets, not block targets. The
friction valves are the read-only allowlist and the TTL witness, and both leave a measurable
trace.

See the [project repository](https://github.com/huskyhoochu/polydeukes) for the architecture
blueprint and design rationale.

## License

MIT
