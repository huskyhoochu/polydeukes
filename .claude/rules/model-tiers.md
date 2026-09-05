---
paths:
  - ".claude/**"
---

# Which model runs where

The top tier (`fable`) is reserved for the steps where one judgment shapes everything
downstream. Every other subagent runs on `opus`; mechanical steps run on `sonnet`. The
allowlist below is the rule — a role is either on it or it is not, and a new `fable` seat is
a one-line change to this file that a reviewer sees.

| Model | Runs | Why |
|---|---|---|
| `fable` | the main session | it holds the conversation and every decision the loop gates on |
| `fable` | `tdd-test-writer` | writes tests from the spec without reading the code: a missed axis here is a hole no later phase fills |
| `fable` | the final synthesis of a review, done in the main session | it merges, ranks, and judges every finder's and verifier's claim against the PRD |
| `opus` | `tdd-implementer` · `tdd-test-auditor` | bounded by audited tests or by a classification table; review-shaped work holds accuracy on this tier |
| `opus` | review finders, verifiers, sweep | independent single-angle judgment that a verifier or the synthesis re-checks |
| `sonnet` | scope and other fixed-procedure steps | running `git diff` and listing files gains nothing from a higher tier |

## How it is enforced

- `.claude/settings.json` sets `CLAUDE_CODE_SUBAGENT_MODEL` to `opus`. A subagent that names no
  model — every finder and verifier the built-in `/code-review` spawns, every ad-hoc `Agent`
  call — lands on `opus`. Precedence is: the call's `model` > the agent file's `model:` >
  this default > inherit from the parent.
- A `fable` subagent therefore exists only where the word `fable` is written: an agent file's
  frontmatter or an `Agent` call's `model`. Grep `.claude/agents` for `model: fable` to
  enumerate the seats; the table above is the authority they are checked against.
- The `_FORCE` variant of the variable overrides even an explicit model. It is not set here,
  because it would also demote `tdd-test-writer`.
