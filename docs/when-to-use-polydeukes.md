# When Polydeukes fits and when another tool does

**English** · [한국어](./when-to-use-polydeukes.ko.md)

Polydeukes is a command-line program (`pdks`) that checks changes against a config file: right
before a file-changing or shell tool call in Claude Code or Codex, or when you pipe a git diff into
it from a commit hook or CI ([when checks run](./concepts/judgment.md#terms)). Other calls, such as
reads, web, or MCP tools, are not checked
([host capabilities](./reference/host-support.md#capabilities)). A _discipline_ is one check,
written as an entry in that config file
([YAML or JSON](./how-to/configure-project.md#find-the-config)); it can record advice and let work
continue, or refuse it. Detailed outcomes and exit codes are in
[choose advise or block](./how-to/configure-project.md#choose-advise-or-block) and the
[diff command contract](./how-to/git-hooks.md#contract).
[Evidence](./concepts/judgment.md#declarations) includes file text before and after, a second file
that the config names, changed paths, a command line, earlier calls in the session, or which
subagent made the call. Use this page to choose by the evidence your check needs and when you need
it.

<a id="what-it-is-not"></a>
## What Polydeukes is not

- **It does not run the agent.** The host, such as Claude Code or Codex, runs the agent and
  [calls Polydeukes through its hook](./how-to/connect-surfaces.md).
- **It is not a sandbox.** The host hook runs an adapter program that starts `pdks`. If the adapter
  or `pdks` cannot start, the call can proceed unchecked. Use the host's sandbox, OS permissions, or
  containers for execution restrictions. See
  [startup failures](./troubleshooting.md#judge-cannot-be-loaded).
- **It does not replace linters and tests.** Use linters, static analyzers, and test runners for
  those checks. Polydeukes does not read syntax trees; it extracts text with line, regex, and JSON
  operations. See the [extraction steps table](./reference/declaration-language/index.md).
- **It does not run a benchmark or test during a check.** It can check whether an earlier call in
  the session ran one ([see earlier calls](#fits)).
- **It does not prove a written explanation is true.** The config's `why` text is not executed. Use
  human review to assess the explanation. See
  [what the config executes](./concepts/judgment.md#declarations).
- **It does not yet provide a verifiable work ledger or adversarial verification.** The
  [README tagline](../README.md) names both; the design explanation places both on the roadmap, not
  among shipped components ([what remains a plan](./why-polydeukes.md#what-remains-a-plan)). In a
  ledger, passed checks, not the worker's report, show work is done; in adversarial verification,
  checks test each other's results instead of a self-report. Today, code review and CI records do
  that job. The judgment log (`.polydeukes/roi.log`) is not that ledger.

<a id="fits"></a>
## When Polydeukes fits

<a id="fits-approach"></a>
### How do you want to manage your checks?

1. **You want to configure checks without writing and maintaining check code.** A discipline is one
   entry in a configuration file with a schema; command bans, added-line checks, naming conventions,
   required earlier calls, and call order use the same typed vocabulary of sources, extraction
   steps, and relations. The loader validates that structure and rejects configurations that do not
   fit it. See the [declaration language](./reference/declaration-language/index.md).

2. **You want a written instruction to become a check with a recorded result.** Claude Code
   describes
   [CLAUDE.md as context, not enforced configuration](https://code.claude.com/docs/en/memory).
   Polydeukes runs checks through the host's hooks without a model: the same configuration and input
   produce the same result, with a log row for each judgment. A blocked call returns its reason to
   the agent; advice records the break and lets the call proceed. See
   [how a judgment works](./concepts/judgment.md).

3. **You want to share checks with teammates and reuse them across repositories and agents.** A
   discipline is a configuration entry you can copy into another repository's configuration,
   adjusting its paths, patterns, and enforcement setting for that project. A declaration applies
   wherever its required evidence is supplied: a declaration that reads file content applies to
   edits made through the host's file-editing tools in Claude Code and Codex sessions and to diff
   checks; one that reads command text applies only in sessions. See
   [host support](./reference/host-support.md).

4. **You want to see what a check reports before letting it stop work.** A discipline without an
   enforcement setting records violations and lets the call proceed. Entries with `enforce: block`
   stop calls that violate the discipline. Diff checks also need `--enforce block` to exit 2 on a
   blocking entry; without it, they record advice (see [check outcomes](#check-outcomes)).

<a id="fits-needs"></a>
### What do you need to stop or record?

| Need                                                          | What it reads                                 | Example                                                                                                                                                                              |
| ------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Stop commands that can discard work                           | Command text                                  | [Force pushes and `git reset --hard`](./recipes/work-stays-recoverable.md), [deleting a whole directory](./recipes/deletes-name-their-target.md)                                     |
| Keep checks from being disabled or skipped                    | Command text                                  | [Skipping commit hooks](./recipes/hooks-stay-armed.md)                                                                                                                               |
| Require calls to go through one entry point                   | Lines added by an edit                        | [Direct calls that bypass a wrapper](./how-to/write-disciplines.md#added-line-check), [imports that cross a module boundary](./recipes/internal-modules-stay-internal.md)            |
| Keep wording within an agreed vocabulary                      | Lines added by an edit                        | [New uses of banned words](./recipes/no-new-banned-words.md)                                                                                                                         |
| Catch changes that weaken tests                               | Lines added by an edit                        | [Skipped tests, snapshot assertions, added timeout settings](./recipes/tests-are-not-weakened.md)                                                                                    |
| Read complete check results and reduce unnecessary repetition | Command text and earlier calls in the session | [Truncating check output with `head` or `tail`](./recipes/output-is-read-whole.md), [repeating a test without an edit](./recipes/few-test-runs-per-edit.md)                          |
| Require evidence to be read before an edit                    | Earlier calls in the session                  | [Looking up a version before changing a dependency](./recipes/manifest-needs-evidence.md), [reading a design document before editing source](./recipes/document-read-before-edit.md) |
| Keep work within assigned roles                               | The subagent making the call                  | [An implementing subagent editing tests](./recipes/tests-are-the-writers.md)                                                                                                         |
| Follow naming and location conventions                        | The path being edited                         | [File naming conventions](./recipes/file-names-follow-the-convention.md)                                                                                                             |
| Keep records from being erased                                | File content before and after a change        | [Release headings in a changelog](./recipes/changelog-keeps-every-release.md)                                                                                                        |
| Keep content consistent across files                          | Multiple files and the paths in a change set  | [Enum values in two schemas](./recipes/schema-enums-agree.md), [English and Korean docs changed together](./recipes/docs-stay-bilingual.md)                                          |

Checks that read lines added by an edit, file content before and after a change, other files named
in the declaration, or the path being edited run on the agent's file-editing tool calls and on diff
input. In a session, files changed by shell commands do not receive content checks at that point;
diff input checks judge those changes. Checks that read the list of paths in a change set run only
on diff input. Checks that read command text, earlier calls in the session, or the subagent making
the call run only in agent sessions. Codex supplies neither
[call success](./reference/host-support.md#call-success) nor
[the subagent making the call](./reference/host-support.md#actor). The version-lookup and
read-before-edit recipes above require successful earlier calls, so they report a break on in-scope
edits in Codex; other differences, including file deletions, are in the
[host support table](./reference/host-support.md#capabilities). See
[all config examples](./recipes/index.md).

<a id="fits-elsewhere"></a>
## When another tool fits

- **Syntax patterns:** [Biome](https://biomejs.dev/linter/plugins/#register_diagnostic) or
  [ast-grep](https://ast-grep.github.io/advanced/tool-comparison.html#ast-grep).
- **Analysis within a function or across files:**
  [Semgrep](https://docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro) (across files in Pro).
- **Who must review a path:** require owner review before merging through branch protection and
  [CODEOWNERS](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners#codeowners-and-branch-protection).
- **Commit message format:** check parsed fields with
  [commitlint](https://commitlint.js.org/reference/plugins.html#rule-implementation).
- **Context you want the agent to know:** written project instructions in
  [CLAUDE.md](https://code.claude.com/docs/en/memory#claude-md-vs-auto-memory) or
  [AGENTS.md](https://agents.md/).

<a id="comparison"></a>
## Compare check time and input

| Tool                              | When it checks                                                                                                                                                                                                                                                 | What it reads                                                                                                                                                                                                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Biome plugins                     | During [`biome lint` or `biome check`](https://biomejs.dev/linter/plugins/#gritql-plugins); [staged files can be checked before a commit](https://biomejs.dev/guides/integrate-in-vcs/#process-only-staged-files)                                              | [Syntax nodes](https://biomejs.dev/linter/plugins/#register_diagnostic) in [JavaScript, CSS, and JSON](https://biomejs.dev/linter/plugins/#target-languages)                                                                                                                 |
| ast-grep                          | When run as a [linter](https://ast-grep.github.io/guide/introduction.html#introduction)                                                                                                                                                                        | [Code syntax, without deep semantic information](https://ast-grep.github.io/advanced/tool-comparison.html#ast-grep)                                                                                                                                                          |
| Semgrep                           | When a scan runs; for example, Semgrep's pre-commit diff scan covers [only the changes being added in the current commit](https://docs.semgrep.dev/kb/integrations/customize-semgrep-precommit#useful-arguments)                                               | [Interactions within a function in Community Edition](https://docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro); [cross-file taint flow in Pro](https://docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro#perform-cross-file-analysis)                            |
| commitlint                        | In a [`commit-msg` hook](https://commitlint.js.org/guides/local-setup.html#add-hook) or in [CI](https://commitlint.js.org/guides/local-setup.html#test-the-hook)                                                                                               | A [commit message file](https://commitlint.js.org/reference/cli.html#cli), supplied to rules as a [parsed message](https://commitlint.js.org/reference/plugins.html#rule-implementation)                                                                                     |
| Git hooks                         | `pre-commit` runs [before the message is obtained and the commit is made](https://git-scm.com/docs/githooks#_pre_commit)                                                                                                                                       | `pre-commit` receives no parameters; `commit-msg` receives the [message file's name](https://git-scm.com/docs/githooks#_commit_msg)                                                                                                                                          |
| CODEOWNERS                        | Requests review [when a pull request opens with changes to owned files](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners#about-code-owners)                               | [File path patterns and their owners](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners#codeowners-syntax)                                                                               |
| Claude Code permissions and hooks | `PreToolUse` runs [before the permission prompt](https://code.claude.com/docs/en/permissions#extend-permissions-with-hooks)                                                                                                                                    | The [tool call](https://code.claude.com/docs/en/permissions#manage-permissions); hooks also receive [`transcript_path`, `agent_id`, and `agent_type`](https://code.claude.com/docs/en/hooks#common-input-fields)                                                             |
| CLAUDE.md / AGENTS.md             | Context is loaded at [conversation start in Claude Code](https://code.claude.com/docs/en/memory#claude-md-vs-auto-memory); Codex builds instructions at [run start](https://learn.chatgpt.com/docs/agent-configuration/agents-md#how-codex-discovers-guidance) | Written project instructions: [CLAUDE.md context](https://code.claude.com/docs/en/memory#claude-md-vs-auto-memory) and [AGENTS.md Markdown](https://agents.md/)                                                                                                              |
| Polydeukes                        | [Before a file-changing or shell tool call](./concepts/judgment.md#terms), or when a diff is piped into [`pdks covenant check --diff`](./how-to/git-hooks.md#contract)                                                                                         | Evidence includes [before/after text, a second file that the config names, changed paths, command text, earlier calls in the session, and subagent identity](./reference/declaration-language/index.md), as supplied by the [host](./reference/host-support.md#capabilities) |

<a id="check-outcomes"></a>
### What happens when a check finds a break

The outcome depends on where the check runs and its enforcement setting.

| Where                                     | A discipline without `enforce`     | A discipline with [`enforce: block`](./how-to/configure-project.md#choose-advise-or-block), or a change to a [`protectedPaths`](./reference/configuration/index.md#protectedpaths) path                                             |
| ----------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before a file-changing or shell tool call | Records advice, the call continues | The host refuses the call (in Claude Code, a configured witness can open it; [opening a blocked call](./troubleshooting.md#opening-a-blocked-call)) (for a `protectedPaths` path, a shell command that mentions it is also refused) |
| Piped diff (`pdks covenant check --diff`) | Recorded as advice, exit 0         | Exit 2 when the command carries `--enforce block`; otherwise recorded as advice                                                                                                                                                     |

Polydeukes judges the change it observes, not the whole repository; a discipline can compare a file
before and after the change and report only when the count of matching lines grows, so matches
already in the file are not reported on their own
([banned-word example](./recipes/no-new-banned-words.md)).

Judgment results, including advice, are recorded, by default in `.polydeukes/roi.log`. On a piped
diff, a configuration that does not load also exits 2, and input that cannot be read exits 3; the
message on standard error tells these apart from a block
([diff command contract](./how-to/git-hooks.md#contract)).

<a id="q-biome"></a>
## Is a Biome plugin enough for this check?

Yes, for JavaScript, CSS, or JSON syntax checks inside
[`biome lint` or `biome check`](https://biomejs.dev/linter/plugins/#gritql-plugins). Biome plugins
attach diagnostics to syntax nodes; Polydeukes compares plain text, lines, or JSON values, including
[values from two files](./recipes/schema-enums-agree.md). Use Biome for syntax checks and Polydeukes
for comparisons such as keeping two schemas' enums equal. See Biome's
[target languages](https://biomejs.dev/linter/plugins/#target-languages) and
[syntax-node diagnostics](https://biomejs.dev/linter/plugins/#register_diagnostic).

<a id="q-ast-grep"></a>
## Should I write an ast-grep rule instead?

Yes, if you want lint rules that find code by its syntax patterns. Use ast-grep for syntax patterns;
use Polydeukes for the text, value, or session-evidence checks in [when Polydeukes fits](#fits). See
ast-grep's [linter introduction](https://ast-grep.github.io/guide/introduction.html#introduction)
and [analysis scope](https://ast-grep.github.io/advanced/tool-comparison.html#ast-grep).

<a id="q-semgrep"></a>
## Does Semgrep already cover this?

Yes, for code analysis within a function or taint analysis across files. Community Edition analyzes
within one function (intraprocedural analysis); Pro adds cross-file taint analysis. Use Semgrep for
analysis of code; use Polydeukes when the check needs earlier calls in the session or the acting
subagent, such as a [registry lookup before an edit](./recipes/manifest-needs-evidence.md). See
Semgrep's [Community Edition scope](https://docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro)
and
[Pro analysis](https://docs.semgrep.dev/semgrep-code/semgrep-pro-engine-intro#perform-cross-file-analysis).

<a id="q-commitlint"></a>
## Should this live in commitlint?

For a check at commit time, use commitlint for commit message format; use Polydeukes for what the
commit changes: file contents or paths that must
[change together](./recipes/docs-stay-bilingual.md). See commitlint's
[rule inputs](https://commitlint.js.org/reference/plugins.html#rule-implementation),
[hook setup](https://commitlint.js.org/guides/local-setup.html#add-hook), and
[CI guidance](https://commitlint.js.org/guides/local-setup.html#test-the-hook).

<a id="q-git-hooks"></a>
## Isn't a git pre-commit hook script enough?

Yes, a hook script is enough when the check is code you want to write and run at commit time. With
Polydeukes, the comparison is written as config instead of script; the same config file can also
hold disciplines (checks) that
[check before a file-changing or shell tool call](./how-to/connect-surfaces.md). Use a script for
your own check code; use Polydeukes for comparisons written in config. See
[what happens when a check finds a break](#check-outcomes), the
[diff command contract](./how-to/git-hooks.md#contract), and Git's
[pre-commit contract](https://git-scm.com/docs/githooks#_pre_commit).

<a id="q-codeowners"></a>
## Can CODEOWNERS stop an agent from changing a file?

No — CODEOWNERS acts when a pull request is opened: it requests review from owners, and with branch
protection it requires their approval before merging. Polydeukes can
[check the agent's edit before it runs](./concepts/judgment.md#terms). Use both when you need checks
before agent edits and owner approval before merging. See GitHub's
[review requests](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners#about-code-owners)
and
[required owner review](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners#codeowners-and-branch-protection).

<a id="q-claude-code-permissions"></a>
## Don't Claude Code permission rules and hooks already check an agent's tool calls?

Yes, permission rules and `PreToolUse` hooks run before the call; the difference is whether the
deciding logic is code in a hook script or disciplines in a config file. A hook author writes code
that reads
[`transcript_path`, `agent_id`, and `agent_type`](https://code.claude.com/docs/en/hooks#common-input-fields).
With Polydeukes, you write the checks as disciplines in the
[config file](./reference/declaration-language/index.md); the same file serves
[Codex and piped diffs](./how-to/connect-surfaces.md). Use permissions for tool access, custom hooks
for your own code, or Polydeukes for checks in config.

<a id="q-agent-instructions"></a>
## Isn't describing the check in CLAUDE.md or AGENTS.md enough?

Use both instruction files and Polydeukes when you need a record or a refusal. Claude Code's
documentation describes
[CLAUDE.md as context, not enforced configuration](https://code.claude.com/docs/en/memory#claude-md-vs-auto-memory).
[AGENTS.md is Markdown](https://agents.md/); Codex reads it when
[a run starts](https://learn.chatgpt.com/docs/agent-configuration/agents-md#how-codex-discovers-guidance).
The [read-before-edit discipline](./recipes/document-read-before-edit.md) records advice by default
when an edit precedes the required document read; `enforce: block` refuses it. The
[Codex limitation above](#fits) applies.

<a id="choosing-order"></a>
## How to choose

1. Name the evidence: file content, a second file that the config names, changed paths, command
   text, earlier calls in the session, the acting subagent, syntax, or a commit message.
2. Find the tool that reads it in the comparison above; for Polydeukes, check
   [host capabilities](./reference/host-support.md#capabilities).
3. Is the tool's check time early enough: before a file-changing or shell tool call, before a
   commit, or before merging?
4. For a check before a file-changing or shell tool call, connect the
   [Claude Code](./how-to/connect-surfaces.md#claude-code) or
   [Codex](./how-to/connect-surfaces.md#codex) hook; for commit or CI time,
   [pipe the diff](./how-to/git-hooks.md#contract) (see
   [what happens when a check finds a break](#check-outcomes)).

To try Polydeukes, follow the [first-run tutorial](./tutorials/first-judgment.md).
