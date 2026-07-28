# @polydeukes/covenant

**English** · [한국어](./README.ko.md)

> Deterministic edit- and command-time blocks. A covenant is not a fence around the AI — it is a promise the human and the AI share, enforced by exit codes instead of etiquette.

**Pre-alpha.** Not yet published to npm. This package is already self-hosting: the repository develops itself under these covenants (self-dogfooding since 2026-07-14), and every call they judge lands in the ROI telemetry.

## What lives here

- **`runCovenant` wrapper** — runs a covenant body, translates its non-blocking break (`1`) into the blocking `2`, and logs every call — upheld, blocked, or witnessed — to the shared telemetry. No covenant runs unmeasured.
- **Path-routing dispatcher** — registers covenants against protected paths and runs *every* matching covenant (no short-circuit, so the telemetry never under-counts). Unparseable input blocks; unmatched input passes.
- **Self-mod meta-covenant (tool axis)** — the first real covenant: it protects the covenant substrate itself from editor-tool mutations. A witness seam lets a human open a judgment that actually blocked — always recorded as `witnessed`, never silent.
- **Shell-mod meta-covenant (Bash axis)** — a heredoc-aware, multi-line shell analyzer with write-detection rules (redirects, `tee`, `sed -i`) and path-segment matching that also catches parent-directory manipulation and quote-split paths. A command that mentions a protected path passes only if its leading word proves it read-only; anything unprovable fails closed.
- **TTL witness** — a sudo-style, time-boxed valve judged over the canonical transcript seam, consulted only after a verdict blocked: the judge always runs, and only a real block can be witnessed open. AI-synthesized messages do not qualify, expiry re-blocks, and every witnessed pass is measured as `witnessed`.
- **Delta layer** — pure new-violation-only judgment over a file's before/after pair: pre-existing debt is forgiven, and only the matches an edit adds break the covenant. This is the execution base the standard discipline library's `forbid` predicate builds on.
- **Standard discipline library** — config `disciplines:` entries become enforcement without a line of code: `forbid` (delta family — new occurrences only), `immutable` (path family — modification blocks, creation passes), `forbidCommand` (command family — a content predicate that routes commands mentioning *no* protected path, closing the path-mention routing gap), and `requirePrecedent` (context family — see below). One entry compiles into one registration: per-discipline telemetry labels, a generic judged body, and the same witness seam.
- **Context family (`requirePrecedent`)** — the one predicate whose subject is not the mutation but the *session history*: the change itself is legitimate, and what breaks the covenant is arriving without the procedure that should have preceded it. Evidence is evaluated at assembly time and carried into the body as an argv flag — a spawned body holds no transcript, and handing it a transcript path would leak adapter knowledge into the covenant package. The compiler evaluates the `command` vocabulary itself and delegates every other key to an injected adapter evaluator. Routing is by trigger match alone, so a triggered entry spawns its body and records `passed` even when the evidence was there — that the gate checked at all is worth measuring.
- **Unjudgeable is a third result, not a failure** — evidence evaluation answers found, missing, or *unjudgeable*: no session to read, an unreadable one, a key no evaluator recognizes, no evaluator injected, or command evidence with no shell surface. An unjudgeable entry compiles to a **skip registration** — routing intact, no body — and a match records one `skipped` instead of judging. A pattern that does not compile skips the same way, in all four families. Assembly therefore never throws: one unresolvable entry cannot take down its siblings, both meta-covenants, and the witness valve, which would leave no way to fix the config that caused it. A configuration fault names itself on stderr; an absent session stays quiet.

## Design stance

No blocklists. Enumerating bypass patterns is always one step behind, so the logic is inverted: a mention of a protected path blocks unless proven safe. Complete containment is a non-goal — residual vectors such as indirect path computation are telemetry targets, not block targets. The friction valves are the read-only allowlist and the TTL witness, and both leave a measurable trace.

See the [project repository](https://github.com/huskyhoochu/polydeukes) for the architecture blueprint and design rationale.

## License

MIT
