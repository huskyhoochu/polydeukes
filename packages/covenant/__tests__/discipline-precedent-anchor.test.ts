import type { CanonicalTranscript, CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// COVENANT-13b §4.3 / AC 7–10 — the `command` evidence vocabulary stops matching the whole
// command STRING and starts matching each SIMPLE COMMAND, anchored at index 0. Saying
// `npm view yaml` inside an echo, a comment, or any other argument position is a mention,
// not an execution, and a mention must not open a context-family gate. §4.2's execution
// axis rides alongside: only a call the provider saw succeed is evidence at all.
// Neither axis exists yet, so this file is RED by construction.
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.ts';

// ---------------------------------------------------------------------------
// Fixtures. The shell tool name, the command arg name, and the evidence pattern are
// injected assembly values, never source literals — the same convention as the shipped
// precedent suite. Every fixture states its execution outcome explicitly, because
// `succeeded` is one of the two axes under test and a defaulted one would let a negative
// pass for the other axis's reason.
// ---------------------------------------------------------------------------

const ROOT = '/repo';
const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const PRECEDENT_COMMAND = 'npm view ';

type Outcome = 'succeeded' | 'failed' | 'unknown';

type ObservedCall = { name: string; args: Record<string, unknown>; succeeded?: boolean };

/** A shell tool call as the transcript seam now exposes it. */
function shellCall(command: string, outcome: Outcome = 'succeeded'): ObservedCall {
  const call = { name: SHELL_TOOL, args: { [COMMAND_ARG]: command } };
  // 'unknown' omits the field entirely — the shape a provider that cannot read results
  // leaves behind (transcriptFromInput), and the one the gate must refuse.
  if (outcome === 'unknown') return call;
  return { ...call, succeeded: outcome === 'succeeded' };
}

/** Stub the canonical-transcript seam with a fixed tool-call history. */
function transcriptWithToolCalls(calls: ObservedCall[]): CanonicalTranscript {
  return {
    findSubagentInvocations: () => [],
    findUserMessages: () => [],
    findToolCalls: (name?: string) =>
      name === undefined ? calls : calls.filter((call) => call.name === name),
  } as unknown as CanonicalTranscript;
}

const whenEntry: DisciplineEntry = {
  id: 'dep-needs-view',
  in: ['pkg/**'],
  when: 'needs-precedent',
  requirePrecedent: { command: PRECEDENT_COMMAND },
};

/** A change under the entry's scope whose added content fires its `when` trigger. */
const TRIGGERING_INPUT: CovenantInput = {
  toolCalls: [
    { name: 'Write', fileChange: { kind: 'create', path: 'pkg/a.ts', post: 'needs-precedent\n' } },
  ],
  subagentSpawns: [],
  userMessages: [],
};

function contextSpec(entry: DisciplineEntry, calls: ObservedCall[]): CompileDisciplinesSpec {
  return {
    disciplines: [entry],
    rootDir: ROOT,
    shellTools: [SHELL_TOOL],
    commandArgs: [COMMAND_ARG],
    transcript: transcriptWithToolCalls(calls),
  };
}

/**
 * What the assembly decided, by name rather than by exit-shaped proxy. `none` means the
 * entry compiled to a body-less skip registration — a disposition that must never stand in
 * for a judged verdict, since a skip passes the edit through.
 *
 * Since DISPATCH-01 the decision is bound INTO the judge thunk rather than serialized as an
 * argv flag, so it is read where it now lives: hand the thunk an input that fires the
 * entry's trigger, and the verdict names the decision — an uphold means the evidence was
 * found, a break means it was missing.
 */
type Decision = 'found' | 'missing' | 'none';

async function precedentDecision(
  calls: ObservedCall[],
  entry: DisciplineEntry = whenEntry,
): Promise<Decision> {
  const [registration] = compileDisciplineRegistrations(contextSpec(entry, calls));
  if (registration?.body === undefined) return 'none';
  const outcome = await registration.body(TRIGGERING_INPUT);
  return outcome.exitCode === 0 ? 'found' : 'missing';
}

// ===========================================================================
// AC 7 — the five rows of the §4.3 table
// ===========================================================================

describe('COVENANT-13b §4.3 command evidence — anchored at a simple command (AC 7)', () => {
  it('refuses a quoted mention inside an echo, while the same words alone still qualify', async () => {
    // P0 the forgery the shipped judge accepts today: `echo "npm view yaml"` costs one line
    // and opens the gate, which makes the archived PRD's justification ("the cheapest way
    // through this gate is to actually call the tool") false. The tokenizer does not
    // preserve quoting, so the joined words read `echo npm view yaml` — the pattern is
    // present, only not at the start. The second assertion is the vacuity control: it proves
    // the pattern really can match this vocabulary, so the first line is pinned to the
    // anchor rather than to a pattern that matches nothing. Mutation caught: the
    // whole-string regex left in place.
    expect(await precedentDecision([shellCall('echo "npm view yaml"')])).toBe('missing');
    expect(await precedentDecision([shellCall('npm view yaml')])).toBe('found');
  });

  it('refuses a quoted mention that occupies the command position itself', async () => {
    // P0 the forgery the first anchor implementation still let through (PR #40 review).
    // The tokenizer STRIPS quotes, so `"npm view yaml"` becomes a single word whose text
    // is `npm view yaml` — and joining that one word produces a string byte-identical to
    // the join of a genuine three-word run. The earlier fixtures all placed the quoted
    // mention AFTER a word, so the index was pushed off 0 and the hole never showed.
    // `|| true` makes the line exit 0 (bash fails to exec a program by that literal name),
    // so the execution axis passes it too and the anchor is the only thing standing.
    // Mutation caught: joining raw word text, which cannot distinguish one quoted word
    // from the several words it spells.
    expect(await precedentDecision([shellCall('"npm view yaml" || true')])).toBe('missing');
    expect(await precedentDecision([shellCall("'npm view yaml' ; true")])).toBe('missing');
    expect(await precedentDecision([shellCall('npm view yaml')])).toBe('found');
  });

  it('still accepts a quoted argument once the command name is real', async () => {
    // P0 over-block fence paired with the test above: the fix must reject a quoted word in
    // the COMMAND position without rejecting quoted arguments, which are ordinary usage.
    // Mutation caught: dropping every space-bearing word (or refusing the whole simple
    // command), which would silently stop `npm view "some pkg"` from counting.
    expect(await precedentDecision([shellCall('npm view "some pkg"')])).toBe('found');
  });

  it('accepts a command run inside a shell compound', async () => {
    // P0 over-block found by review. `for`/`while`/`if` bodies are split on `;` like any
    // other list, so the simple command carries the shell KEYWORD as its first word and the
    // pattern lands at index 3 — a command that demonstrably ran stops being evidence, and
    // re-running the same loop never helps. Unlike an assignment prefix this is not a
    // command in front of a command: `do` and `then` are grammar, not programs. Mutation
    // caught: anchoring without first stepping past the keyword.
    expect(
      await precedentDecision([shellCall('for p in yaml zod; do npm view $p version; done')]),
    ).toBe('found');
    expect(
      await precedentDecision([
        shellCall('if [ -f package.json ]; then npm view yaml version; fi'),
      ]),
    ).toBe('found');
  });

  it('refuses a mention parked behind a comment marker', async () => {
    // P0 the second mention shape, and it fails a DIFFERENT implementation than the quoted
    // one: the tokenizer does not strip `#` comments, so here the pattern's words are
    // genuine separate tokens of a genuine simple command — an implementation that only
    // learned to see through quotes still accepts this. Index 9, not 0. The trailing `yaml`
    // matters: the pattern ends in a space, so without a following word it would not match
    // anywhere and this test would pass while the anchor slept.
    expect(await precedentDecision([shellCall('ls -la # npm view yaml')])).toBe('missing');
  });

  it('accepts the command when it is the SECOND simple command of a chain', async () => {
    // P0 the anchor must not be vacuous. An implementation that tests only the first simple
    // command — or that anchors the raw command line instead of each simple command — passes
    // every single-command fixture in this file and silently rejects
    // `cd pkg && npm view yaml`, which is how people actually run things. That is
    // over-blocking, the failure mode that ends with the gate switched off. Mutation caught:
    // only commands[0] examined, or the anchor applied to the joined line rather than per
    // simple command.
    expect(await precedentDecision([shellCall('cd pkg && npm view yaml')])).toBe('found');
  });

  it('refuses a chained command the shell never reached, though the anchor accepts its shape', async () => {
    // P0 the two axes meeting. `false && npm view zzz` anchors perfectly at the second
    // simple command, so the anchor alone would call this evidence; the exit status is what
    // excludes it. The succeeded-true control is not decoration — it proves the anchor DID
    // accept this command line, which pins the refusal to the execution axis instead of
    // letting an anchor bug answer for it. Mutation caught: the outcome ignored, so a
    // command that provably never ran counts as having run.
    expect(await precedentDecision([shellCall('false && npm view zzz', 'failed')])).toBe('missing');
    expect(await precedentDecision([shellCall('false && npm view zzz', 'succeeded')])).toBe(
      'found',
    );
  });

  it('refuses a heredoc body that spells the command, reading only the words', async () => {
    // P0 the forgery a thorough implementation invites. A simple command carries three word
    // sources — `words`, redirect targets, and heredoc bodies — and the tokenizer keeps them
    // apart correctly. The danger is downstream: joining "everything the command mentions"
    // reads like completeness but means anyone can forge evidence by writing the command
    // into a document. Only `words` is a command position. The control proves the pattern
    // matches this vocabulary, so the refusal is the join's doing. Mutation caught: heredoc
    // bodies (or redirect targets) folded into the joined string.
    const heredoc = "cat <<'EOF' > notes.md\nnpm view yaml\nEOF";

    expect(await precedentDecision([shellCall(heredoc)])).toBe('missing');
    expect(await precedentDecision([shellCall('npm view yaml')])).toBe('found');
  });

  it('refuses a simple command with no words at all', async () => {
    // P0 the degenerate anchor. A redirect-only command (`> out.txt`) has an empty word list,
    // so the joined string is `''` — and a pattern able to match the empty string anchors
    // there at index 0, letting a line that executed nothing open the gate. Index 0 is a
    // necessary condition for evidence, never a sufficient one; an empty join has no command
    // to have run. Mutation caught: the anchor applied without first requiring a word.
    const optionalEntry: DisciplineEntry = {
      ...whenEntry,
      requirePrecedent: { command: '(npm view )?' },
    };

    expect(await precedentDecision([shellCall('> out.txt')], optionalEntry)).toBe('missing');
    expect(await precedentDecision([shellCall('npm view yaml')], optionalEntry)).toBe('found');
  });

  it('refuses an assignment prefix — a documented over-block, pinned so it stays deliberate', async () => {
    // P1 pins a limit rather than a defect (§4.6). Unlike `sudo npm view`, bash treats
    // `FOO=1 npm view yaml` as ONE simple command, so the "someone put another command in
    // front" reasoning does not explain this refusal — the assignment lives inside the very
    // command that matters. It is refused anyway, because the alternative is a skip-the-
    // assignment approximation, and this project has twice measured that stacked
    // approximations produce one over-block and one bypass each (COVENANT-07b). The recovery
    // path is the same standalone re-run. If this test ever turns red, someone added the
    // approximation on purpose and must say so in the PRD.
    expect(await precedentDecision([shellCall('FOO=1 npm view yaml')])).toBe('missing');
    expect(await precedentDecision([shellCall('npm view yaml')])).toBe('found');
  });
});

// ===========================================================================
// AC 8 — an untokenizable command line is not evidence
// ===========================================================================

describe('COVENANT-13b §4.3 command evidence — an unread span (AC 8)', () => {
  it('refuses a command line with an unclosed quote, judging it rather than skipping the entry', async () => {
    // P0 fail-closed direction. Since COVENANT-18 §2-b B4 the scanner DOES read this line's
    // first half, and this consumer still refuses it — deliberately, because its polarity is
    // inverted: everywhere else `false` withholds a block, but here it means "evidence
    // missing", which blocks. Trusting the half we read would OPEN a discipline gate on a
    // line nobody could finish reading. Note the raw string BEGINS with the pattern, so a
    // whole-string judge calls this evidence; only a tokenize-first one refuses it. The
    // assertion is `missing`, not merely "not found": the refusal must not escalate into
    // "this entry cannot be evaluated", because a skip registration passes the edit through
    // unjudged. Mutation caught: the refusal swallowed as a skip, or the read commands
    // trusted for anchoring while a span is still unread.
    expect(await precedentDecision([shellCall('npm view "yaml')])).toBe('missing');
  });

  it('lets a clean sibling call still supply the evidence', async () => {
    // P0 over-block fence: one half-read line anywhere in a long session must not poison
    // the scan. Mutation caught: the evaluator returning false at the first line carrying a
    // span instead of moving on to the next call, which would make a single stray quote
    // somewhere in the session permanently unopenable — and nothing in the telemetry would
    // say why.
    expect(
      await precedentDecision([shellCall('npm view "yaml'), shellCall('npm view react')]),
    ).toBe('found');
  });
});

// ===========================================================================
// AC 9 — the pattern stays a regex; the anchor is a position, not a rewrite
// ===========================================================================

describe('COVENANT-13b §4.3 command evidence — anchoring by position, not by pattern rewrite (AC 9)', () => {
  it('anchors every branch of an alternation, not just the first', async () => {
    // P0 the seductive one-line implementation: `new RegExp('^' + pattern)`. For an
    // alternation that binds `^` to the FIRST branch only — `^npm view |pnpm view ` reads as
    // "starts with npm view" OR "contains pnpm view anywhere" — so the second branch is
    // silently left unanchored and `echo "pnpm view yaml"` forges evidence again. Every
    // other test in this file passes under that mutation. The control proves the branch
    // itself is live, so the refusal is pinned to position rather than to a pattern that
    // never matches. Mutation caught: exactly that string concatenation (a non-capturing
    // wrap, or an index check, both survive).
    const alternationEntry: DisciplineEntry = {
      ...whenEntry,
      requirePrecedent: { command: 'npm view |pnpm view ' },
    };

    expect(await precedentDecision([shellCall('echo "pnpm view yaml"')], alternationEntry)).toBe(
      'missing',
    );
    expect(await precedentDecision([shellCall('pnpm view yaml')], alternationEntry)).toBe('found');
  });

  it('refuses a call whose outcome the provider could not observe', async () => {
    // P0 self-evidence fail-open: `transcriptFromInput` leaves `succeeded` absent because
    // its tool calls are the call being judged right now. Accepting an absent outcome would
    // make the input its own precedent, and every direct-API surface would judge itself
    // compliant. The rule is `succeeded === true`, not `succeeded !== false`. The control
    // pins the refusal to the outcome axis rather than to this command line. Mutation
    // caught: a truthiness or not-false test in place of the strict comparison.
    expect(await precedentDecision([shellCall('npm view yaml', 'unknown')])).toBe('missing');
    expect(await precedentDecision([shellCall('npm view yaml', 'succeeded')])).toBe('found');
  });
});

// ===========================================================================
// AC 10 — §4.6's over-blocking is friction, not a dead end
// ===========================================================================

describe('COVENANT-13b §4.6 command evidence — the recovery path stays open (AC 10)', () => {
  it('reopens the gate when the required command is re-run on its own after a compound failure', async () => {
    // P0 the contract that makes §4.6's known over-block survivable. The two axes judge at
    // different granularities: the anchor sees individual simple commands, the outcome is
    // one exit code for the whole line. So `npm view yaml && grep zzz pkg` — where the view
    // really ran and only the grep failed — is refused. That refusal is acceptable ONLY
    // because running the command alone still opens the gate; if it did not, a user who did
    // exactly what the discipline demanded would be blocked with no way forward but the
    // witness, and a witness used daily is a gate already switched off.
    //
    // The mutation this is really aimed at: first-match-wins. An evaluator that finds the
    // first call whose command matches and returns ITS outcome answers `missing` here, and
    // the gate stays shut no matter how many times the command is re-run. The failed call is
    // deliberately placed FIRST, because with the success first that mutation would answer
    // `found` and hide.
    const failedCompound = shellCall('npm view yaml && grep zzz pkg', 'failed');

    expect(await precedentDecision([failedCompound])).toBe('missing');
    expect(await precedentDecision([failedCompound, shellCall('npm view yaml', 'succeeded')])).toBe(
      'found',
    );
  });

  it('accepts a command the shell short-circuited past — the under-blocking half, on purpose', async () => {
    // P1 pins the OTHER end of the same granularity gap, the one nobody would write a test
    // for because it looks like a bug. `true || npm view yaml` exits 0 while the view never
    // ran, so both axes say evidence: the anchor matches the second simple command and the
    // line succeeded. Shell control flow is outside what a transcript can answer, and §4.6
    // accepts that rather than approximating it. Recording the pass as intended is what
    // stops a future reader from "fixing" it with a control-flow heuristic and paying for it
    // on the over-blocking side, where the cost lands on people obeying the discipline.
    expect(await precedentDecision([shellCall('true || npm view yaml', 'succeeded')])).toBe(
      'found',
    );
  });
});
