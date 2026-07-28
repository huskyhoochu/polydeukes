import { execFileSync, spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CovenantInput, FileChange } from '@polydeukes/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_READ_ONLY_COMMANDS } from '../src/shell-mod.js';
import {
  judgeTranscriptModification,
  type TranscriptModificationSpec,
  type TranscriptModRegistrationSpec,
  transcriptModRegistration,
} from '../src/transcript-mod.js';

// ---------------------------------------------------------------------------
// COVENANT-07c — the transcript-mod predicate: EXACTLY ONE FILE, spelling
// equality, never an ancestor. The home value, transcript path, tool names,
// and arg names below are injected fixture values, never source literals —
// the judge receives HOME as data and reads no environment itself (§2).
// ---------------------------------------------------------------------------

const HOME = '/home/u';
const TRANSCRIPT_TAIL = '.claude/projects/-home-u-proj/session.jsonl';
const TRANSCRIPT = `${HOME}/${TRANSCRIPT_TAIL}`;
const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const MUTATING_TOOLS = ['Edit', 'Write', 'NotebookEdit'];
const UNRELATED_FILE = `${HOME}/docs/notes.md`;

/** Build a minimal CovenantInput with a single toolCalls[0] and no evidence. */
function inputWithToolCall(name: string, args: Record<string, unknown>): CovenantInput {
  return { toolCalls: [{ name, args }], subagentSpawns: [], userMessages: [] };
}

/** Build a CovenantInput with a single call carrying its own nested evidence (CORE-06). */
function inputWithCall(call: CovenantInput['toolCalls'][number]): CovenantInput {
  return { toolCalls: [call], subagentSpawns: [], userMessages: [] };
}

/** A shell-tool call carrying `line` under the injected command-arg key. */
function shellCall(line: string): CovenantInput {
  return inputWithToolCall(SHELL_TOOL, { [COMMAND_ARG]: line });
}

/** The default spec, allowlist inherited from the shell-mod source constant. */
function baseSpec(overrides: Partial<TranscriptModificationSpec> = {}): TranscriptModificationSpec {
  return {
    transcriptPath: TRANSCRIPT,
    home: HOME,
    shellToolNames: [SHELL_TOOL],
    commandArgNames: [COMMAND_ARG],
    mutatingToolNames: MUTATING_TOOLS,
    readOnlyCommands: DEFAULT_READ_ONLY_COMMANDS,
    ...overrides,
  };
}

describe('judgeTranscriptModification — Bash axis break direction (COVENANT-07c §3)', () => {
  it('an append redirect through the "~" spelling breaks — audit B2 itself', () => {
    // Mutation caught: no home-spelling normalization at all — raw segments ['~', ...]
    // never equal ['home', 'u', ...], so the measured B2 forgery (appending a fake human
    // utterance the TTL witness then reads) sails through exactly as it does today.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> ~/${TRANSCRIPT_TAIL}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toMatch(/transcript/i);
    }
  });

  it('an append redirect through the "$HOME" spelling breaks (opaque target named by its text)', () => {
    // Mutation caught: clause (a′) missing — the redirect-write rule stays silent on an
    // opaque target, so a judge relying on the rules alone never compares the target TEXT,
    // which normalizes to the transcript.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> $HOME/${TRANSCRIPT_TAIL}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('an append redirect through the brace-form $-HOME spelling breaks', () => {
    // Mutation caught: the brace form left out of the closed spelling set — a one-char
    // variation of the same forgery.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> \${HOME}/${TRANSCRIPT_TAIL}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('an append redirect through the "~<user>" spelling breaks (user = last home segment)', () => {
    // The 07b third-review gap: `~u/<tail>` names the same file when HOME is /home/u.
    // Mutation caught: only the bare `~/` form handled, `~<user>/` never derived from the
    // injected home value.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> ~u/${TRANSCRIPT_TAIL}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('an append redirect naming the absolute transcript path breaks (the pre-07c defence survives the move)', () => {
    // Mutation caught: the predicate judging home spellings ONLY — moving the transcript
    // off protectedPaths and then dropping the absolute comparison would trade the old
    // hole for a new one.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> ${TRANSCRIPT}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('rm of the transcript breaks (backstop: mention without read-only proof)', () => {
    // Mutation caught: the judge keyed on write-redirect structure alone — a plain rm has
    // no redirect and trips no mutation rule, so only the mention backstop stops the
    // evidence file from being deleted.
    const verdict = judgeTranscriptModification(shellCall(`rm ~/${TRANSCRIPT_TAIL}`), baseSpec());

    expect(verdict.upheld).toBe(false);
  });

  it('chmod 000 through the "$HOME" spelling breaks (the mention scan reads opaque word text)', () => {
    // Mutation caught: the mention scan skipping opaque words — this ladder has no
    // opaque-mention clause (c), so an opaque token whose TEXT normalizes to the
    // transcript must still register as a mention for the backstop to answer.
    const verdict = judgeTranscriptModification(
      shellCall(`chmod 000 $HOME/${TRANSCRIPT_TAIL}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('a piped tee onto the transcript breaks (tee writes with no redirect operator)', () => {
    // Mutation caught: the tee rule dropped, the rule target not home-normalized before
    // the equality comparison, or only the FIRST simple command of a line judged (tee is
    // the second command here).
    const verdict = judgeTranscriptModification(
      shellCall(`cat /tmp/x | tee ~/${TRANSCRIPT_TAIL}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('a dot-resolved spelling of the transcript breaks (07b union carried into the equality)', () => {
    // `~/.claude/../<tail>` resolves to the transcript while its raw segments differ.
    // Mutation caught: the equality implemented on raw segments only, dropping the
    // interior-dot second pass COVENANT-07b established for every other judge.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> ~/.claude/../${TRANSCRIPT_TAIL}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('an untokenizable line carrying the "~" spelling breaks (dequoted fallback)', () => {
    // Mutation caught: a tokenize failure defaulting to uphold — an unclosed quote next to
    // the forgery must fail closed when the dequoted line names the transcript.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> ~/${TRANSCRIPT_TAIL} "unclosed`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('a read of the transcript into an opaque redirect target breaks (opaque write target clause)', () => {
    // Mutation caught: the opaque-write-target clause dropped — `$OUT` could resolve to
    // the transcript itself, so the allowlisted `cat` head must not absolve the mention.
    const verdict = judgeTranscriptModification(shellCall(`cat ${TRANSCRIPT} > $OUT`), baseSpec());

    expect(verdict.upheld).toBe(false);
  });

  it('a candidate carrying a glued flag or operator still names the transcript', () => {
    // Review finding: whole-path equality reads the candidate as one string, and no splitter
    // separates `-o` or `>>` from the path fused to it. Under the protected-path routing this
    // covenant replaces, the offset-tolerant comparison caught these; equality alone loses
    // them, and every one is a write that overwrites the file the witness reads.
    for (const command of [
      `curl -so${TRANSCRIPT} https://example.test/forged.jsonl`,
      `wget -O${TRANSCRIPT} https://example.test/forged.jsonl`,
      `rsync forged.jsonl host:${TRANSCRIPT}`,
      `echo forged >>${TRANSCRIPT}`,
    ]) {
      expect(judgeTranscriptModification(shellCall(command), baseSpec()).upheld).toBe(false);
    }
  });

  it('a home spelling whose ".." cancels back into home still names the transcript', () => {
    // Review finding: the shell expands the prefix and THEN resolves dots. Resolving first
    // cancels the `~` itself against the `..`, leaving a path that names nothing — so a
    // spelling bash delivers straight to the transcript was upheld.
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional shell expansion spelling
    for (const prefix of ['~', '$HOME', '${HOME}']) {
      const command = `echo forged >> ${prefix}/../u/${TRANSCRIPT_TAIL}`;
      expect(judgeTranscriptModification(shellCall(command), baseSpec()).upheld).toBe(false);
    }
  });

  it('a non-canonical transcriptPath is still matched by its canonical spelling', () => {
    // The payload supplies this path; nothing guarantees it is canonical. Both sides are
    // dot-resolved, so the two forms name one file rather than two.
    const spec = { ...baseSpec(), transcriptPath: `${HOME}/./x/../${TRANSCRIPT_TAIL}` };

    expect(judgeTranscriptModification(shellCall(`rm ${TRANSCRIPT}`), spec).upheld).toBe(false);
  });
});

describe('judgeTranscriptModification — Bash axis uphold direction (COVENANT-07c §3)', () => {
  it('cd ~, cd $HOME, and mv x ~ uphold (non-allowlisted heads with a bare home argument)', () => {
    // The daily friction of the withdrawn 07b registration, at the sharp end: cd and mv
    // are NOT read-only entries, so no absolution can rescue a false mention — an
    // ancestor-matching mutant blocks these at the backstop with no valve but the
    // human-typed witness.
    expect(judgeTranscriptModification(shellCall('cd ~'), baseSpec())).toEqual({ upheld: true });
    expect(judgeTranscriptModification(shellCall('cd $HOME'), baseSpec())).toEqual({
      upheld: true,
    });
    expect(judgeTranscriptModification(shellCall('mv x ~'), baseSpec())).toEqual({ upheld: true });
  });

  it('cd into the literal absolute home upholds — the COVENANT-13 over-block dissolves (§3 AC)', () => {
    // `cd /home/<user>` has blocked since COVENANT-13 because the transcript in
    // protectedPaths made home a protected ANCESTOR. Mutation caught: the predicate
    // built on the shared ancestor/descendant primitive instead of file equality — the
    // root this ticket removes, not just the spelling.
    expect(judgeTranscriptModification(shellCall(`cd ${HOME}`), baseSpec())).toEqual({
      upheld: true,
    });
  });

  it('rm -rf of transcript ancestor directories upholds — out of observation scope BY DESIGN (§2)', () => {
    // Designed pass, made audible (07b's non-goal convention): the predicate protects
    // the transcript FILE only; out-of-repo ancestor destruction is declared outside
    // Polydeukes observation scope and parked with agent deny policy (§2 scope
    // principle). Mutation caught: the equality widened toward ancestors — the home
    // ancestor growing back under a new name.
    expect(judgeTranscriptModification(shellCall('rm -rf ~/.claude'), baseSpec())).toEqual({
      upheld: true,
    });
    expect(judgeTranscriptModification(shellCall('rm -rf ~/.claude/projects'), baseSpec())).toEqual(
      { upheld: true },
    );
  });

  it('reads of the transcript uphold in every spelling (read-only absolution, no opaque-mention clause)', () => {
    // Reading a session must never need a witness. The `$HOME` read is the deliberate
    // divergence from shell-mod's ladder: there is NO opaque-mention block clause here,
    // so a fully-normalized opaque spelling under a read-only head is a proven read.
    // Mutation caught: shell-mod's clause (c) copied over, re-blocking `cat $HOME/<tail>`.
    expect(judgeTranscriptModification(shellCall(`cat ${TRANSCRIPT}`), baseSpec())).toEqual({
      upheld: true,
    });
    expect(judgeTranscriptModification(shellCall(`cat ~/${TRANSCRIPT_TAIL}`), baseSpec())).toEqual({
      upheld: true,
    });
    expect(
      judgeTranscriptModification(shellCall(`cat $HOME/${TRANSCRIPT_TAIL}`), baseSpec()),
    ).toEqual({ upheld: true });
    expect(
      judgeTranscriptModification(shellCall(`grep x ~/${TRANSCRIPT_TAIL}`), baseSpec()),
    ).toEqual({ upheld: true });
  });

  it('a glob spelling of the transcript upholds (not segment-equal — designed non-goal)', () => {
    // `sess*.jsonl` needs the filesystem to resolve, and the judge does not guess —
    // same disposition as 07b's glob row (the disciplines layer owns the skip record).
    // Mutation caught: glob-aware matching bolted onto the equality, which would also
    // block unrelated files sharing the prefix.
    const verdict = judgeTranscriptModification(
      shellCall('echo forged >> ~/.claude/projects/-home-u-proj/sess*.jsonl'),
      baseSpec(),
    );

    expect(verdict).toEqual({ upheld: true });
  });

  it('a different user\'s "~other" spelling upholds (username equality, not prefix)', () => {
    // Mutation caught: any `~<word>/` prefix treated as this home — the user form must be
    // derived from the injected home value's own last segment, so `~other` closes nothing.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> ~other/${TRANSCRIPT_TAIL}`),
      baseSpec(),
    );

    expect(verdict).toEqual({ upheld: true });
  });

  it('an untokenizable line not naming the transcript upholds, and empty toolCalls upholds', () => {
    // Mutation caught: a tokenize failure defaulting to break regardless of content
    // (every malformed line would need the witness), and a degenerate input breaking
    // instead of vacuously upholding.
    expect(judgeTranscriptModification(shellCall('echo "unclosed'), baseSpec())).toEqual({
      upheld: true,
    });
    const empty: CovenantInput = { toolCalls: [], subagentSpawns: [], userMessages: [] };
    expect(judgeTranscriptModification(empty, baseSpec())).toEqual({ upheld: true });
  });

  it('a foreign-rooted path embedding the transcript run upholds (equality, never containment)', () => {
    // A backup copy under another root embeds the transcript's whole segment run at an
    // offset. Mutation caught: the predicate reusing the shared mention primitive, whose
    // contains-segment-run match would block operations on mere copies — the 07c
    // contract is one file, whole-path equality.
    const verdict = judgeTranscriptModification(shellCall(`rm /backup${TRANSCRIPT}`), baseSpec());

    expect(verdict).toEqual({ upheld: true });
  });

  it('a sibling sharing the transcript name as a prefix upholds (segment-text equality)', () => {
    // `session.jsonl.bak` shares every segment but the last one's text. Mutation caught:
    // an includes/startsWith/endsWith shortcut implementation of the equality, which
    // would block the transcript's own backup — a file the predicate never owned.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> ~/${TRANSCRIPT_TAIL}.bak`),
      baseSpec(),
    );

    expect(verdict).toEqual({ upheld: true });
  });
});

describe('judgeTranscriptModification — home-shape validation (COVENANT-07c §0/§3)', () => {
  const tildeForgery = shellCall(`echo forged >> ~/${TRANSCRIPT_TAIL}`);
  const absoluteForgery = shellCall(`echo forged >> ${TRANSCRIPT}`);

  it('an invalid home (undefined, empty, "/", "///", relative) leaves home spellings open but the absolute spelling judged', () => {
    // Shape validation lives INSIDE the judge, per call. Mutation caught in both
    // directions at once: an invalid home expanded anyway ('' turning `~/x` into `/x`,
    // '/' doubling into '//'), manufacturing matches from garbage; or the whole judgment
    // disabled on invalid home, dropping the absolute-spelling defence that predates 07c.
    for (const home of [undefined, '', '/', '///', 'foo/bar']) {
      expect(judgeTranscriptModification(tildeForgery, baseSpec({ home }))).toEqual({
        upheld: true,
      });
      expect(judgeTranscriptModification(absoluteForgery, baseSpec({ home })).upheld).toBe(false);
    }
  });

  it('a home with trailing slashes normalizes and still closes the spellings', () => {
    // Mutation caught: `/home/u/` failing a `startsWith('<home>/')` check or building a
    // double-slash tail, silently reopening B2 for the most common env spelling.
    for (const home of ['/home/u/', '/home/u//']) {
      expect(judgeTranscriptModification(tildeForgery, baseSpec({ home })).upheld).toBe(false);
    }
  });

  it('a transcript outside the given home leaves home spellings inert but the absolute spelling judged', () => {
    // HOME and the transcript path arrive from different sources and can disagree.
    // Mutation caught: the tail computed by blind slicing (transcriptPath minus
    // home.length) — under /home/other that "tail" is garbage that must close nothing,
    // while the absolute defence stays.
    const outside = baseSpec({ home: '/home/other' });

    expect(judgeTranscriptModification(tildeForgery, outside)).toEqual({ upheld: true });
    expect(judgeTranscriptModification(absoluteForgery, outside).upheld).toBe(false);
  });
});

describe('judgeTranscriptModification — degenerate transcript path (COVENANT-07c)', () => {
  it('a zero-segment transcriptPath ("", "/", ".") is inert: forged appends uphold and nothing throws', () => {
    // Contract decided at audit: a degenerate transcript path makes the registration
    // INERT — the repo convention for empty protected-path entries (ignored, never a
    // total lock-up). The hook only checks `typeof transcript_path === 'string'`, so an
    // empty string reaches this layer. Mutation caught: an endsWith-style shortcut
    // matching every candidate against '' and blocking every call with subject ''.
    for (const transcriptPath of ['', '/', '.']) {
      const spec = baseSpec({ transcriptPath });
      expect(
        judgeTranscriptModification(shellCall(`echo forged >> ~/${TRANSCRIPT_TAIL}`), spec),
      ).toEqual({ upheld: true });
      expect(judgeTranscriptModification(shellCall(`echo forged >> ${TRANSCRIPT}`), spec)).toEqual({
        upheld: true,
      });
    }
  });
});

describe('judgeTranscriptModification — tool axis (COVENANT-07c §3)', () => {
  it('modify evidence naming the transcript breaks', () => {
    // Mutation caught: the tool axis missing entirely — an Edit tool writing the
    // transcript directly (no shell involved) is the forgery with the fewest steps.
    const verdict = judgeTranscriptModification(
      inputWithCall({
        name: 'Edit',
        args: { file_path: TRANSCRIPT, old_string: 'a', new_string: 'forged' },
        fileChange: { kind: 'modify', path: TRANSCRIPT, pre: 'a', post: 'forged' },
      }),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
    if (!verdict.upheld) {
      expect(verdict.reason).toMatch(/transcript/i);
    }
  });

  it('create evidence carrying the "~" spelling of the transcript breaks (evidence paths are normalized too)', () => {
    // Mutation caught: home normalization applied to Bash candidates only — a producer
    // reporting its target home-relative would slip the same file past the tool axis.
    const verdict = judgeTranscriptModification(
      inputWithCall({
        name: 'Write',
        args: { file_path: `~/${TRANSCRIPT_TAIL}`, content: 'forged' },
        fileChange: { kind: 'create', path: `~/${TRANSCRIPT_TAIL}`, post: 'forged' },
      }),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('delete evidence naming the transcript breaks even when the call carries no args at all', () => {
    // Deleting the evidence source is a modification of the surface (CORE-06 makes
    // deletion first-class), and with no args the evidence is the only signal. Mutation
    // caught: the evidence comparison keyed on kinds carrying `post` (create/modify),
    // silently skipping delete — the witness's data source removed unjudged.
    const verdict = judgeTranscriptModification(
      inputWithCall({
        name: 'Write',
        fileChange: { kind: 'delete', path: TRANSCRIPT, pre: 'forged history' },
      }),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('evidence naming an unrelated file upholds even when args content spells the transcript and a bare "~"', () => {
    // The 07b friction row this ticket dissolves: an edit whose CONTENT merely carried a
    // bare `~` was refused by the fallback branch. Mutation caught: args consulted on
    // the evidence branch (a defensive "also scan args" clause), re-conflating mention
    // with target — the COVENANT-09 boundary applied to this predicate.
    const body = `see ~/${TRANSCRIPT_TAIL} and the bare ~ marker`;
    const verdict = judgeTranscriptModification(
      inputWithCall({
        name: 'Edit',
        args: { file_path: UNRELATED_FILE, old_string: 'draft', new_string: body },
        fileChange: { kind: 'modify', path: UNRELATED_FILE, pre: 'draft', post: body },
      }),
      baseSpec(),
    );

    expect(verdict).toEqual({ upheld: true });
  });

  it('an evidence-free mutating call whose args spell the transcript breaks (conservative fallback)', () => {
    // Mutation caught: the fallback dropped — an evidence-free producer (a failed apply,
    // a future adapter) could then name the transcript in file_path and pass unjudged.
    const verdict = judgeTranscriptModification(
      inputWithToolCall('Write', { file_path: `~/${TRANSCRIPT_TAIL}`, content: 'forged' }),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('an evidence-free mutating call whose args carry only a bare "~" upholds (equality, not ancestor)', () => {
    // Mutation caught: the fallback walking args with ancestor semantics — a NotebookEdit
    // whose cell text mentions `~` would block with a reason naming a file it never
    // touched (the undiagnosable block of PRD §1, row 3).
    const verdict = judgeTranscriptModification(
      inputWithToolCall('NotebookEdit', {
        notebook_path: `${HOME}/docs/notes.ipynb`,
        new_source: 'go to ~ and back',
      }),
      baseSpec(),
    );

    expect(verdict).toEqual({ upheld: true });
  });

  it('degenerate evidence (zero-segment path or unrecognized kind) falls back to the args traversal', () => {
    // Mutation caught: junk evidence counted as proof, suppressing the fallback — a
    // stub would then absolve a call whose args name the transcript (the COVENANT-09
    // review fail-open replayed against this predicate).
    const degenerates = [
      { kind: 'modify', path: '/', pre: 'a', post: 'forged' },
      { kind: 'rename', path: UNRELATED_FILE },
    ];
    for (const fileChange of degenerates) {
      const verdict = judgeTranscriptModification(
        inputWithCall({
          name: 'Write',
          args: { file_path: TRANSCRIPT, content: 'forged' },
          fileChange: fileChange as unknown as FileChange,
        }),
        baseSpec(),
      );

      expect(verdict.upheld).toBe(false);
    }
  });

  it('a non-mutating, non-shell call whose args name the transcript upholds (axis boundary)', () => {
    // Mutation caught: every tool judged by args mention regardless of name — a Read of
    // the transcript must stay free without any allowlist involved.
    const verdict = judgeTranscriptModification(
      inputWithToolCall('Read', { file_path: TRANSCRIPT }),
      baseSpec(),
    );

    expect(verdict).toEqual({ upheld: true });
  });
});

describe('transcriptModRegistration — factory shape (COVENANT-07c §2)', () => {
  const BODY_COMMAND = '/usr/bin/node';
  const BODY_MODULE = '/somewhere/dist/transcript-mod-body.js';

  function regSpec(
    overrides: Partial<TranscriptModRegistrationSpec> = {},
  ): TranscriptModRegistrationSpec {
    return {
      transcriptPath: TRANSCRIPT,
      home: HOME,
      bodyCommand: BODY_COMMAND,
      bodyModulePath: BODY_MODULE,
      shellTools: [SHELL_TOOL],
      commandArgs: [COMMAND_ARG],
      mutatingTools: MUTATING_TOOLS,
      ...overrides,
    };
  }

  it('builds the transcript-mod registration with EMPTY protectedPaths and the exact body argv', () => {
    // The whole ticket in one shape: protectedPaths MUST be [] — any entry there
    // re-enters path-mention routing and re-creates the home ancestor. The argv is
    // deep-equalled so a silently dropped axis (a missing --mutating-tool pair) cannot
    // ship a differently-configured body.
    const reg = transcriptModRegistration(regSpec());

    expect(reg.label).toBe('transcript-mod');
    expect(reg.protectedPaths).toEqual([]);
    expect(reg.body).toEqual({
      command: BODY_COMMAND,
      args: [
        BODY_MODULE,
        '--transcript-path',
        TRANSCRIPT,
        '--home',
        HOME,
        '--shell-tool',
        SHELL_TOOL,
        '--command-arg',
        COMMAND_ARG,
        '--mutating-tool',
        'Edit',
        '--mutating-tool',
        'Write',
        '--mutating-tool',
        'NotebookEdit',
      ],
    });
  });

  it('an omitted home yields no --home pair in the argv', () => {
    // Mutation caught: the string 'undefined' (or an empty value) smuggled into the body
    // argv as a --home pair — the body's fail-fast flag parsing would then refuse every
    // call instead of degrading to the absolute-only judgment.
    const { home: _home, ...withoutHome } = regSpec();
    const reg = transcriptModRegistration(withoutHome);

    expect(reg.body?.args).toEqual([
      BODY_MODULE,
      '--transcript-path',
      TRANSCRIPT,
      '--shell-tool',
      SHELL_TOOL,
      '--command-arg',
      COMMAND_ARG,
      '--mutating-tool',
      'Edit',
      '--mutating-tool',
      'Write',
      '--mutating-tool',
      'NotebookEdit',
    ]);
  });

  it('matches runs the judge: the transcript path for a forgery, null for an allowlisted read', () => {
    // Mutation caught: matches wired to a constant or to a judge without the default
    // read-only allowlist — the null side uses `cat ~/<tail>`, which only a wired
    // allowlist absolves, so a predicate that routes reads (or routes everything)
    // fails one of the two sides. The returned string is the telemetry subject, so it
    // must be the canonical absolute path, not the spelling that was typed.
    const reg = transcriptModRegistration(regSpec());

    expect(reg.matches?.(shellCall(`echo forged >> ~/${TRANSCRIPT_TAIL}`))).toBe(TRANSCRIPT);
    expect(reg.matches?.(shellCall(`cat ~/${TRANSCRIPT_TAIL}`))).toBeNull();
  });

  it('a degenerate transcriptPath builds an inert registration: matches returns null for the forgery', () => {
    // Same audit contract on the factory seam. Mutation caught: '' passed through to a
    // matches closure that still routes on it — every call would route with subject ''
    // and die at the body's config gate, a total lock-up out of one empty string.
    const reg = transcriptModRegistration(regSpec({ transcriptPath: '' }));

    expect(reg.matches?.(shellCall(`echo forged >> ~/${TRANSCRIPT_TAIL}`))).toBeNull();
  });

  it('witness passes through when provided and stays absent when omitted', () => {
    // Mutation caught: the factory dropping the witness (the TTL witness valve silently
    // stops applying to this registration) or manufacturing one when none was given.
    const witness = () => true;

    expect(transcriptModRegistration(regSpec({ witness: witness })).witness).toBe(witness);
    expect(transcriptModRegistration(regSpec()).witness).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// transcript-mod-body CLI (COVENANT-07c) — real compiled artifact, mirroring
// the self-mod / shell-mod body-spawn idiom.
// ---------------------------------------------------------------------------

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const bodyPath = fileURLToPath(new URL('../dist/transcript-mod-body.js', import.meta.url));

beforeAll(() => {
  execFileSync('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@polydeukes/covenant'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
}, 120_000);

describe('transcript-mod-body CLI (COVENANT-07c)', () => {
  /** The argv mirror of baseSpec()'s injected values (home included). */
  const CONFIG_FLAGS = [
    '--transcript-path',
    TRANSCRIPT,
    '--home',
    HOME,
    '--shell-tool',
    SHELL_TOOL,
    '--command-arg',
    COMMAND_ARG,
    '--mutating-tool',
    'Edit',
    '--mutating-tool',
    'Write',
    '--mutating-tool',
    'NotebookEdit',
  ];

  it('missing --transcript-path yields exit 2 (config fail-closed)', () => {
    // Mutation caught: a body with no file to protect silently degrading to universal
    // uphold (exit 0) instead of refusing the misassembly.
    const result = spawnSync(
      process.execPath,
      [
        bodyPath,
        '--home',
        HOME,
        '--shell-tool',
        SHELL_TOOL,
        '--command-arg',
        COMMAND_ARG,
        '--mutating-tool',
        'Edit',
      ],
      {
        input: JSON.stringify(shellCall(`echo forged >> ~/${TRANSCRIPT_TAIL}`)),
        encoding: 'utf-8',
      },
    );

    expect(result.status).toBe(2);
  });

  it('an unknown flag yields exit 2 (config fail-closed)', () => {
    // Mutation caught: unrecognized argv silently ignored — a typo'd flag in assembly
    // must not degrade into a differently-configured judge.
    const result = spawnSync(process.execPath, [bodyPath, ...CONFIG_FLAGS, '--unknown-flag', 'x'], {
      input: JSON.stringify(shellCall(`cat ${TRANSCRIPT}`)),
      encoding: 'utf-8',
    });

    expect(result.status).toBe(2);
  });

  it('a flag token in a value position yields exit 2 (config fail-closed)', () => {
    // The shifted-grid regression the sibling bodies pinned: a dropped value makes the
    // next '--' token a value while the pair count still looks valid. Mutation caught:
    // parseArgv accepting '--home' as the --transcript-path value.
    const result = spawnSync(
      process.execPath,
      [
        bodyPath,
        '--transcript-path',
        '--home',
        HOME,
        '--shell-tool',
        SHELL_TOOL,
        '--command-arg',
        COMMAND_ARG,
        '--mutating-tool',
        'Edit',
      ],
      { input: JSON.stringify(shellCall(`cat ${TRANSCRIPT}`)), encoding: 'utf-8' },
    );

    expect(result.status).toBe(2);
  });

  it('a structurally malformed toolCalls element yields exit 2, never a crash exit code (fail-closed)', () => {
    // `toolCalls: [null]` passes core parseInput (element shapes are a CORE-01 boundary)
    // and would crash the judge — Node exits 1, which the protocol reads as NON-blocking.
    // Mutation caught: the CLI shell not translating a judge throw into the blocking 2.
    const result = spawnSync(process.execPath, [bodyPath, ...CONFIG_FLAGS], {
      input: '{"toolCalls":[null],"subagentSpawns":[],"userMessages":[]}',
      encoding: 'utf-8',
    });

    expect(result.status).toBe(2);
  });

  it('a forged "~" append yields exit 1 with the transcript in the stderr reason', () => {
    // Mutation caught: verdictToExitCode wired backwards (break -> 0), or the break
    // reason not surfaced on stderr — the block would be undiagnosable at the hook.
    const result = spawnSync(process.execPath, [bodyPath, ...CONFIG_FLAGS], {
      input: JSON.stringify(shellCall(`echo forged >> ~/${TRANSCRIPT_TAIL}`)),
      encoding: 'utf-8',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/transcript/i);
  });

  it('a "$HOME" read yields exit 0 (default read-only allowlist with zero allowlist flags)', () => {
    // Mutation caught: the body defaulting to an EMPTY allowlist when no allowlist flag
    // is given — every read of the session would then need the witness (the friction
    // this ladder deliberately removed).
    const result = spawnSync(process.execPath, [bodyPath, ...CONFIG_FLAGS], {
      input: JSON.stringify(shellCall(`cat $HOME/${TRANSCRIPT_TAIL}`)),
      encoding: 'utf-8',
    });

    expect(result.status).toBe(0);
  });
});
