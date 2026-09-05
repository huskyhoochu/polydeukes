# Why Polydeukes?

**English** · [한국어](./why-polydeukes.ko.md)

> The design whitepaper. Every claim here is either shipped or measured — the numbers come
> from this repository judging its own development, and the failure stories are ours.

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

The failure is rarely dramatic. Here is one we measured on ourselves. A rule banned
certain words from the source, and it worked: an edit carrying a banned word was refused.
Then the same content arrived inside a shell heredoc and landed without complaint. It had
not been forgiven — it had never been judged at all. The rule was real, the enforcement
was real, and there was simply a road into the repository that ran past it. Nothing in the
log said so, because a judgment that never happens leaves no trace to notice.

That is the shape of the problem. A check you cannot see failing is indistinguishable from
a check that works. We hit the same class again from the other direction: a probe written
to confirm a new rule blocked correctly turned out never to have reached the judgment,
because the very thing that made the probe safe to run also made it invisible to routing.
A gate nobody can open by doing the required work looks exactly like a gate that works —
from the outside, and from the logs.

And over-caution fails the same way. Protecting one file the cheap way — as a path with
ancestors — quietly made the entire home directory a protected zone. `cd` into it was
refused for two weeks and nobody noticed, because refusals feel like the tool doing its
job. The fix was to claim less: judge exactly that one file, by whole-path equality, and
declare everything outside the project root out of scope. Enforcement earns trust by
narrowing what it asserts, not by widening its net.

None of these were caught by reading the code. Each surfaced because every judgment leaves
a row, and rows can be counted, diffed, and compared against what we believed. That is the
gap this framework is built in: not "make the AI behave", but **make what happened
checkable** — by the human, by the agent, and by whoever reads the log next month.

## What it puts on one thin core

- **covenant** *(shipped, alpha)* — declared promises, judged deterministically. A break
  is recorded with its reason and, by default, does not stop the call; blocking is a
  promotion the author chooses. The judgment applies to the human exactly as much as to
  the AI. Two surfaces judge today: session tool calls and git commits, and the commit
  judge also runs on demand — `covenant check --worktree` after a task, `--range` before
  a PR or in CI, with no prompt and no gate, delivering the same verdict a commit would
  receive as a report. See [Configuring Polydeukes](./configuration.md).
- **ledger** *(on the roadmap)* — completion authority moves from "I say I'm done" to
  "the checks passed."
- **memory** *(on the roadmap)* — yesterday's decisions and dead ends, kept searchable
  next to the code.
- **verify** *(on the roadmap)* — judgments are not taken at their word; they check each
  other adversarially.

Four properties of the shipped layer are worth stating plainly, because each removes a
reason adoption usually fails.

**Debt is amnestied.** A discipline judges only what an edit *adds*. Pre-existing
violations are forgiven, so switching a rule on never blocks a legacy codebase on day
one. This is not a migration flag to be removed later — judging the delta *is* the
semantics.

**A discipline is one data entry.** Users declare a predicate as configuration data and
get enforcement, per-discipline telemetry, and the escape valve — without writing any
process plumbing. One form, a `declare` block, covers three kinds of evidence by what its
sources bind: the change as a world — what an edit adds, whether a path was touched,
whether two files moved together — the shell call's own command line, and the session's
own history — the only one whose subject is not the change but the procedure that should
have come before it. A command line is judged on content, so even a command that mentions
no protected path is still judged.

**The config that declares the discipline is itself under it.** The discovered config
file joins the protection surface automatically, and so does the loader that reads it.
Every link in the judging chain is judged, or the chain is decoration.

**The two surfaces are for two different people.** The session surface is for a project
developed with an AI partner — it judges tool calls as they are declared. The commit
surface is for a human developing alone — it judges the staged diff at the moment work
becomes history, with no AI anywhere in the loop, and there is no general reason to wire
both in one project. That second surface is the sharpest proof of the framing: strip the
AI away entirely, and what remains is a developer choosing to stand under their own
declared discipline. See [Installing Polydeukes](./installation.md) for the two paths.

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
records the opening; silence is not an option. Equality before the rules is not an
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
agreed token into the conversation; for a configured window a judgment that blocked can
be witnessed open, then blocking resumes on its own. Nobody has to remember to close it.
The valve stands after the verdict, never instead of it: the judge always runs, a call
that would have passed consults nothing, and so a `witnessed` record always names a real
block a present human answered for — sudo, not an exemption. The token is not a secret —
it sits in plain sight in the config file — because the defense is not confidentiality
but provenance: a witness counts only when the token arrives in a message the transcript
marks as human-typed, and that mark is one an agent cannot forge. The AI can read the
token and still cannot open the valve for itself. Consent has an author, and the
mechanism can tell who it was.

Provenance alone was not enough, and finding that out cost us a day. Matching the token
anywhere in a message meant that *discussing* the valve opened it — a question about when
the witness expires carried the token, and the window silently extended. Speech about a
thing had become an instance of it. The fix was to narrow what counts as invocation: the
token must stand alone on the first line, so quoting it is a mention and typing it is an
act. The general lesson is one a discipline framework should expect to keep relearning —
a string does not carry intent, and any mechanism that reads consent out of text must say
precisely which shape of text it will accept.

### 2. Deterministic, not persuasive

**Discipline lives in code, not in prompts.** A prompt is a request; a covenant is a
predicate. Every judgment is reproducible from its input, fail-open and fail-closed are
chosen per failure class in a policy table — never improvised — and an unjudgeable input
blocks rather than slips through. Whatever the disposition, the measurement stays open.

**Judging and stopping are separate decisions, and we separated them.** Every declared
discipline is judged on every matching call; what a break then *does* is a second question
with its own answer. By default a break is recorded with its reason and the call proceeds.
`enforce: block` is a promotion the author chooses, one entry at a time. What still stops
a call unasked is a finite list — the framework's own protection: the files that define
the checks, the compiled judges, the session record, and any assembly too broken to judge
at all.

That default was measured, not preferred. Five rounds of running this framework against
its own development found zero cases where stopping a call in real time prevented a bad
edit, and 93 percent of the times a human opened the valve were to repair the judging
chain itself. Worse, stopping bred avoidance: an agent that predicts a refusal reshapes
the call before making it, and the reshaped call passes legitimately with no record that
anything was avoided. Blocking was not producing compliance; it was producing silence, and
silence falsified the measurement. Recording the same break truthfully is worth more than
refusing it and learning nothing.

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

Determinism has a second meaning that took work to earn: **the same verdict wherever it
runs.** The judge reads no home directory, no working directory, no ambient filesystem —
not because those reads are forbidden but because it never learned they exist. Purity by
ignorance rather than by injection, pinned by a test that reads the judge's own source and
fails if a filesystem call appears in it.

Three lessons sit under that, each paid for once.

**A contract enforced only by documentation will fail.** Three separate patches moved the
same hole around before the promise moved into the type itself: deletion became
first-class evidence, and every change now carries its own. Types are the covenant's
native language — a rule the compiler checks is a rule that cannot quietly stop being
true.

**A gate is only as honest as its signal vocabulary.** A judge that never ran once exited
with the same code a judge reports when it finds a violation, so "the checker is broken"
arrived wearing the face of "the checker found something" — and at the advisory level that
dressed-up nothing passed, recorded as a verdict nobody had reached. No downstream
translation could tell them apart; the number was all there was. Ambiguity has to be
removed while the information still exists, which meant proving the judge is loadable
before trusting anything it returns. And prove exactly what you are about to run, never a
fixed inventory: a gate that closes over a judge it was never going to consult is the kind
of inconvenience that sends people to the override, and an override reached for daily
stops being an exception.

**An enforcement level has two owners.** The observer sets a surface's level as an
operating posture — "this surface never stops me" — and the author sets an entry's level
as its rung on the ladder from draft to advise to block. When the two disagree the lenient
side wins: an entry may lower itself under a surface that blocks, but no entry may raise a
surface its observer lowered. Self-imposed disciplines compose downward, never upward.

One more property is worth stating because it constrains what this framework may become.
**A non-goal has two halves, and only one of them is a contract.** "We keep the judge
pure" is a promise. "Therefore we cannot judge this class of thing" is a guess about the
future, and guesses expire — the cases once written off as unjudgeable were later judged
by assembly evaluating the evidence and handing the judge a plain answer. Nothing about
the promise had to change to bring them in.

The engine underneath is allowed to change, and did. Judging used to happen in a child
process — one `spawn()` per registration, which measured at 171 of every 237 milliseconds.
Folding the judges into the calling process preserved every observable byte: the same
telemetry rows in the same order, the same exit codes, the same one-line reasons, pinned
as fixtures *before* the change and re-run after. That is the only honest way to swap an
engine — record what the old one does, then let the recording vote. What the process
boundary used to buy moved to named places rather than evaporating: crash isolation became
a catch at the same cell of the same table, and judging in any language returns later as
an explicit external-process contract instead of an accident of how we happened to run
things.

### 3. Evidence, not self-report

**Nothing is trusted because someone — human or AI — says so.** Every covenant verdict
appends a telemetry record; an opened valve is recorded, never silent. Completion is what the
ledger verified, not what the worker claimed. And verification itself is adversarial:
judgments reflect each other, as twins do.

This is not a metaphor; it is an append-only log. The first dogfooded ticket left 133
lines behind it — 2 blocks, 56 valve openings, 75 passes, and not one silent call. By the
v0.1 gate the log held 1,020 verdicts, and the interesting number was the unflattering
one: valve openings had grown tenfold, 56 to 552, because the escape valve, once armed for a
single legitimate edit, stayed armed around everything else in the session. The log did
not soften that. It indicted the framework's own valve, and on that number alone a
time-boxed witness valve was promoted to the head of the next milestone. That is the stance
working end to end: the framework improves because the evidence says so, not because
anyone — including its authors — claims so. The ledger and adversarial verify extend
the same standard to completion claims and review judgments; they are still on the
roadmap, and they will be held to the same log.

One mechanism exists only because of this principle. Most rules forbid something; a
`precedent` declaration **requires** something. The edit is legitimate — what is refused
is arriving without the procedure that should have come first, like writing a dependency
version you never actually looked up. It enforces order rather than prohibition, and it
answers a question the other mechanisms do not: not "what does the rule forbid" but "what
does it require".

Its evidence lives on a surface the AI controls, which means forgery is structurally
possible — and it holds anyway, because the cheapest way through the gate is to actually
run the command, which is precisely the behaviour the discipline wanted. But that argument
was false as first shipped, and finding out why is the lesson: the judge accepted a
*request* as proof, so `echo "npm view yaml"` was cheaper than the call itself and the
whole justification collapsed. Evidence now means a call that ran and reported success.
Cheap-evasion is a property a judge has to earn, not one a design gets for free.

**This section's own claim had a hole, twice, and both holes are better stories than the
claim.** "Every verdict appends a record" was true and load-bearing — but a judge only ever
sees calls that were *declared*. A write arriving another way (a script assembling the path
from its own arguments, an interpreter, a test runner's child process) was never judged at
all, so it left no row. Not a bypass — an absence. The measured instance is in our log: an
agent, blocked three times at the tool axis, moved the edit into a script and succeeded,
and the framework recorded a pass. The fix is not a better predictor, because guessing what
a shell line will write is an infinite domain and this project's own rules forbid criteria
of that shape. Instead the mechanism observes *results*: protected files are hashed at each
call, and state that moved with no judgment explaining it lands its own word in the
vocabulary — `unattributed`, an observation rather than a verdict.

The second hole flatters you, which is why it lasted longer. That one *was* judged: the run
refused, exited non-zero, printed why. It simply left no record of refusing, because the
log's location comes from the config and the thing that had failed was loading the config.
A refusal is the safe direction, so nothing looked wrong from outside. What was lost was the
measurement, not the protection — and a gate you cannot count is a gate you cannot argue
for. It names a bias in how anyone audits their own checks: we verify that the block
happens, and the block happening is what makes us stop looking.

Three episodes show what the principle costs and buys, in that order.

**It stopped the AI writing this very feature.** A delegated implementer was blocked from
editing a manifest until someone had actually checked the registry. It ran the check,
stayed blocked — its evidence lived in a record the judge does not read — and reported the
block rather than opening the valve, which it cannot do for itself by design. The edit
landed once a human-driven session supplied the same evidence. The usual objection to
enforcement is that it slows the work down. Here it did, by one command, and the promise
held in the one direction that matters: the party being bound could not release itself.

**And it paid back inside the hour.** The session that taught blocks to carry their reason
was stopped twice by the reasons it had just added. One block demanded evidence — read what
this project already recorded about adapters before touching one — and the document it
forced open changed the work: it warned that a test passing on its first run proves nothing
until you check which mutation it would catch. The new test was then re-run against a
deliberately broken implementation to watch it fail. The cost was one document read; what
it bought was a verification that would otherwise not have happened.

**What the record makes visible, a reader can use.** The first thing `pdks explain` showed
on this repository was that its commit surface cannot judge five of its eleven disciplines.
The compiler had computed that reason at every single commit and nobody could read it,
because the only channel was a stderr line reserved for config faults. The reader is not a
second opinion — it renders the exact table the judgment uses, so what it shows is what
would have happened rather than a guess at it.

There is one instance of this gap outside our own walls worth naming. Meta's Astryx ships
an agent-ready design system whose installer writes behavioural rules — "always run
bootstrap on each branch", "always run this command before modifying a component" — into
the consumer's agent-facing file. We arrived at a nearly identical documentation surface
independently, and adopted their discovery design where it was better than ours. What
differs is the last step: those rules are instructions, and nothing observes whether the
agent followed them. The same sentence written as a discipline entry is a judgment that
leaves a row. Writing a discipline down and enforcing one are different acts, and the
shipped state of the art is mostly the first.

## What Polydeukes is not

It is not an agent runtime. Frameworks that build and run agents — sessions, sandboxes,
tool loops, deployment — solve execution. Polydeukes sits beside your existing coding
agent and solves *trust*: it judges tool calls before they land, measures every verdict,
and remembers what was decided. The two layers compose; they do not compete.

Three layers stack here, and confusing them is the usual source of "isn't this just…".
The **runtime** executes: sessions, sandboxes, tool loops, deployment. The **agent** decides
what to attempt. The **discipline layer** judges what the agent declared before the runtime
carries it out, and records the verdict either way. Polydeukes is only the third. It has no
opinion about which runtime you use and no ability to run anything itself.

That separation is why the adapters are independent, opt-in entities: one config file, one
namespace per adapter, with the core validating the container and each adapter owning its
own vocabulary. The judge speaks one language; every surface brings its own translator and
its own settings. Scope follows the same rule as level — it belongs to the observer, and it
is additive only. A config line can widen what a surface watches; none can quietly strip a
protection away.

It is not a linter either, though the comparison is fair enough to answer directly. The
disciplines *are* taste — the same philosophical class as a line-width setting — but taste
about the **process** rather than the artifact. A linter judges the final text; this judges
the trajectory: was the document read before the edit, was the version measured before it
was written. And the layer beneath that taste is not taste at all: the meta-covenants that
stop the judging chain from deleting itself, and the record contract that makes any of it
checkable. Measured on ourselves, 97 percent of blocks came from those meta-covenants, and
user disciplines caught fourteen.

It is not a cage that a clever agent routes around, either — and the reason is structural
rather than a rule forbidding it. A discipline whose evidence is the session record cannot
be satisfied by delegating the work to a subagent, because the subagent writes a different
record and the judge reads one. The escape hatch is closed by the shape of the evidence.
State the cost in the same breath: the same structure makes those paths undelegatable, so
the human-facing session does that work itself.

Finally, it is not a bet that models will stay unreliable. The trend toward giving models
more freedom argues *for* this layer, not against it. A model that self-regulates perfectly
still cannot prove to a third party that it did. Only the record can — which is why the
ledger outlives the rules, and why AI did not change the essence of software development so
much as reveal it. While code was expensive, code was easy to mistake for the asset. Now
that the price of code has collapsed, what stays valuable is what always was: judgment,
verification, records, discipline.

## Proven on itself

Since 2026-07-14 every edit and shell command in the Polydeukes repository runs through
its own covenants. The framework's sources are protected by the framework; the authors
get blocked by their own rules and the blocks are measured.

The v0.1 round of the dogfooding journal puts numbers to it: 1,020 verdicts across three
tickets — 455 passes, 13 blocks, 552 recorded valve openings — and zero unmeasured calls. The
milestone did not close on the backlog's word, either: the closing audit ran the exit
criteria as real commands and caught five path-matching escapes in the framework's own
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
verdict that could only be witnessed open by a typed token into a backstop that measures
instead of blocking.

By 2026-08-26 the log held 7,446 verdicts over five weeks of daily work: 6,438 passed, 686
skipped, 173 blocked, 88 advised, 47 unattributed, 14 witnessed. Read those numbers with
their bias stated. `passed` is an upper bound and `blocked` a lower one, because an agent
that predicts a refusal reshapes the call before making it and the reshaped call passes
legitimately, leaving no row saying anything was avoided. That bias is exactly what moved
the default from blocking to advising — and the two smallest numbers are the ones that
argued hardest. Fourteen witnessed openings across five weeks means the human valve is rare
enough to mean something when it fires; 47 unattributed rows mean the framework can see
changes no declared call explains, which is a category it could not name at all three
milestones ago.

The v0.5.0 round is the first with the advisory default live, and it reports the number the
pivot exists to collect: **9.9% of advisories were consumed** — 73 of 735 advised rows saw
a later pass on the same target in the same session, with the denominator call-weighted (one
ignored advisory repeats on every call, so fewer decisions were made than rows written) and
the variance wide: one read-first discipline's advisories were acted on at 77%, another's
at 0% across 292 rows. Blocking, meanwhile, behaved exactly as the pivot promised: 88% of
162 blocks were the chain protecting itself, zero false-block reports were filed, and an
assembly crash was refused fail-closed — eight calls in 71 seconds, every one recorded,
none passed unrecorded. One round of ignore-dominance is on the books; a second consecutive
one puts the delivery channel, not the posture, on trial — a live probe already showed the
documented "reason reaches the model" channel delivers nothing, so the only working
delivery today is an agent consulting the telemetry log. Read all of it with the standing
bias: `passed` is an upper bound, `blocked` a lower one.

One more property the record enforces on us: **measured history is never renamed.** When
the valve's vocabulary changed, the sweep touched every living surface — but the dated post
that published the old numbers kept them as published and gained an editor's note instead.
Reference documents speak only the present; dated posts speak only their moment. Preserved
is what we believed and measured; corrected is what was wrong on the day it shipped.

<!-- Standing rule: add one paragraph per milestone round from the dogfooding journal
     (verdict counts + what the numbers changed); never rewrite past rounds. The journal is
     the primary source — this section quotes it, never precedes it. Cite ratios with the
     shaping bias stated: `passed` is an upper bound, `blocked` a lower one.

     Parked candidate (DIST-01, 2026-08-02): dogfooding turned into product verification.
     The hook judging this repository used to be a prototype of an unshipped product — 266
     lines of assembly living inside the repo, which any other project would have had to
     copy by hand. That assembly moved into the package, so this repository's hook is now a
     thin delegator calling the same entry point a consumer installs. The claim sharpens
     accordingly: from "the authors get blocked by their own rules" to "the code that
     blocks us is the code you install". Publish it with the first round that cites a real
     outside install.

     Parked candidate (2026-08-27, the comment sweep): a citation suppresses the checking
     it appears to supply. Removing 1,180 wiki references from published comments meant
     reading each surviving claim against the code for the first time, and twelve of them
     were wrong — five had been wrong from the start, including one that described a
     protection check as looser than it is and another whose failure direction was
     backwards. Nobody had compared them, because `§4.2` reads as evidence that somebody
     already did. The general form is worth stating: a pointer to where a decision was
     recorded is not a substitute for the decision still being true, and an unreachable
     pointer removes the reader's ability to notice. Publish it once a second measurement
     confirms the pattern outside this one sweep.

     Parked candidate (CONTRACT-03, 2026-08-30): a published symbol nobody imports is not
     free. Narrowing this package's judging core from 72 exported symbols to 23 found that
     only six had a consumer outside the package at all; the rest were reachable because the
     package's own tests had been importing through the front door. The cost is not size —
     it is that every one of those names is a promise a consumer may build on, and the ones
     no consumer named could be dropped without a single test going red. What made that
     visible was a check whose expected value is derived from the consumer's source rather
     than written by hand beside the list it checks. Publish it with the milestone round that
     can cite what the narrowed contract let the next change do.

     Parked candidate (CONTRACT-04, 2026-08-30): a number you inherited is not evidence.
     Two consecutive tickets narrowing a contract each opened with a size that was wrong —
     the set of symbols to keep was right both times, and only the count summarising it was
     off, because a reader counts the lines of a table while a contract is measured in
     symbols, and one line can re-export three. The second time, the wrong number had been
     copied forward from an archived document into the roadmap and from there into the
     ticket, gathering the appearance of a settled fact at each hop. What caught it was
     refusing to spend the inherited figure: count from the supply side with a parser, count
     again from the demand side, and let the ticket proceed on the set while the summary is
     corrected. Publish it with the CONTRACT-03 candidate — they are one argument about
     measurement seen from two sides. A third instance (CONTRACT-05, 2026-09-05) points the
     other way: the inherited "nine" was a true count of one ticket's diff, repeated by three
     documents as if it were the count of the rule's domain — the rule reached two packages
     no ticket had ever diffed, and the real number was twenty-three.

     Parked candidate (ALGEBRA-01, 2026-08-29): the relation vocabulary is closed at seven
     and deliberately not reduced to its two-primitive kernel. `Within` was dropped because a
     constant bound belongs to extraction, not to the relation position — the one place the
     last comparison is allowed to happen — and keeping the single exception would have made
     every later refusal on that ground cite it as precedent. The surface stays at seven
     rather than the provable minimum of two because a minimal basis is exactly the
     vacuity failure the judging discipline exists to prevent: with one relation, every
     declaration reads as "the filtered set is empty" and nothing about the mechanism is
     visible. Publish with the v0.6.0 gate post, once the engine has judged live
     declarations on both surfaces.

     Parked candidate (ALGEBRA-04b, 2026-09-05): deletion is the migration. Four
     discipline families each had their own judging code; the plan was to keep their
     syntax as sugar compiled into declarations. With zero consumers, two grammars is
     confusion, not compatibility — so the families, their code, and their tests were
     deleted, and what remained was three primitives: the command line as a source of
     the world, one mechanism name for it, and one world for a shell call that changes
     no file. The first live run then locked every Edit: a declaration that reads a
     source its world may lack must say so in its own scope. Publish with the v0.6.0
     gate post.

     Parked candidate (ALGEBRA-06, 2026-09-05): a name the machine does not check is a
     comment. The `mechanism` field was a free string for a month — every declaration
     could call itself anything, and the measurement reported "the field is decoration".
     The fix was not to delete the field but to give each of the seventeen names a shape
     (axes, relations, a structural marker) and refuse a declaration whose syntax does
     not fit its name. The first probe found the empty shape satisfies every name: a
     source nobody declared derives no axis, and the empty set is a subset of everything —
     so the universe of source names had to close too. Publish with the v0.6.0 gate post.

     Parked candidate (ALGEBRA-02b, 2026-08-30): the host fabricates no defaults. When a
     declaration is judged live, each file change becomes one world, and a side the change
     does not carry — the `pre` of a creation, the `post` of a deletion — is an absent key,
     never an empty string the host invents. What absence means is written in the
     declaration's own `supply` policy: refuse (the default, recorded `blocked` at either
     level) or pass unjudged. The earlier spike substituted an empty ledger for a missing
     disk and its verdicts blurred; here the author states it. Publish with the first live
     declaration's rows in the v0.6.0 gate post.
     Parked candidate (ALGEBRA-03a, 2026-08-30): the judge never builds its own world. What a
     judgment sees is planned from the declarations, supplied by the surface through one
     injected reader, and handed over as an argument — the judge opens no file. Two surfaces
     then agree by construction rather than by test, and a third surface costs a reader, not a
     judge. Publish with the first content-parity declaration's rows.

     Parked candidate (ALGEBRA-03b, 2026-08-31): evidence a session cannot see is not a
     limitation to document — it is a channel to name. A subagent's spawns land beside the
     transcript, not in it, and until now that was a declared limit; naming the sidecar as
     a source kind turned the limit into a supply question, disposed of by the declaration's
     own absence policy. The surface that lacks the channel answers absence honestly instead
     of fabricating an empty observation. Publish when a live sidecar declaration lands.

     Parked candidate (ALGEBRA-05, 2026-09-05): the actor is what the host proves, never
     what the call says. The judge reads who made a call from the hook envelope alone —
     `agent_type` inside a subagent, `{}` in the main session — and never from the agent's
     own arguments or text; a surface that cannot prove one supplies nothing and the
     declaration's `supply` policy says what that means. The first two authority
     declarations (`producer-owned`, `actor-scope`) landed live on it. Publish with the
     v0.6.0 gate post beside the first actor rows.

     Parked candidate (ALGEBRA-07, 2026-09-05): a session's own history is a source like any
     file — named in the declaration, flattened once into plain data, and read by the same
     extract steps. The first `ordered` judgment landed live on it: "a test-writer spawn
     precedes an implementer spawn" is one relation over two observation ordinals, and the
     session that built the feature passed it because that is the order it actually worked
     in. Publish with the v0.6.0 gate post beside the first history rows.

     Parked candidate (ALGEBRA-02d, 2026-08-29): a line no valid input can reach still has
     an answer, and the answer is "cannot judge", never "upheld". The judge's closed list of
     predicate families is kept in step with the schema's by hand; between the schema
     widening and the judge learning the new family, the judge's fallback is live code. It
     used to say upheld — a `passed` no judgment produced. Now it says unjudgeable (exit 2),
     so the interim state shows up red in the suite instead of as universal passes. Publish
     with the fail-closed section, as the smallest example of its rule.

     Parked candidate (COVENANT-20, 2026-09-04): "commit surface only" is a capability, not a
     policy. The first change-set declaration (`.md` implies `.ko.md`) cannot be judged by a
     hook that sees one call — the pair is never in view — and the fix was not a key that lets
     an author pick surfaces but a flag the surface passes about what it observes; the judge
     turns that into `skipped`, the same word the commit surface already uses for evidence it
     cannot read. Publish with the two-surfaces section.

     Parked candidate (DIST-06b, 2026-08-30): a host's duplicate key is measured, not
     read. Grok merges two hook registrations into one spawn only when command AND
     matcher are byte-identical; unifying the command alone still spawned the judge twice
     (two telemetry rows, 79 ms apart). Four live probes fixed the key in one sitting.
     Publish with the "external contracts are fixed by live probing" thread from the Grok
     tool-name dev-log.

     Parked candidate (ALGEBRA-02, 2026-08-29): a judgment has one address for its last
     comparison, and the engine makes that structural rather than conventional. Every
     extract step maps a list of items to a list of items — the type has no room for a
     yes/no — and a relation answers with the elements that broke it, so "which key",
     "which task's field", "which line" is the verdict's data, not a message someone
     formatted afterwards. The closed relation list only means something while no step can
     smuggle the comparison out of it; the engine is where that stopped being a review
     rule and became a type. Publish alongside the ALGEBRA-01 candidate.

     Parked candidate (CONTRACT-01, 2026-08-30): a simple interface, in this project's
     words, is a contract that exports nothing beyond what a caller must know to fill one
     spec. Ousterhout measures a module by leverage per thing the caller learns; the
     mechanical form of that here is one spec object in, one named result out, and a
     barrel that re-exports only what a sibling, the umbrella, or the README needs. The
     first measurement found the judging package exporting 72 names of which its only
     consumer used 11 — the contract had no author, so it had grown to the size of the
     implementation. A ratchet test now holds the shape; publish once the application
     tickets shrink it. -->

## Where it stands

Polydeukes is alpha, built in public, one verifiable unit at a time. The story behind
the name — a twin who split his immortality to make his brother his equal — is told in
[STORY.md](../STORY.md). The build log lives in
[docs/build-in-public](./build-in-public/).

The gift changes contents as it matures. What the twin hands over first is discipline —
blocks, records, demanded verification, an inconvenient present. Once that discipline has
cut the variance of AI-assisted work below a manageable threshold, what remains in the hand
is imagination, finally free to be delegated. Discipline was the means. The freed
imagination is the gift.

Read the story, follow the build. The packages are published from the same pipeline a
consumer's first ten minutes replays — pack, clean install, init, live judgments — so when
the install instructions arrive here, they will have been walked end to end before they
were written down.
