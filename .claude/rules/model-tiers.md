# Which model runs where

Judgment runs on `opus`; writing code to a fixed target runs on `sonnet`. The allowlist below is
the rule — a role is either on it or it is not, and moving a seat is a one-line change to this
file that a reviewer sees.

| Model | Runs | Why |
|---|---|---|
| `opus` | `tdd-test-writer` | writes tests from the spec without reading the code: choosing the axes is judgment, and a missed axis is a hole no later phase fills |
| `opus` | `tdd-test-auditor` | classifies each test by the bug it would catch |
| `opus` | review finders, verifiers, sweep | independent single-angle judgment that a verifier or the synthesis re-checks |
| `opus` | the final synthesis of a review, done in the main session | it merges, ranks, and judges every finder's and verifier's claim against the PRD |
| `sonnet` | `tdd-implementer` | writes the minimum code that turns audited tests green; the tests are the target |
| `sonnet` | scope and other fixed-procedure steps | running `git diff` and listing files gains nothing from a higher tier |

## The TDD runner

RED, AUDIT and GREEN run in the mode the owner names (`.claude/skills/tdd/SKILL.md`, Runner):
sonnet mode spawns all three with `model: "sonnet"`, overriding the `opus` in the writer's and
auditor's files; pi mode runs them as `pi` processes on
`openrouter/deepseek/deepseek-v4.1-flash-1017` (`.claude/skills/ticket/SKILL.md` §3). The three
`tdd-*` rows above are the files' defaults for a spawn that names no model. In every mode the
agent files' bodies are the role prompts.

## How it is enforced

- `.claude/settings.json` sets `CLAUDE_CODE_SUBAGENT_MODEL` to `opus`. A subagent that names no
  model — every finder and verifier the built-in `/code-review` spawns, every ad-hoc `Agent`
  call — lands on `opus`. Precedence is: the call's `model` > the agent file's `model:` >
  this default > inherit from the parent.
- A `sonnet` subagent therefore exists only where the word `sonnet` is written: an agent file's
  frontmatter or an `Agent` call's `model`. Grep `.claude/agents` for `model:` to enumerate the
  seats; the table above is the authority they are checked against.
- The `_FORCE` variant of the variable overrides even an explicit model. It is not set here,
  because it would also lift `tdd-implementer` to `opus`.
