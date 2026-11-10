---
paths:
  - ".claude/hooks/**"
  - ".claude/settings.json"
  - ".codex/hooks/**"
  - ".codex/hooks.json"
  - "polydeukes.config.yaml"
  - "lefthook.yml"
  - "packages/pdks/src/covenant/**"
  - "packages/pdks-claude-code/**"
  - "packages/pdks-codex/**"
---

# How the two surfaces judge

What each axis actually compares when this repo judges itself. Vocabulary for the terms below is in
`domain-terms.md`; the recovery procedures for a locked session are in `self-dogfooding.md`.

All protection-policy data lives in `polydeukes.config.yaml`, which documents each entry's why
inline — read it for the live protected paths and disciplines. Both surfaces fail **closed** when
the running judge cannot load valid configuration. If a session adapter or judge cannot start, the
call proceeds, as described in `self-dogfooding.md`. One call is judged while the config does not
load: on the session surface, a single Edit or Write whose only target is the config file, whose
`pre` is the text the loader read, and whose result loads lands `advised` under the `covenant-check`
label and exits 0 whatever `--enforce` says, so a typo in the config can be repaired from inside the
session. A rewrite that still does not load, evidence that does not start from the bytes on disk, a
call that touches anything else, and every change-set run stay closed.

## What blocks and why

- **Tool axis** (Edit/Write/…): only the call's proven mutation target is compared — a protected
  path inside an edit's _content_ is a mention and passes. An evidence-free call falls back to the
  conservative args-mention judgment. For a repository-relative entry, the adapter's proven target
  is placed against the repository root before comparison; a proven target outside the root matches
  no such entry. With `biome.json` protected, a Write to `/tmp/x/biome.json` is judged and upheld,
  while a Write to `<root>/sub/biome.json` breaks. The adapter also supplies the real path of a
  target reached through a link, so a link outside the repository pointing inside is judged under
  its real name. A proven path such as `a/../x`, where `..` cancels a name the path itself writes,
  is compared by name without placement. Without file-change evidence, args mentions compare by name
  wherever the path lies. An entry starting with `/` or `..` is compared as written, without
  placement; use such an entry to protect a file outside the repository, such as a user-level host
  settings file under the home directory. Repository-relative entries `.claude/settings.json` and
  `.codex/config.toml` do not match tool targets with those names under the home directory.
- **Bash axis** (`shell-mod`): a command mentioning a protected path blocks, including readers such
  as `cat`, `grep`, `ls`, `git ls-files`, `find`, and `sed -n …p`. Read protected files with the
  Read/Grep tools, which the tool axis judges by the proven target. A mention compares the path
  itself, ancestors, and descendants over the raw and `cwd`-joined spellings as a union; globs and
  `$VAR` are never expanded. A line the scanner cannot finish keeps an `unread` span, and a
  protected mention inside it breaks. The stderr reason names the deciding rung: a write rule
  (redirect, `tee`, `sed -i`), an opaque token, an opaque redirect, or the plain mention. Each rung
  gives the same verdict. A shell call that writes where its text does not reveal lands one
  `skipped shell-unjudgeable -` row. **That row is the contract**: a new spelling landing in
  `skipped` is a declared limit; a pass with no row (or `passed` without judgment) is the defect
  class. Never read a scan that stopped early as the safe direction. Comparison is by name whatever
  the `cwd` and whatever location the path spells, so a same-named file outside the repository is
  blocked on this axis and is created with the Write tool instead.
- **The transcript** is judged by whole-path equality, never as an ancestor. A shell command
  mentioning the transcript path breaks in every spelling, whatever its first word, readers
  included. Read the transcript with the Read tool.
- **Disciplines** in the config judge beyond path mention — every entry is one declaration. A break
  lands `advised` on both surfaces — exit 0, the `why` on stderr — unless the entry says
  `enforce: block` (POSTURE-01); the three meta-covenants above are what blocks unasked. The config
  places each declaration in the list of the surface that observes its channels — `disciplines` for
  one reading only the changed file and `file` sources, `sessionDisciplines` for one reading
  `command` · `transcript` · the `sidecar` channel · `actor`, `changeSetDisciplines` for one reading
  `changes` — and the loader refuses a misplaced entry rather than compiling it somewhere it cannot
  be judged. Each surface compiles the shared list plus its own, so neither surface carries the
  other's entries at all. A session-only declaration on a host that proves no session still lands
  `skipped` by its own `supply` policy.

## What a host proves, and what follows from it

The IR's `session` key says the call belongs to a live agent session; the witness valve and the
transcript axis hang off it. The Claude hook carries the transcript's human turns and tool calls.
The Codex hook records tool calls at `PostToolUse` into a session evidence file and removes it at
`SessionEnd`. It carries no human utterances: Codex prompt text is not human evidence, so a blocked
Codex call cannot be witnessed open. Make a protected change from the terminal.

A shell write inside a discipline's scope lands `skipped <id> <path> no-observation` on the session
surface. The judge does not compute the content the command would leave; the change-set surface
judges that content when the write is committed. Each pipeline's first step decides its sources,
axis, and placement. `source` is valid only as the first step; use `field` for a field lookup later
in the pipeline. A `source` elsewhere is a config fault.

That skip is the contract, not a gap: a surface that cannot answer says so in a row. The defect
class is the opposite shape — the same call landing `passed` against a subject nothing judged, which
is what this repository shipped for one commit before a review caught it.

## The sixth word nobody's judgment writes

The session surface compares the protected entries' on-disk state against a stored baseline at each
hook call, and an entry that moved with no judgment row explaining it lands one `unattributed` row
(COVENANT-14). It observes results rather than spellings, so an indirect write — an interpreter, a
test runner's child process — is recorded even though no declared call carried it. It records and
never blocks: the write already happened, and the comparison is fail-open on both ends of the
verdict. A rebuild that no judgment explains is a true positive, not noise.

## The witness valve

A human types the config's token so it stands alone on the message's FIRST line, and the window
holds for `ttlMinutes`. The valve stands AFTER the verdict — only a judgment that actually blocked
can be witnessed open (recorded `witnessed`, never silent), a mid-sentence mention does not arm it,
and an agent can never open the valve for itself.
