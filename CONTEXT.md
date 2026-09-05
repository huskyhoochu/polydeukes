# Polydeukes

A development discipline framework for building alongside an AI coding partner. This file
defines the concepts; `.claude/rules/domain-terms.md` maps them to packages, keys and symbols
and enforces the words.

## Framework

**Covenant**:
A promise about the work that binds the human and the AI equally, judged deterministically on
every edit or push.
*Avoid*: Guard, gate (the gate is where a covenant is checked, not the covenant)

**Discipline**:
One practice a team imposes on itself, written down and judged. The countable unit of the
framework; the category the framework belongs to carries the same word. Born as prose,
promotable into a covenant.
*Avoid*: Rule, policy, guard, harness

**Gain**:
The return on the framework, measured from the judgments every area records rather than
reported by anyone.
*Avoid*: ROI dashboard, metrics

**Ledger**:
The record of work whose completion authority is the actions that passed, not the worker's
word.

**Memory**:
The searchable local record of decisions and dead ends.
*Avoid*: Knowledge base, kb

**Verify**:
Adversarial verification in which judgments check each other instead of self-reporting.

## Judging

**Judge**:
The component that decides.
*Avoid*: Checker, validator, linter

**Judgment**:
The act of deciding about one call or one change.

**Verdict**:
The result of a judgment, always one of the six verdict words below.
*Avoid*: Status, outcome (an outcome is a verb's result that carries no verdict)

**Surface**:
Where and when a judgment is invoked: the session surface judges a declared call before it
runs, the commit surface re-observes the same change as a staged diff.
*Avoid*: Using "surface" for a package's public API; that is an entry point

**Observation axis**:
The kind of evidence a surface can see about one call: the tool call, the shell line, or the
transcript.

**Meta-covenant**:
A judgment that protects the judging chain itself rather than the user's work. It is code, not
a declaration, and it blocks unasked; disciplines are what a user promises, meta-covenants are
what the judge must keep true about itself to be trusted.
*Avoid*: System rule, built-in rule

**Witness (valve)**:
A second judgment standing after a verdict that decides whether the verdict may be passed
this once. It reads evidence like any judgment; the presence of an accountable human is one
source it may read. Consulted only after a break, and never opened by the agent for itself.
*Avoid*: Waiver, exemption, override, bypass

**Passed**:
The call was judged and upheld the covenant.

**Blocked**:
The call was judged and broke the covenant, and was refused.

**Witnessed**:
A blocked verdict a human opened in person. Never silent, never a clean call.
*Avoid*: Bypassed

**Advised**:
A break recorded without stopping the call. The default disposition of every discipline.

**Skipped**:
The recorded absence of a judgment: the call reached a judge that could not judge it. Not a
pass.

**Unattributed**:
A protected thing moved with no judgment explaining it. An observation found after the fact,
not a verdict; it blocks nothing and passes nothing.

**Declared limit**:
Something the judge knowingly cannot decide, recorded as skipped and let through. The
opposite of a defect, which lets a call through with no record or records a pass that was
never judged.

**Enforce level**:
How a break is disposed of: advise or block. A surface has one, an entry has one, and the
lenient side wins.
*Avoid*: Severity, strictness

## Declaration algebra

**Declaration**:
One discipline written as data: an extraction over what the judgment can see, followed by a
relation whose result is the list of elements that break it. The only form a discipline
takes.
*Avoid*: Predicate family, rule set

**World**:
Everything one judgment may see about one observation — a change, or a shell call that
changes nothing: the observation itself plus the values no payload carries that the surface
supplies.

**Source**:
A named value inside a world that an extraction may start from. Six are fixed for every
world; a declaration may bind more.

**Supply**:
The step, between planning and judging, that fills a world's sources by reading through the
surface. Also the declaration's policy for a source that is absent: refuse, or leave the call
unjudged.

**Extract step**:
One unary transformation of items into items. The open half of the grammar: new steps are
registered, never improvised.

**Combinator**:
A binary first step that joins two extractions: union, only-in, intersect. The closed set of
three.

**Item**:
The unit of value the algebra moves: a key that decides combination and keyed comparison, and
a value that relations compare.

**Paired source**:
A source read on both sides of a change so the same pipeline yields a before/after pair. Only
the unchanged relation accepts a pair.

**Relation**:
The closed position where the last comparison happens. Seven names; two are primitive and the
rest expand to them. A constant bound is never compared here, only in extraction.
*Avoid*: Rule, check, assertion

**Witness (element)**:
One element for which a relation does not hold. A relation answers with the list of these,
never with a yes or no; an empty list means the relation holds. The valve is named after what
it supplies.
*Avoid*: Violation count, boolean result

**Relate entry**:
One named pairing of an extraction with a relation and the message a break renders.
*Avoid*: Rule

**Mechanism**:
The name of what a declaration is for, drawn from a closed catalogue. Each name carries a
shape: the axes it may read, the relations it may relate, the blocks it must carry.
*Avoid*: Category, type, tag

**Derived shape**:
What a declaration's syntax alone says it reads and relates. It must fall inside its
mechanism's shape.

**Axis (of a declaration)**:
Which kind of evidence a declaration reads: change, actor, world, or history. Derived from
its sources, never written by hand.

**Config fault**:
A declaration that cannot be compiled into a judgment. Named by location, told to the author,
and never a crash.

## Package contract

**Contract**:
Everything a package promises its consumers: its entry points and the symbols each one
re-exports.
*Avoid*: Surface, export surface, public API

**Executor skeleton**:
The contract shape where every runtime export is a verb, and a verb takes one spec and
returns one named result.

**Vocabulary skeleton**:
The contract shape of pure vocabulary: types, closed tuples, and positional pure functions.
No function takes a spec; that is the one discriminator between the two skeletons.

**Spec**:
A verb's only input.
*Avoid*: Options, params, config

**Spec ingredient**:
The only constant a contract may carry: a value that fills a field of an exported spec.

**Entry point**:
One path a consumer may import a package by.

**Barrel**:
The module behind an entry point that only re-exports. The consumer's contract, never the
test surface.
