# polydeukes

**English** · [한국어](https://github.com/huskyhoochu/polydeukes/blob/main/packages/polydeukes/README.ko.md)

> The unscoped umbrella: the `pdks` CLI entry point and the config discovery loader — the one
> place where the framework's pieces are assembled for the surfaces a repository actually runs.

**Alpha.** This package reserves the unscoped `polydeukes` name and sits above the scoped
`@polydeukes/*` modules as the only one allowed to assemble them — every other dependency stays
one-way, through the core alone.

## What lives here

- **`loadConfig(rootDir)`** — config discovery. Exactly one root data config (a
  `polydeukes.config` file in yaml, yml, or json form) directly under the given root, parsed with
  a safe schema (config data is never executable) and validated by the core's `defineConfig()`.
  Every failure branch throws — silent defaults are forbidden — and the discovered file attaches
  itself to its own protection surface.
- **`pdks covenant check`** — the first real subcommand of the `pdks` bin (`polydeukes` is an
  alias). A pre-commit judgment runner: staged changes are collected by `@polydeukes/adapter-git`,
  translated into the covenant input IR, and dispatched through the very judge bodies the session
  hook spawns — one judge, every surface. Context-family disciplines (`requirePrecedent`) assemble
  here like any other, but with no session to read they become skip registrations: when one
  matches a staged change it records a `skipped` event carrying its id and that change, and the
  commit proceeds. Judging them would block every matching commit with no legitimate pass path;
  filtering them out would hide that a gate stood down. It is the same disposition the session
  surface uses when it has no transcript. An empty staging area is an explicit pass; a missing or
  invalid config fails closed.
- **`pdks init claude-code`** — the session-surface installer. It proves `polydeukes` resolves
  from the target project before writing anything, then creates what every distribution path
  shares (the data config and its `.polydeukes/` ignore line) and what this path owns (a delegator
  hook, its `.claude/settings.json` registration merged into whatever that file already carries,
  and a scoped discipline file pointing an AI partner at `pdks docs`). Nothing existing is
  overwritten: an artifact already there is reported and left alone, so a re-run is a no-op and a
  consumer's edits survive. The generated config carries the resolution paths on its protection
  list and a witness block — without the valve the first block would freeze the project, since the
  hook it just registered is itself protected. Two coexisting config spellings, an unparseable
  settings file, and a package that cannot be resolved are all precondition failures: each leaves
  zero files rather than a half-wired tree.
- **`pdks docs [topic]`** — the offline documentation reader. The English guides and the reference
  layer are copied into `dist/docs` at build time, so a consumer's AI partner reads the
  documentation that shipped with the code doing the judging instead of whichever release a search
  engine indexed. With no argument it lists the five topics — that listing is how an agent
  discovers what it may ask at all; with one it returns that topic's section verbatim plus the
  reference to read next. The query domain is those five names and nothing else: an unknown topic,
  a bundled document that is missing, and a heading a document no longer carries each name what
  was missing on stderr and exit 2, leaving stdout at zero bytes. A partially written answer would
  be read as the document and quoted onward, so no path produces one.
- **The commit-surface witness valve** — at the `block` level (the default), when a staged change
  actually breaks a covenant, the runner prompts once on `/dev/tty` for the full witness token (a
  substring is refused), naming the broken registration, the matched entry, and the commit-wide
  reach of the one answer. A clean commit never prompts. No TTY — CI, an agent-spawned
  `git commit` — means no prompt and no way through: the valve is reachable only by a human at a
  terminal, and nothing is ever persisted. Every witnessed pass is measured as `witnessed`, never
  silent.
- **The enforcement level** — the git adapter's namespace setting
  `adapters.git.enforce: block | advise` selects what a commit-surface verdict does. Under
  `advise` the valve is structurally absent: a verdict is recorded as an `advised` event, one
  advisory line lands on stderr, and the commit proceeds — a backstop that measures instead of
  blocking. Only the verdict is relaxed: a run that cannot judge (missing or invalid config, an
  unresolvable judge body) fails closed at exit 2 at either level.

## The wider map

| Module | Role |
|---|---|
| `@polydeukes/core` | Covenant protocol, config schema, ROI telemetry, transcript seam |
| `@polydeukes/covenant` | Dispatcher, judge bodies, Bash analysis, discipline library |
| `@polydeukes/adapter-claude-code` | Session surface — PreToolUse payloads → covenant input IR |
| `@polydeukes/adapter-git` | Commit surface — staged diffs → covenant input IR |
| `@polydeukes/ledger` · `@polydeukes/memory` · `@polydeukes/verify` | Blueprint stage |

See the [project repository](https://github.com/huskyhoochu/polydeukes) for the architecture
blueprint and design rationale.

## License

MIT
