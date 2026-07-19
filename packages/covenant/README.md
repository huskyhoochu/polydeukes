# @polydeukes/covenant

**English** · [한국어](./README.ko.md)

> Deterministic edit- and command-time blocks. A covenant is not a fence around the AI — it is a promise the human and the AI share, enforced by exit codes instead of etiquette.

**Pre-alpha.** Not yet published to npm. This package is already self-hosting: the repository develops itself under these covenants (self-dogfooding since 2026-07-14), and every call they judge lands in the ROI telemetry.

## What lives here

- **`runCovenant` wrapper** — runs a covenant body, translates its non-blocking break (`1`) into the blocking `2`, and logs every call — upheld, blocked, or bypassed — to the shared telemetry. No covenant runs unmeasured.
- **Path-routing dispatcher** — registers covenants against protected paths and runs *every* matching covenant (no short-circuit, so the telemetry never under-counts). Unparseable input blocks; unmatched input passes.
- **Self-mod meta-covenant (tool axis)** — the first real covenant: it protects the covenant substrate itself from editor-tool mutations. An escape-hatch seam lets a human pass legitimate work through — always recorded as `bypassed`, never silent.
- **Shell-mod meta-covenant (Bash axis)** — a heredoc-aware, multi-line shell analyzer with write-detection rules (redirects, `tee`, `sed -i`) and path-segment matching that also catches parent-directory manipulation and quote-split paths. A command that mentions a protected path passes only if its leading word proves it read-only; anything unprovable fails closed.
- **TTL waiver** — a sudo-style, time-boxed skip token judged over the canonical transcript seam. AI-synthesized messages do not qualify, expiry re-blocks, and every skip is measured as `bypassed`.
- **Delta layer** — pure new-violation-only judgment over a file's before/after pair: pre-existing debt is forgiven, and only the matches an edit adds break the covenant. This is the execution base the standard discipline library's `forbid` predicate builds on.

## Design stance

No blocklists. Enumerating bypass patterns is always one step behind, so the logic is inverted: a mention of a protected path blocks unless proven safe. Complete containment is a non-goal — residual vectors such as indirect path computation are telemetry targets, not block targets. The friction valves are the read-only allowlist and the TTL waiver, and both leave a measurable trace.

See the [project repository](https://github.com/huskyhoochu/polydeukes) for the architecture blueprint and design rationale.

## License

MIT
