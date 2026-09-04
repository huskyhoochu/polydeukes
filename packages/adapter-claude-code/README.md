# @polydeukes/adapter-claude-code

**English** ·
[한국어](https://github.com/huskyhoochu/polydeukes/blob/main/packages/adapter-claude-code/README.ko.md)

> The boundary where Claude Code's vocabulary is translated away. PreToolUse hook payloads become
  the agent-neutral covenant input IR before anything reaches the core.

**Alpha.** Agent and tool literals live *here* by design — this package exists so they never reach
the core, which is how the core's agent-neutrality stays a testable claim rather than a slogan.

## What lives here

- **Payload up-translation** — a raw PreToolUse payload becomes a `CovenantInput` (tool calls and
  subagent spawns). A `Task` call carrying a subagent type maps to a spawn; a payload that cannot be
  classified is a translation *failure*, and failures block (fail-closed) instead of degrading into
  a guess.
- **Virtual post-state** — computes what a file *would* contain after an `Edit`/`Write`/`MultiEdit`
  applies, without touching disk. Content-aware covenants judge the proposed result, not the file as
  it currently is — including sequential multi-edit application and file-creation conventions.
- **File-change evidence** — the disk pre-state pairs with the virtual post-state into union
  evidence (`create` when no pre-state exists, `modify` otherwise) attached to the mutating tool
  call's own `fileChange` field — the evidence discipline judgments consume. An unresolvable
  post-state yields nothing (the real tool rejects the same edit), and evidence is never fabricated
  for non-mutating calls.
- **Transcript provider** — `transcriptFromJsonlFile` turns a session JSONL file into a
  `CanonicalTranscript`, the TTL witness's real data source: only positively-identified human-typed
  messages are admitted, so an AI can never synthesize its own witness. It answers `findToolCalls`
  too, extracting calls from `tool_use` blocks — when a call's `input` is not a flat object the
  block still yields a call with empty `args`, because the existence of the call is itself the
  evidence. A read failure answers `undefined` rather than an empty transcript — an empty session
  has said nothing yet and is judged, an unreadable one is no evidence channel at all and is
  skipped. Either way the valve turns off, never open.
- **Session supply readers** — `sessionSourceReader({ repoRoot })` is this surface's file
  reader (a `SourceReader` over the working tree: absence — no entry, a directory, NUL bytes —
  answers `undefined`, a permission refusal throws), and `sessionChannelReader({ transcriptPath })`
  is its spawn-sidecar channel: the subagent records this host keeps at
  `<dir>/<sessionId>/subagents/agent-*.meta.json` beside the transcript, answered as one JSON
  array in filename order. `'[]'` is a channel that observed no spawn; `undefined` is no
  channel at all — two different facts, and the declaration's `supply` policy disposes only of
  the second. The transcript this surface parses is also a declaration source (`{ transcript:
  true }`): the covenant flattens it into a snapshot at supply time, so this adapter adds no
  reader for it.
- **Precedent evidence evaluator** — `evaluatePrecedent` is this adapter's own evidence vocabulary
  for the context-family discipline, the same namespace stance as `resolveGitAdapterSettings` in the
  git adapter. It judges `subagent` (exact spawn-kind equality — a kind is a value, not a pattern)
  and `tool` (observed tool names matched as a regular expression), and returns `undefined` for any
  key outside its vocabulary — the handshake that tells the compiler this evidence is unjudgeable,
  so the entry skips instead of judging on a guess. A malformed value is absent evidence, never a
  throw.
- **Telemetry wiring** — `runAdapterPath` drives the full funnel: raw payload → translation (a
  failure logs one blocked record and exits `2`) → dispatch through an *injected* seam → funnel
  completion, so exactly one record lands per call, witnessed rows included. The dispatch seam is
  injected because this package never imports the covenant package — dependencies stay one-way,
  through the core only.

See the [project repository](https://github.com/huskyhoochu/polydeukes) for the architecture
blueprint and design rationale.

## License

MIT
