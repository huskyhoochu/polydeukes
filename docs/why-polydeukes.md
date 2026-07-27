# Why Polydeukes?

**English** · [한국어](./why-polydeukes.ko.md)

> Skeleton draft — theses are final, prose is not. Each `TODO` marks a section to be
> expanded in a later pass of the public-docs workstream.

**Polydeukes** is a development *discipline* framework for building alongside an AI coding
partner. It turns the rules a good developer already imposes on themselves — verify before
you claim, record what you decided, never weaken your own checks — into deterministic,
measurable, shared infrastructure that binds the human and the AI equally.

It was born from a flatline. Builders with more ideas than hands were promised that AI
would multiply their output, yet their productivity barely moved — because neither vibe
coding nor elaborate agent scaffolding can carry software development across long
sessions. An AI that must be watched at every step is not delegation; it is supervision.
The bottleneck was never the model's capability. It is predictability.

Polydeukes aims to push the predictability of AI-driven development past a manageable
threshold — not a flawless 100 percent, but a plannable 90-plus, where the framework
knows where the remaining uncertainty lives and routes it back to the human. Discipline
does not add capability; it cuts variance. Past that line delegation finally pays: you
hand the machine your roadmap and your imagination, not your attention.

## The problem: collaboration built on unverifiable claims

AI pair development runs on self-reports. The agent says "done, tests pass" and the human
either believes it or re-checks everything by hand. Prompts ask the agent to behave;
nothing makes the asking stick. And every safeguard the human sets up, the agent — or the
human in a hurry — can quietly remove.

<!-- TODO: 2-3 paragraphs. Concrete failure stories (the "I'm done" that wasn't; the
     silently weakened check). Keep it experiential, not abstract — this section is the
     reader's pain, in their words.
     Parked candidate (2026-07-27, COVENANT-10b): the same banned content was blocked when
     written with the edit tool and sailed through when delivered by a heredoc — not
     forgiven, simply never judged. The fix's shape is the story: what can be computed is
     judged, and what cannot leaves a recorded "could not judge" instead of silence.
     Parked candidate (2026-07-28, COVENANT-07c): protecting one file the cheap way — as a
     path with ancestors — quietly made the whole home directory a protected zone;
     `cd /home/<user>` was refused for two weeks and nobody noticed. The fix was a narrower
     claim, not a wider net: judge exactly one file, by equality, and declare everything
     outside the project root out of scope. Enforcement earns trust by claiming less. -->

## What it puts on one thin core

- **covenant** *(shipped, pre-alpha)* — deterministic blocks on edits and commands,
  defined as promises both sides accept. Breaking one is loud, bypassing one is recorded,
  and the block applies to the human exactly as much as to the AI. Two surfaces judge
  today: session tool calls and git commits. See
  [Configuring Polydeukes](./configuration.md).
- **ledger** *(on the roadmap)* — completion authority moves from "I say I'm done" to
  "the checks passed."
- **memory** *(on the roadmap)* — yesterday's decisions and dead ends, kept searchable
  next to the code.
- **verify** *(on the roadmap)* — judgments are not taken at their word; they check each
  other adversarially.

Three properties of the shipped layer are worth stating plainly, because each removes a
reason adoption usually fails.

**Debt is amnestied.** A discipline judges only what an edit *adds*. Pre-existing
violations are forgiven, so switching a rule on never blocks a legacy codebase on day
one. This is not a migration flag to be removed later — judging the delta *is* the
semantics.

**A discipline is one data entry.** Users declare `forbid`, `immutable`, or
`forbidCommand` as configuration data and get enforcement, per-rule telemetry, and the
escape valve — without writing any process plumbing. Rules are config; plugins are few.
The command family routes on content, so even a command that mentions no protected path
is still judged.

**The config that declares the discipline is itself under it.** The discovered config
file joins the protection surface automatically, and so does the loader that reads it.
Every link in the judging chain is judged, or the chain is decoration.

<!-- TODO: link each remaining area to its doc/package as it ships. -->

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

Strictness has a second half: what the judgment demands before it relaxes. A shell
command's target cannot be known before it runs, so a mention there still blocks. An
edit's target can be computed without touching disk, so only the proven target counts,
and a file that merely quotes a protected path passes. Same covenant, different
judgment, because the evidence available differs. The relaxation is licensed by proof,
never by convenience — a producer that cannot prove a target stays on the strict rule.
This is the concrete answer to "agreed enforcement, not control": the rule does not
soften because the author found it inconvenient; it softens exactly where it can see.

That valve is time-boxed, and its shape carries the same argument. A human types an
agreed token into the conversation; judgments are waived for a configured window, then
blocking resumes on its own. Nobody has to remember to close it. The token is not a
secret — it sits in plain sight in the config file — because the defense is not
confidentiality but provenance: a waiver counts only when the token arrives in a message
the transcript marks as human-typed, and that mark is one an agent cannot forge. The AI
can read the token and still cannot open the valve for itself. Consent has an author, and
the mechanism can tell who it was.

Provenance alone was not enough, and finding that out cost us a day. Matching the token
anywhere in a message meant that *discussing* the valve opened it — a question about when
the waiver expires carried the token, and the window silently extended. Speech about a
thing had become an instance of it. The fix was to narrow what counts as invocation: the
token must stand alone on the first line, so quoting it is a mention and typing it is an
act. The general lesson is one a discipline framework should expect to keep relearning —
a string does not carry intent, and any mechanism that reads consent out of text must say
precisely which shape of text it will accept.

### 2. Deterministic, not persuasive

**Discipline lives in code, not in prompts.** A prompt is a request; a covenant is a
predicate. Every judgment is reproducible from its input, fail-open and fail-closed are
chosen per failure class in a policy table — never improvised — and an unjudgeable input
blocks rather than slips through. The gate closes; the measurement stays open.

The policy table is small enough to quote. Failures that threaten the gate's integrity —
evidence absent, input unparseable, structure undecidable — resolve closed: the call
blocks. Failures of observability resolve open: losing a telemetry line never holds work
hostage. Four rows, decided once, applied everywhere; a failure kind nobody registered
resolves closed by default, because "cannot classify" is itself a gate-integrity failure.

One distinction the table does not contain was earned the hard way, and it decides which
row a case belongs to. *Evidence is absent* and *the evidence channel is absent* look alike
and resolve in opposite directions. A gate that can
read the session and finds nothing has an answer, and that answer blocks. A gate with no
session to read has no question — and blocking there demands proof the caller cannot
possibly supply, while the human override reads the same missing channel and stays shut
too. That is not a closed gate; it is a door with no handle on either side. So an
unreadable channel skips, loudly and measurably, and the skip shows up in the same data
every verdict does. Fail-closed protects the gate's integrity. It is not a reflex to reach
for whenever something is missing.
The rules themselves are data, not code — a discipline is declared in configuration and
judged by a predicate that was tested before you wrote a single line.

And the rule is lived, not aspirational. The enforcement hook fails closed too: if the
framework's own compiled output is missing, every protected edit blocks — including the
edit that would fix it. The sanctioned recovery is ordinary and boring — run the build,
a command that mentions no protected path. Boring is the point. A deterministic gate is
inconvenient in exactly the ways it promised and in no others, and the way out of a
closed gate is never a clever prompt — always a recorded, human-shaped action.

<!-- Parked candidate (2026-07-25, CORE-06): a contract enforced only by documentation
     will fail — three patches each moved the same hole until the promise moved into the
     type itself: deletion became first-class evidence and every change rides its own
     call, so absence of proof can no longer be misread as proof. Types are the
     covenant's native language. -->

<!-- Parked candidate (2026-07-27, COVENANT-07b): determinism is not only "same input,
     same verdict" but "same verdict wherever it runs" — the judge reads no home
     directory, no working directory, no filesystem, so the session hook and the commit
     gate cannot disagree about the same command. That property survived a feature that
     appeared to need the home directory, by moving the knowledge instead of the
     ignorance: the layer that does know it states the spelling as data, and the judge
     goes on comparing literals. Purity kept by ignorance rather than by injection — and
     pinned by a test that reads the source, because no behavioural assertion can see the
     difference. -->

<!-- Parked candidate (2026-07-27, COVENANT-07b): a non-goal has two halves, and only one
     of them is a contract. "We keep this pure" is a promise; "therefore we cannot judge
     this" is a guess that rode along with it. Two documents had ruled path notation out
     of scope on exactly that reasoning, and an audit walked through seven spellings of a
     protected file. Nothing about the promise had to change to close them. -->

### 3. Evidence, not self-report

**Nothing is trusted because someone — human or AI — says so.** Every covenant verdict
appends a telemetry record; bypasses are recorded, never silent. Completion is what the
ledger verified, not what the worker claimed. And verification itself is adversarial:
judgments reflect each other, as twins do.

This is not a metaphor; it is an append-only log. The first dogfooded ticket left 133
lines behind it — 2 blocks, 56 bypasses, 75 passes, and not one silent call. By the
v0.1 gate the log held 1,020 verdicts, and the interesting number was the unflattering
one: bypasses had grown tenfold, 56 to 552, because the escape valve, once armed for a
single legitimate edit, stayed armed around everything else in the session. The log did
not soften that. It indicted the framework's own valve, and on that number alone a
time-boxed waiver was promoted to the head of the next milestone. That is the stance
working end to end: the framework improves because the evidence says so, not because
anyone — including its authors — claims so. The ledger and adversarial verify extend
the same standard to completion claims and review judgments; they are still on the
roadmap, and they will be held to the same log.

<!-- Parked candidate (COVENANT-13, 2026-07-26): the context family — a covenant that
demands a *precedent* rather than forbidding a mutation. The edit is legitimate; what is
refused is arriving without the procedure that should have preceded it (measure the
dependency version before writing it). Two threads worth prose here: (1) it answers a
question the other principles don't — not "what does the rule forbid" but "what does it
require", enforcing order rather than prohibition; (2) unlike the waiver, its evidence
lives on a surface the AI controls, so forgery is structurally possible — and it holds
anyway, because the cheapest way through the gate is to actually call the tool, which is
precisely the behavior the discipline wanted. A rule whose evasion costs more than its
observance does not need to be unforgeable. Fits §3 (evidence over self-report) or §1
(agreed enforcement); §1 is already long. -->

## What Polydeukes is not

It is not an agent runtime. Frameworks that build and run agents — sessions, sandboxes,
tool loops, deployment — solve execution. Polydeukes sits beside your existing coding
agent and solves *trust*: it judges tool calls before they land, measures every verdict,
and remembers what was decided. The two layers compose; they do not compete.

<!-- TODO: sharpen the layer diagram in prose (runtime / agent / discipline). No named
     comparisons needed — the category contrast carries it.
     Parked candidate (2026-07-22, CONFIG-07): adapters are independent, opt-in entities —
     one config file, one namespace per adapter; the core validates the container only and
     each adapter owns its own vocabulary. "The judge speaks one language; every surface
     brings its own translator and its own settings."
     Parked candidate (2026-07-28, CONFIG-08): as the enforcement level is the observer's,
     so is the scope. Commit-only protection is a policy — the checkpoint where work is
     promoted into history; session-only protection is never a policy, only a visibility
     fact (what no commit can see). Scope algebra is additive-only: a config line can
     widen a surface's watch, never quietly strip one. -->

## Proven on itself

Since 2026-07-14 every edit and shell command in the Polydeukes repository runs through
its own covenants. The framework's sources are protected by the framework; the authors
get blocked by their own rules and the blocks are measured.

The v0.1 round of the dogfooding journal puts numbers to it: 1,020 verdicts across three
tickets — 455 passes, 13 blocks, 552 recorded bypasses — and zero unmeasured calls. The
milestone did not close on the backlog's word, either: the closing audit ran the exit
criteria as real commands and caught five path-matching bypasses in the framework's own
matching primitive, which became a pre-fix ticket before v0.1 was allowed to stand. The
journal adds a round per milestone and never edits an old one — the trend is the data.

Two properties held when a second enforcement surface arrived. **Provenance translates
per surface.** The session valve trusts the marking a transcript puts on a human-typed
message; the commit-time valve trusts a human at a terminal, because an agent-spawned
commit has no TTY to answer the prompt. One principle — an AI can never open its own
valve — with one concrete translation per surface it runs on. **And the level belongs to
the observer.** A commit-time verdict is not a new change but a second observation of the
same one, so how strictly that observation is enforced — block or advise — is the
observer's own setting, never part of the judge's shared vocabulary. Advise turns a
verdict that could only be passed by typing a waiver into a backstop that measures
instead of blocking.

<!-- Standing rule: add one paragraph per milestone round from the dogfooding journal
     (passes / blocks / bypasses + what the numbers changed); never rewrite past rounds.
     The journal is the primary source — this section quotes it, never precedes it.
     v0.2 round is still unwritten (the milestone gate runs it); add the paragraph then.
     This section is the whitepaper's proof and should stay current. -->

## Where it stands

Polydeukes is pre-alpha, built in public, one verifiable unit at a time. The story behind
the name — a twin who split his immortality to make his brother his equal — is told in
[STORY.md](../STORY.md). The build log lives in
[docs/build-in-public](./build-in-public/).

<!-- TODO: CTA once there is something to install. Until then the CTA is: read the story,
     follow the build.
     Parked candidate (2026-07-23, monetization conversation): "the gift changes contents
     as it matures" — what the twin hands over is discipline at first: blocks, records,
     demanded verification, an inconvenient present. Once that discipline has cut the
     variance of AI work below a manageable threshold, what remains in the hand is
     imagination — finally free to be delegated. Discipline was the means; the freed
     imagination is the gift. Candidate for this closing section or STORY.md. -->
