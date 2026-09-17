# Polydeukes

Read `CLAUDE.md` before working in this repository. It is the project-wide source of truth for
architecture, vocabulary, development workflow, and dogfooding recovery. Then read every
applicable file in `.claude/rules/` for the paths you will touch; those path-scoped rules apply to
Codex as well as Claude Code.

Work from `_docs/roadmap.md` for planned product work and `_docs/roadmap.issues.md` for external
issue work. Start ticket implementation through the repository's ticket workflow, preserve the
English/Korean documentation pairs, and run verification appropriate to the changed package.

This repository dogfoods `@polydeukes/adapter-codex` through `.codex/hooks.json`. The generated
hook must remain byte-identical to `pdks-codex init` output. Hook approval is bound to its
definition hash, and Code Mode `exec` plus nested tool calls are currently outside `PreToolUse`
coverage; do not describe an Active hook as complete coverage. Codex also has no session witness
evidence, so a blocked intentional edit must be recovered from the user's terminal.

Do not use or introduce Transcodes in this repository. Do not invoke Transcodes plugins, skills,
MCP tools, CLI commands, Persona workflows, hooks, generated files, or dependencies here. Manage
Codex project instructions directly in this `AGENTS.md` and the repository-owned rule files.
