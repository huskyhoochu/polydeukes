---
paths:
  - "packages/**"
---

# Comments a stranger can read

Every comment in `packages/` is published. It ships to npm inside `dist`, and it is what a
reader on GitHub sees before they have read anything else. Write for that reader: someone
with no access to our wiki, no memory of the ticket, and no reason to care which phase of
which cycle produced the line they are looking at.

Measured 2026-08-27, before the sweep that produced this file: 1,180 coordinate citations
across 165 files pointed into `_docs/`, a gitignored clone of a private wiki that is in no
package's `files` array. Every one of them was unresolvable for the audience above.

## A comment may not point at anything the reader cannot open

`_docs/` is not published, so a ticket ID, a PRD section, an `AC-n`, or a dev-log filename
is a dangling pointer the moment it leaves this machine. Say the fact instead of citing
where the fact was decided. What shipped is allowed: a package README, `docs/`, a public
URL, another source file in the same repo.

Cite a published document only where a reader genuinely needs the concept and the file
cannot restate it — a package entry point, or the head of a judge. Twice in one file is
duplication; write the fact the second time.

Reachability is the test, not the shape of the reference. A step letter a function
defines and uses inside itself — `judgeShellCommand`'s `(a)`–`(f)` ladder, where "(d)
before (e)" is an invariant the code cannot state — is a pointer the reader resolves by
looking twenty lines up. Keep those. `§2-a A6` looked identical and pointed off the
machine.

Two near-misses that read as reachable and are not. A repo file that no package ships —
`CLAUDE.md`, `.claude/rules/`, this file — is unreachable from an installed `dist`; state
the fact instead. And `telemetry.ts:136` rots the moment a line is inserted above it: name
the function, never the line.

## Process vocabulary is not a fact about the code

`P0`, `P1`, `RED phase`, `AUDIT disposition`, the record of which tests were pruned and
why — these describe how we worked, not what the code does. They meant something during
the cycle and nothing afterwards. The audit grade goes; the sentence explaining what the
test defends stays.

## Delete by default; keep what the code cannot say

The bar is not "is this true" — most of it is true. The bar is **would a reader who does
not have this comment change the code wrongly?** Two kinds clear it:

- **What the code cannot express** — why a constant holds exactly these members, why a
  check is deliberately conservative, which invariant an ordering protects. A reader who
  deletes an "unused" entry from `MUTATING_TOOLS` silently stops judging that tool; no
  test in the repository catches it. That comment stays.
- **Why a fixture is shaped strangely** — a payload built to reproduce one bug, a setup
  whose realism was traded away for discrimination, an ordering the assertion depends on.

Everything else goes, including comments that are accurate. Restating the next line, or
narrating a sequence the code already shows, adds a maintenance liability and no
information.

## No divider lines

`// ====` and `// ----` carry no information. A blank line separates sections; a file that
needs drawn rules to be navigable needs splitting instead. There were 487 of them in the
test suites and none in any source file — the sources were already right.

## Compression fails by generalising, not by shortening

Three defects in one sweep, all the same shape: a specific fact was rewritten as a general
principle, and the principle was false. "`(d)` must be reached before `(e)` can absolve"
became "each clause is reached before the next", in a ladder that deliberately skips `(c)`.
"This fixture uses a fake runner name" became "the literal gate would trip on a real one",
inventing a gate that scans `src/` only. "The boolean is inverted here" became "this fails
in the opposite direction from the rest of the package", when every site in the package
resolves the same way.

Cutting words is safe. Widening a claim to cover cases you did not check is how a comment
starts lying. When the shorter sentence needs a reason, use the one the code shows — not
the one that sounds like it ought to be true.

## Say it once, in the fewest lines that stay true

The paragraph is the unit, and three lines is a normal one. A comment that runs past eight
is usually two facts and a restatement — cut it to the fact that survives the question in
the previous section.
