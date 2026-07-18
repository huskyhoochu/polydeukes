# Why Polydeukes?

**English** · [한국어](./why-polydeukes.ko.md)

> Skeleton draft — theses are final, prose is not. Each `TODO` marks a section to be
> expanded in a later pass of the public-docs workstream.

**Polydeukes** is a development *discipline* framework for building alongside an AI coding
partner. It turns the rules a good developer already imposes on themselves — verify before
you claim, record what you decided, never weaken your own checks — into deterministic,
measurable, shared infrastructure that binds the human and the AI equally.

<!-- TODO: expand intro to ~60 words; keep the one-sentence positioning first. -->

## The problem: collaboration built on unverifiable claims

AI pair development runs on self-reports. The agent says "done, tests pass" and the human
either believes it or re-checks everything by hand. Prompts ask the agent to behave;
nothing makes the asking stick. And every safeguard the human sets up, the agent — or the
human in a hurry — can quietly remove.

<!-- TODO: 2-3 paragraphs. Concrete failure stories (the "I'm done" that wasn't; the
     silently weakened check). Keep it experiential, not abstract — this section is the
     reader's pain, in their words. -->

## What it puts on one thin core

- **covenant** — deterministic blocks on edits and commands, defined as promises both
  sides accept. Breaking one is loud, bypassing one is recorded, and the block applies to
  the human exactly as much as to the AI.
- **ledger** — completion authority moves from "I say I'm done" to "the checks passed."
- **memory** — yesterday's decisions and dead ends, kept searchable next to the code.
- **verify** — judgments are not taken at their word; they check each other adversarially.

<!-- TODO: one link per area to its doc/package once each ships; mark current status
     honestly (pre-alpha: covenant core shipped, others on the roadmap). -->

## Three design principles

### 1. Covenant, not control

**A promise shared by both, not a fence around one.** The industry frames agent safety
as restraint imposed on the machine — the vocabulary of taming. Polydeukes refuses the
frame. The rules it enforces were never invented to cage an AI; they are the rules a
good developer has always imposed on themselves — write the test first, verify before
you claim, record what you decided. Handing those rules to a partner is not fencing them
in. It is a gift of the discipline one already lives by.

The renamed vocabulary is a design decision, not branding. This project bans the
industry's control words from its own code and documentation, because names decide how
you treat the thing named: what you call a fence you will use as a fence, and what you
call a promise you must yourself keep.

And the promise has teeth. The self-mod meta-covenant blocks any attempt to weaken a
covenant — editing its sources, or even a shell command that merely mentions them
without proof of read-only intent — and it does not ask whose hand moved. The authors
of Polydeukes are blocked by it daily. The only way through is a sanctioned valve that
records the bypass; silence is not an option. Equality before the rules is not an
aspiration here. It is enforced.

### 2. Deterministic, not persuasive

**Discipline lives in code, not in prompts.** A prompt is a request; a covenant is a
predicate. Every judgment is reproducible from its input, fail-open and fail-closed are
chosen per failure class in a policy table — never improvised — and an unjudgeable input
blocks rather than slips through. The gate closes; the measurement stays open.

<!-- TODO: 100-200 words. Source: core policy table, fail-closed dispatch, the
     "cannot judge means block" rule. One concrete example: the unbuilt-dist block and
     its sanctioned recovery. -->

### 3. Evidence, not self-report

**Nothing is trusted because someone — human or AI — says so.** Every covenant verdict
appends a telemetry record; bypasses are recorded, never silent. Completion is what the
ledger verified, not what the worker claimed. And verification itself is adversarial:
judgments reflect each other, as twins do.

<!-- TODO: 100-200 words. Source: ROI telemetry (roi.log), ledger verbs (record/verify),
     verify area. Real numbers from dogfooding once a milestone round is written up. -->

## What Polydeukes is not

It is not an agent runtime. Frameworks that build and run agents — sessions, sandboxes,
tool loops, deployment — solve execution. Polydeukes sits beside your existing coding
agent and solves *trust*: it judges tool calls before they land, measures every verdict,
and remembers what was decided. The two layers compose; they do not compete.

<!-- TODO: sharpen the layer diagram in prose (runtime / agent / discipline). No named
     comparisons needed — the category contrast carries it. -->

## Proven on itself

Since 2026-07-14 every edit and shell command in the Polydeukes repository runs through
its own covenants. The framework's sources are protected by the framework; the authors
get blocked by their own rules and the blocks are measured.

<!-- TODO: fold in dogfooding-journal numbers (passes / blocks / bypasses) per milestone.
     This section is the whitepaper's proof and should stay current. -->

## Where it stands

Polydeukes is pre-alpha, built in public, one verifiable unit at a time. The story behind
the name — a twin who split his immortality to make his brother his equal — is told in
[STORY.md](../STORY.md). The build log lives in
[docs/build-in-public](./build-in-public/).

<!-- TODO: CTA once there is something to install. Until then the CTA is: read the story,
     follow the build. -->
