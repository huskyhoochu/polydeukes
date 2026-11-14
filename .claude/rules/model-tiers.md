# Which model runs where

Judgment runs on `opus`; writing code to a fixed target runs on `sonnet`. The table is the allowlist
and the rule: a role is either on it or not, and changing a role’s model is a one-line change to
this file that a reviewer sees.

| Model    | Runs                                       | Why                                                                         |
| -------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| `opus`   | Review finders, verifiers, sweep           | Independent single-angle judgment is rechecked by verification or synthesis |
| `opus`   | Final review synthesis in the main session | It merges, ranks, and judges claims against the PRD                         |
| `sonnet` | Scope and other fixed-procedure steps      | Running `git diff` and listing files needs no higher tier                   |

## The TDD runner

RED, AUDIT, and GREEN use the Agent tool with `subagent_type` set respectively to `tdd-test-writer`,
`tdd-test-auditor`, and `tdd-implementer`, each with `model: "sonnet"`.

## How it is enforced

- `.claude/settings.json` sets `CLAUDE_CODE_SUBAGENT_MODEL` to `opus`; a spawn without a model,
  including built-in `/code-review` finders and verifiers and ad-hoc Agent calls, lands on `opus`.
- Precedence is the call's `model` > the agent file's `model:` > this default > inheritance from the
  parent.
- `.claude/agents` files name no model; a `sonnet` subagent exists only when the Agent call says
  `model: "sonnet"`.
- The `_FORCE` variant overrides explicit models; it is unset here so `sonnet` calls keep their
  assignment.

## Session authority

The main session, on `fable` or `opus`, administers this repository. It decides without asking:

- Skipping a loop step that does not apply to the ticket and saying so; the task text given to each
  worker.
- Accepting or declining a review finding; applying the auditor's DELETEs.
- Follow-up commits and pushes on the ticket branch; Forgejo issue and Plane updates.
- Commits to `main` for chores and documentation; the `_docs` commit and push.

The owner decides:

- Approving a PRD and merging a PR.
- Launching `/code-review ultra`.
- Changing a session-protected path and opening the witness valve.

Workers (`sonnet` subagents) hold none of this authority; they do the task they are given.
