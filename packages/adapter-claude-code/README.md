# @polydeukes/adapter-claude-code

**English** · [한국어](./README.ko.md)

> The boundary where Claude Code's vocabulary is translated away. PreToolUse hook payloads become the agent-neutral covenant input IR before anything reaches the core.

**Pre-alpha.** Not yet published to npm. Agent and tool literals live *here* by design — this package exists so they never reach the core, which is how the core's agent-neutrality stays a testable claim rather than a slogan.

## What lives here

- **Payload up-translation** — a raw PreToolUse payload becomes a `CovenantInput` (tool calls and subagent spawns). A `Task` call carrying a subagent type maps to a spawn; a payload that cannot be classified is a translation *failure*, and failures block (fail-closed) instead of degrading into a guess.
- **Virtual post-state** — computes what a file *would* contain after an `Edit`/`Write`/`MultiEdit` applies, without touching disk. Content-aware covenants judge the proposed result, not the file as it currently is — including sequential multi-edit application and file-creation conventions.
- **fileChanges evidence** — `collectFileChanges` pairs the disk pre-state with the virtual post-state into the IR's agent-neutral `fileChanges` field, the evidence discipline judgments consume. An unresolvable post-state omits the element (the real tool rejects the same edit), and the key is never fabricated for non-mutating calls.
- **Telemetry wiring** — `runAdapterPath` drives the full funnel: raw payload → translation (a failure logs one blocked record and exits `2`) → dispatch through an *injected* seam → funnel completion, so exactly one record lands per call, bypasses included. The dispatch seam is injected because this package never imports the covenant package — dependencies stay one-way, through the core only.

See the [project repository](https://github.com/huskyhoochu/polydeukes) for the architecture blueprint and design rationale.

## License

MIT
