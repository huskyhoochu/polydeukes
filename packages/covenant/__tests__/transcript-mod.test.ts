import type { CovenantInput, FileChange } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_READ_ONLY_COMMANDS } from '../src/shell-mod.ts';
import {
  judgeTranscriptModification,
  type TranscriptModificationSpec,
  type TranscriptModRegistrationSpec,
  transcriptModRegistration,
} from '../src/transcript-mod.ts';

// The transcript-mod predicate protects EXACTLY ONE FILE, by whole-path equality across every
// spelling, never as an ancestor. The judge receives HOME as data and reads no environment
// itself, so the home value is injected like every other fixture.

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

/** Build a CovenantInput with a single call carrying its own nested evidence. */
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

describe('judgeTranscriptModification — Bash axis break direction', () => {
  it('an append redirect through the "~" spelling breaks', () => {
    // Without home-spelling normalization the raw segments ['~', ...] never equal
    // ['home', 'u', ...], so a forgery appending a fake human utterance — which the TTL witness
    // then reads as proof a human spoke — sails through.
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
    // The redirect-write rule stays silent on an opaque target, so a judge relying on the
    // rules alone never compares the target TEXT — which normalizes to the transcript.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> $HOME/${TRANSCRIPT_TAIL}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('an append redirect through the brace-form $-HOME spelling breaks', () => {
    // The brace form is a one-character variation of the same forgery and belongs to the same
    // closed spelling set.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> \${HOME}/${TRANSCRIPT_TAIL}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('an append redirect through the "~<user>" spelling breaks (user = last home segment)', () => {
    // `~u/<tail>` names the same file when HOME is /home/u, so the `~<user>/` form has to be
    // derived from the injected home value rather than only the bare `~/` handled.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> ~u/${TRANSCRIPT_TAIL}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('an append redirect naming the absolute transcript path breaks (the pre-07c defence survives the move)', () => {
    // A predicate judging home spellings ONLY trades one hole for another: the absolute
    // comparison has to stand alongside them.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> ${TRANSCRIPT}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('rm of the transcript breaks (backstop: mention without read-only proof)', () => {
    // A plain rm has no redirect and trips no mutation rule, so only the mention backstop
    // stops the evidence file from being deleted.
    const verdict = judgeTranscriptModification(shellCall(`rm ~/${TRANSCRIPT_TAIL}`), baseSpec());

    expect(verdict.upheld).toBe(false);
  });

  it('chmod 000 through the "$HOME" spelling breaks (the mention scan reads opaque word text)', () => {
    // This ladder has no opaque-mention clause of its own, so an opaque token whose TEXT
    // normalizes to the transcript has to register as a mention for the backstop to answer.
    const verdict = judgeTranscriptModification(
      shellCall(`chmod 000 $HOME/${TRANSCRIPT_TAIL}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('a piped tee onto the transcript breaks (tee writes with no redirect operator)', () => {
    // tee is the second command on the line, so judging only the first misses it; so does
    // leaving the rule's target un-normalized before the equality comparison.
    const verdict = judgeTranscriptModification(
      shellCall(`cat /tmp/x | tee ~/${TRANSCRIPT_TAIL}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('a dot-resolved spelling of the transcript breaks (07b union carried into the equality)', () => {
    // `~/.claude/../<tail>` resolves to the transcript while its raw segments differ, so the
    // equality needs the interior-dot pass every other judge already has.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> ~/.claude/../${TRANSCRIPT_TAIL}`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('a half-read line carrying the "~" spelling breaks (home resolution)', () => {
    // An unclosed quote sitting next to the forgery must not save it. The forgery is in the
    // READ half, so the home spelling has to resolve inside precise judgment and not only in
    // the span scan.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> ~/${TRANSCRIPT_TAIL} "unclosed`),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('a read of the transcript into an opaque redirect target breaks (opaque write target clause)', () => {
    // `$OUT` could resolve to the transcript itself, so the allowlisted `cat` head must not
    // absolve the mention.
    const verdict = judgeTranscriptModification(shellCall(`cat ${TRANSCRIPT} > $OUT`), baseSpec());

    expect(verdict.upheld).toBe(false);
  });

  it('a candidate carrying a glued flag or operator still names the transcript', () => {
    // Whole-path equality reads the candidate as one string, and no splitter separates `-o` or
    // `>>` from the path fused to it. An offset-tolerant comparison catches these incidentally;
    // equality alone loses them, and every one overwrites the file the witness reads.
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
    // The shell expands the prefix and THEN resolves dots. Resolving first cancels the `~`
    // itself against the `..` and leaves a path naming nothing, upholding a spelling bash
    // delivers straight to the transcript.
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

describe('judgeTranscriptModification — Bash axis uphold direction', () => {
  it('cd ~, cd $HOME, and mv x ~ uphold (non-allowlisted heads with a bare home argument)', () => {
    // cd and mv are NOT read-only entries, so no absolution can rescue a false mention here:
    // an ancestor-matching predicate blocks all three at the backstop, with no valve but the
    // human-typed witness.
    expect(judgeTranscriptModification(shellCall('cd ~'), baseSpec())).toEqual({ upheld: true });
    expect(judgeTranscriptModification(shellCall('cd $HOME'), baseSpec())).toEqual({
      upheld: true,
    });
    expect(judgeTranscriptModification(shellCall('mv x ~'), baseSpec())).toEqual({ upheld: true });
  });

  it('cd into the literal absolute home upholds — the over-block dissolves', () => {
    // Listing the transcript among the protected paths makes home a protected ANCESTOR and
    // blocks `cd /home/<user>`. Building this predicate on the shared ancestor/descendant
    // primitive instead of file equality reproduces that.
    expect(judgeTranscriptModification(shellCall(`cd ${HOME}`), baseSpec())).toEqual({
      upheld: true,
    });
  });

  it('rm -rf of transcript ancestor directories upholds — out of observation scope BY DESIGN', () => {
    // A designed pass, pinned so it stays visible: the predicate protects the transcript FILE
    // only, and out-of-repo ancestor destruction is outside this project's observation scope,
    // owned by the agent's own deny policy. Widening the equality toward ancestors grows the
    // home ancestor back under a new name.
    expect(judgeTranscriptModification(shellCall('rm -rf ~/.claude'), baseSpec())).toEqual({
      upheld: true,
    });
    expect(judgeTranscriptModification(shellCall('rm -rf ~/.claude/projects'), baseSpec())).toEqual(
      { upheld: true },
    );
  });

  it('reads of the transcript uphold in every spelling (read-only absolution, no opaque-mention clause)', () => {
    // Reading a session must never need a witness. The `$HOME` read is the deliberate
    // divergence from shell-mod's ladder: there is NO opaque-mention block clause here, so a
    // fully normalized opaque spelling under a read-only head is a proven read. Copying
    // shell-mod's opaque clause over re-blocks `cat $HOME/<tail>`.
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
    // `sess*.jsonl` needs the filesystem to resolve and the judge does not guess; the
    // disciplines layer owns the skip record for it. Glob-aware matching bolted onto the
    // equality would also block unrelated files sharing the prefix.
    const verdict = judgeTranscriptModification(
      shellCall('echo forged >> ~/.claude/projects/-home-u-proj/sess*.jsonl'),
      baseSpec(),
    );

    expect(verdict).toEqual({ upheld: true });
  });

  it('a different user\'s "~other" spelling upholds (username equality, not prefix)', () => {
    // The `~<user>` form is derived from the injected home value's own last segment, so
    // `~other` closes nothing; treating any `~<word>/` prefix as this home would.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> ~other/${TRANSCRIPT_TAIL}`),
      baseSpec(),
    );

    expect(verdict).toEqual({ upheld: true });
  });

  it('a half-read line not naming the transcript upholds, and empty toolCalls upholds', () => {
    // An unread span defaulting to break sends every malformed line to the witness, and a
    // degenerate input must uphold vacuously rather than break.
    expect(judgeTranscriptModification(shellCall('echo "unclosed'), baseSpec())).toEqual({
      upheld: true,
    });
    const empty: CovenantInput = { toolCalls: [], subagentSpawns: [], userMessages: [] };
    expect(judgeTranscriptModification(empty, baseSpec())).toEqual({ upheld: true });
  });

  it('a foreign-rooted path embedding the transcript run upholds (equality, never containment)', () => {
    // A backup copy under another root embeds the transcript's whole segment run at an offset,
    // so the shared mention primitive's contains-segment-run match blocks operations on mere
    // copies. The contract here is one file, by whole-path equality.
    const verdict = judgeTranscriptModification(shellCall(`rm /backup${TRANSCRIPT}`), baseSpec());

    expect(verdict).toEqual({ upheld: true });
  });

  it('a sibling sharing the transcript name as a prefix upholds (segment-text equality)', () => {
    // `session.jsonl.bak` shares every segment but the last one's text, so an
    // includes/startsWith/endsWith shortcut blocks the transcript's own backup — a file the
    // predicate never owned.
    const verdict = judgeTranscriptModification(
      shellCall(`echo forged >> ~/${TRANSCRIPT_TAIL}.bak`),
      baseSpec(),
    );

    expect(verdict).toEqual({ upheld: true });
  });
});

describe('judgeTranscriptModification — home-shape validation', () => {
  const tildeForgery = shellCall(`echo forged >> ~/${TRANSCRIPT_TAIL}`);
  const absoluteForgery = shellCall(`echo forged >> ${TRANSCRIPT}`);

  it('an invalid home (undefined, empty, "/", "///", relative) leaves home spellings open but the absolute spelling judged', () => {
    // Shape validation lives INSIDE the judge, per call, and both directions fail here at
    // once: an invalid home expanded anyway manufactures matches from garbage — '' turns `~/x`
    // into `/x`, '/' doubles into '//' — while disabling the whole judgment on an invalid home
    // drops the absolute-spelling defence too.
    for (const home of [undefined, '', '/', '///', 'foo/bar']) {
      expect(judgeTranscriptModification(tildeForgery, baseSpec({ home }))).toEqual({
        upheld: true,
      });
      expect(judgeTranscriptModification(absoluteForgery, baseSpec({ home })).upheld).toBe(false);
    }
  });

  it('a home with trailing slashes normalizes and still closes the spellings', () => {
    // `/home/u/` is the commonest environment spelling: failing a `startsWith('<home>/')`
    // check, or building a double-slash tail, silently reopens every home spelling for it.
    for (const home of ['/home/u/', '/home/u//']) {
      expect(judgeTranscriptModification(tildeForgery, baseSpec({ home })).upheld).toBe(false);
    }
  });

  it('a transcript outside the given home leaves home spellings inert but the absolute spelling judged', () => {
    // HOME and the transcript path arrive from different sources and can disagree. A tail
    // computed by blind slicing — transcriptPath minus home.length — is garbage under
    // /home/other, and it must close nothing while the absolute defence stays.
    const outside = baseSpec({ home: '/home/other' });

    expect(judgeTranscriptModification(tildeForgery, outside)).toEqual({ upheld: true });
    expect(judgeTranscriptModification(absoluteForgery, outside).upheld).toBe(false);
  });
});

describe('judgeTranscriptModification — degenerate transcript path', () => {
  it('a zero-segment transcriptPath ("", "/", ".") is inert: forged appends uphold and nothing throws', () => {
    // A degenerate transcript path makes the registration INERT, following the same
    // convention as an empty protected-path entry: ignored, never a total lock-up. The hook
    // only checks that transcript_path is a string, so an empty one reaches this layer, where
    // an endsWith-style shortcut would match every candidate and block every call.
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

describe('judgeTranscriptModification — tool axis', () => {
  it('modify evidence naming the transcript breaks', () => {
    // An Edit writing the transcript directly, with no shell involved, is the forgery with the
    // fewest steps.
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
    // With home normalization applied to Bash candidates only, a producer reporting its target
    // home-relative slips the same file past the tool axis.
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
    // Deleting the evidence source is a modification of the surface, and with no args the
    // evidence is the only signal. An evidence comparison keyed on kinds carrying `post` skips
    // delete silently and lets the witness's data source be removed unjudged.
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
    // An edit whose CONTENT merely carries a bare `~` must not be refused. Consulting args on
    // the evidence branch — a defensive "also scan args" clause — re-conflates a mention with
    // a target.
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
    // An evidence-free producer — a failed apply, a new adapter — can name the transcript in
    // file_path, and without the fallback it passes unjudged.
    const verdict = judgeTranscriptModification(
      inputWithToolCall('Write', { file_path: `~/${TRANSCRIPT_TAIL}`, content: 'forged' }),
      baseSpec(),
    );

    expect(verdict.upheld).toBe(false);
  });

  it('an evidence-free mutating call whose args carry only a bare "~" upholds (equality, not ancestor)', () => {
    // A fallback walking args with ancestor semantics blocks a NotebookEdit whose cell text
    // mentions `~`, with a reason naming a file it never touched.
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
    // Junk evidence counted as proof suppresses the fallback, and a stub then absolves a call
    // whose args name the transcript.
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
    // A Read of the transcript stays free without any allowlist involved, so judging every
    // tool by args mention regardless of name blocks it.
    const verdict = judgeTranscriptModification(
      inputWithToolCall('Read', { file_path: TRANSCRIPT }),
      baseSpec(),
    );

    expect(verdict).toEqual({ upheld: true });
  });
});

describe('transcriptModRegistration — factory shape', () => {
  /** A forgery the judge must break on — the input every axis assertion below binds. */
  const FORGERY = shellCall(`echo forged >> ~/${TRANSCRIPT_TAIL}`);

  function regSpec(
    overrides: Partial<TranscriptModRegistrationSpec> = {},
  ): TranscriptModRegistrationSpec {
    return {
      transcriptPath: TRANSCRIPT,
      home: HOME,
      shellTools: [SHELL_TOOL],
      commandArgs: [COMMAND_ARG],
      mutatingTools: MUTATING_TOOLS,
      ...overrides,
    };
  }

  it('builds the transcript-mod registration with EMPTY protectedPaths and a judging thunk', async () => {
    // protectedPaths MUST be []: any entry there re-enters path-mention routing and recreates
    // the home ancestor. The axes reach the judge by closure rather than argv, so the wiring is
    // proven by what the thunk ANSWERS — a `~`-spelled shell forgery breaks only if the shell
    // tool, the command arg and the home value are all bound.
    const reg = transcriptModRegistration(regSpec());

    expect(reg.label).toBe('transcript-mod');
    expect(reg.protectedPaths).toEqual([]);
    expect(typeof reg.body).toBe('function');
    const outcome = await reg.body?.(FORGERY);
    expect(outcome?.exitCode).toBe(1);
    expect(outcome?.reason).toContain(TRANSCRIPT);
  });

  it('the mutating-tool axis reaches the judge: a tool-axis forgery breaks', async () => {
    // A silently dropped axis is proven absent by judging an input only that axis can break.
    const reg = transcriptModRegistration(regSpec());

    const outcome = await reg.body?.(
      inputWithToolCall('Write', { file_path: TRANSCRIPT, content: 'x' }),
    );
    expect(outcome?.exitCode).toBe(1);
    expect(outcome?.reason).toContain(TRANSCRIPT);
  });

  it('an omitted home leaves the `~` spelling unjudged, degrading to the absolute-only judgment', async () => {
    // An absent home closes no home spelling at all. A bogus value smuggled in its place —
    // the string 'undefined', or an empty one — manufactures matches instead, since an empty
    // home turns `~/x` into `/x`.
    const { home: _home, ...withoutHome } = regSpec();
    const reg = transcriptModRegistration(withoutHome);

    const outcome = await reg.body?.(FORGERY);
    expect(outcome?.exitCode).toBe(0);
  });

  it('matches runs the judge: the transcript path for a forgery, null for an allowlisted read', () => {
    // The null side uses `cat ~/<tail>`, which only a wired allowlist absolves, so a matches
    // closure wired to a constant or to a judge without the default allowlist fails one of the
    // two sides. The returned string is the telemetry subject, so it is the canonical absolute
    // path rather than the spelling that was typed.
    const reg = transcriptModRegistration(regSpec());

    expect(reg.matches?.(shellCall(`echo forged >> ~/${TRANSCRIPT_TAIL}`))).toBe(TRANSCRIPT);
    expect(reg.matches?.(shellCall(`cat ~/${TRANSCRIPT_TAIL}`))).toBeNull();
  });

  it('a degenerate transcriptPath builds an inert registration: matches returns null for the forgery', () => {
    // The inert contract at the factory seam: '' passed through to a matches closure that
    // still routes on it makes every call route with subject '' and die at the body's config
    // gate — a total lock-up out of one empty string.
    const reg = transcriptModRegistration(regSpec({ transcriptPath: '' }));

    expect(reg.matches?.(shellCall(`echo forged >> ~/${TRANSCRIPT_TAIL}`))).toBeNull();
  });

  it('witness passes through when provided and stays absent when omitted', () => {
    // A dropped witness silently stops the valve applying to this registration; a
    // manufactured one opens a valve nobody asked for.
    const witness = () => true;

    expect(transcriptModRegistration(regSpec({ witness: witness })).witness).toBe(witness);
    expect(transcriptModRegistration(regSpec()).witness).toBeUndefined();
  });
});

// The judge thunk the builder composes, exercised as the dispatcher runs it: axes bound at
// assembly, the call set passed at judgment.

/** Judge a payload through the registration builder's thunk, with the standard axes. */
async function judgeThroughThunk(input: CovenantInput): Promise<{
  exitCode: number;
  reason?: string;
}> {
  const reg = transcriptModRegistration({
    transcriptPath: TRANSCRIPT,
    home: HOME,
    shellTools: [SHELL_TOOL],
    commandArgs: [COMMAND_ARG],
    mutatingTools: MUTATING_TOOLS,
  });
  return (await reg.body?.(input)) ?? { exitCode: 2 };
}

describe('transcript-mod judge thunk', () => {
  it('a structurally malformed toolCalls element yields the exit-2 equivalent, never a crash', async () => {
    // `toolCalls: [null]` passes core's parse — element shapes are an unvalidated boundary —
    // and crashes the judge, which uncaught escapes the wrapper as a rejection instead of a
    // blocking outcome.
    const result = await judgeThroughThunk({
      toolCalls: [null],
      subagentSpawns: [],
      userMessages: [],
    } as unknown as CovenantInput);

    expect(result.exitCode).toBe(2);
  });

  it('a forged "~" append yields exit 1 with the transcript in the reason', async () => {
    // The wrapper writes this reason string to stderr, so dropping it leaves the block
    // undiagnosable at the hook.
    const result = await judgeThroughThunk(shellCall(`echo forged >> ~/${TRANSCRIPT_TAIL}`));

    expect(result.exitCode).toBe(1);
    expect(result.reason).toMatch(/transcript/i);
  });

  it('a "$HOME" read yields exit 0 (default read-only allowlist)', async () => {
    // A builder defaulting to an EMPTY allowlist sends every read of the session to the
    // witness.
    const result = await judgeThroughThunk(shellCall(`cat $HOME/${TRANSCRIPT_TAIL}`));

    expect(result.exitCode).toBe(0);
  });
});
