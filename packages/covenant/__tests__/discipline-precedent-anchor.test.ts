import type { CanonicalTranscript, CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// Command evidence is judged on two axes: the pattern must match at the START of a simple
// command (a mention inside an echo, a comment, or any argument position is not an
// execution), and only a call the provider saw succeed counts at all.
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.ts';

// No fixture here drives a shell-derived write, so the injected pre-state reader is never
// consulted; `null` — the file is not there — is the answer that would make a create if one
// ever were.
const readPreState = () => null;

// Every fixture states its execution outcome explicitly: `succeeded` is one of the two axes
// under test, so a defaulted outcome would let a negative pass for the other axis's reason.

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
    readPreState,
    transcript: transcriptWithToolCalls(calls),
  };
}

/**
 * What the assembly decided, by name rather than by exit-shaped proxy. `none` means the
 * entry compiled to a body-less skip registration — a disposition that must never stand in
 * for a judged verdict, since a skip passes the edit through.
 *
 * The decision is bound into the judge thunk, so it is read by handing the thunk an input
 * that fires the entry's trigger: an uphold means the evidence was found, a break missing.
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

describe('command evidence — anchored at a simple command', () => {
  it('refuses a quoted mention inside an echo, while the same words alone still qualify', async () => {
    // The tokenizer does not preserve quoting, so the joined words read `echo npm view yaml`
    // — the pattern is present, only not at the start. The second assertion is a vacuity
    // control: it proves the pattern really can match this vocabulary, so the first line is
    // pinned to the anchor rather than to a pattern that matches nothing.
    expect(await precedentDecision([shellCall('echo "npm view yaml"')])).toBe('missing');
    expect(await precedentDecision([shellCall('npm view yaml')])).toBe('found');
  });

  it('refuses a quoted mention that occupies the command position itself', async () => {
    // The tokenizer STRIPS quotes, so `"npm view yaml"` becomes a single word whose text is
    // `npm view yaml` — joining that one word produces a string byte-identical to the join
    // of a genuine three-word run. Placing the quoted mention in the COMMAND position is
    // what exposes this; after a word the index is pushed off 0 and the hole never shows.
    // `|| true` makes the line exit 0, so the execution axis passes and the anchor alone
    // stands. Joining raw word text cannot distinguish one quoted word from several.
    expect(await precedentDecision([shellCall('"npm view yaml" || true')])).toBe('missing');
    expect(await precedentDecision([shellCall("'npm view yaml' ; true")])).toBe('missing');
    expect(await precedentDecision([shellCall('npm view yaml')])).toBe('found');
  });

  it('still accepts a quoted argument once the command name is real', async () => {
    // The fence paired with the test above: rejecting a quoted word in the COMMAND position
    // must not reject quoted ARGUMENTS, which are ordinary usage. Dropping every
    // space-bearing word would silently stop `npm view "some pkg"` from counting.
    expect(await precedentDecision([shellCall('npm view "some pkg"')])).toBe('found');
  });

  it('accepts a command run inside a shell compound', async () => {
    // `for`/`while`/`if` bodies are split on `;` like any other list, so the simple command
    // carries the shell KEYWORD as its first word and the pattern lands at index 3. The
    // anchor must step past the keyword: unlike an assignment prefix, `do` and `then` are
    // grammar, not programs, so a command that demonstrably ran must stay evidence.
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
    // A different failure than the quoted mention: the tokenizer does not strip `#`
    // comments, so the pattern's words are genuine separate tokens of a genuine simple
    // command, just not at index 0. The trailing `yaml` matters — the pattern ends in a
    // space, so without a following word it would not match anywhere and this test would
    // pass while the anchor slept.
    expect(await precedentDecision([shellCall('ls -la # npm view yaml')])).toBe('missing');
  });

  it('accepts the command when it is the SECOND simple command of a chain', async () => {
    // The anchor must apply per simple command, not to the first one or to the raw command
    // line. Either shortcut passes every single-command fixture in this file and silently
    // rejects `cd pkg && npm view yaml` — over-blocking, the failure mode that ends with
    // the gate switched off.
    expect(await precedentDecision([shellCall('cd pkg && npm view yaml')])).toBe('found');
  });

  it('refuses a chained command the shell never reached, though the anchor accepts its shape', async () => {
    // The two axes meeting. `false && npm view zzz` anchors perfectly at the second simple
    // command, so the anchor alone would call this evidence; the exit status is what
    // excludes it. The succeeded-true control proves the anchor DID accept this line, which
    // pins the refusal to the execution axis instead of letting an anchor bug answer for it.
    expect(await precedentDecision([shellCall('false && npm view zzz', 'failed')])).toBe('missing');
    expect(await precedentDecision([shellCall('false && npm view zzz', 'succeeded')])).toBe(
      'found',
    );
  });

  it('refuses a heredoc body that spells the command, reading only the words', async () => {
    // A simple command carries three word sources — `words`, redirect targets, and heredoc
    // bodies. Only `words` is a command position: joining "everything the command mentions"
    // reads like completeness but lets anyone forge evidence by writing the command into a
    // document. The control proves the pattern matches this vocabulary, so the refusal is
    // the join's doing.
    const heredoc = "cat <<'EOF' > notes.md\nnpm view yaml\nEOF";

    expect(await precedentDecision([shellCall(heredoc)])).toBe('missing');
    expect(await precedentDecision([shellCall('npm view yaml')])).toBe('found');
  });

  it('refuses a simple command with no words at all', async () => {
    // A redirect-only command (`> out.txt`) has an empty word list, so the joined string is
    // `''` — and a pattern able to match the empty string anchors there at index 0, letting
    // a line that executed nothing open the gate. Index 0 is a necessary condition for
    // evidence, never a sufficient one: the anchor must first require a word.
    const optionalEntry: DisciplineEntry = {
      ...whenEntry,
      requirePrecedent: { command: '(npm view )?' },
    };

    expect(await precedentDecision([shellCall('> out.txt')], optionalEntry)).toBe('missing');
    expect(await precedentDecision([shellCall('npm view yaml')], optionalEntry)).toBe('found');
  });

  it('refuses an assignment prefix — a documented over-block, pinned so it stays deliberate', async () => {
    // A declared limit, not a defect. Bash treats `FOO=1 npm view yaml` as ONE simple
    // command, so "someone put another command in front" does not explain this refusal —
    // the assignment lives inside the very command that matters. It is refused anyway
    // because the alternative is a skip-the-assignment approximation, and stacked
    // approximations have twice produced one over-block and one bypass each here. The
    // recovery path is the same standalone re-run.
    expect(await precedentDecision([shellCall('FOO=1 npm view yaml')])).toBe('missing');
    expect(await precedentDecision([shellCall('npm view yaml')])).toBe('found');
  });
});

describe('command evidence — an unread span', () => {
  it('refuses a command line with an unclosed quote, judging it rather than skipping the entry', async () => {
    // This consumer's polarity is inverted from the rest of the scanner: elsewhere `false`
    // withholds a block, but here it means "evidence missing", which blocks. Trusting the
    // half of the line that WAS read would OPEN a discipline gate on a line nobody could
    // finish reading. The raw string BEGINS with the pattern, so a whole-string judge calls
    // this evidence; only a tokenize-first one refuses it. The assertion is `missing`, not
    // merely "not found" — escalating into "cannot be evaluated" would emit a skip
    // registration, which passes the edit through unjudged.
    expect(await precedentDecision([shellCall('npm view "yaml')])).toBe('missing');
  });

  it('lets a clean sibling call still supply the evidence', async () => {
    // One half-read line anywhere in a long session must not poison the scan. Returning
    // false at the first line carrying an unread span, instead of moving on to the next
    // call, would make a single stray quote permanently unopenable — and nothing in the
    // telemetry would say why.
    expect(
      await precedentDecision([shellCall('npm view "yaml'), shellCall('npm view react')]),
    ).toBe('found');
  });
});

describe('command evidence — anchoring by position, not by pattern rewrite', () => {
  it('anchors every branch of an alternation, not just the first', async () => {
    // The anchor is a POSITION, never a pattern rewrite. `new RegExp('^' + pattern)` binds
    // `^` to the first branch only — `^npm view |pnpm view ` reads as "starts with npm view"
    // OR "contains pnpm view anywhere" — leaving the second branch unanchored while every
    // other test in this file still passes. A non-capturing wrap or an index check survive.
    // The control proves the branch itself is live, so the refusal is pinned to position.
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
    // `transcriptFromInput` leaves `succeeded` absent because its tool calls are the call
    // being judged right now. Accepting an absent outcome would make the input its own
    // precedent and every direct-API surface would judge itself compliant. The rule is
    // `succeeded === true`, never `succeeded !== false`. The control pins the refusal to
    // the outcome axis rather than to this command line.
    expect(await precedentDecision([shellCall('npm view yaml', 'unknown')])).toBe('missing');
    expect(await precedentDecision([shellCall('npm view yaml', 'succeeded')])).toBe('found');
  });
});

describe('command evidence — the recovery path stays open', () => {
  it('reopens the gate when the required command is re-run on its own after a compound failure', async () => {
    // What makes the known over-block survivable. The two axes judge at different
    // granularities: the anchor sees individual simple commands, the outcome is one exit
    // code for the whole line, so `npm view yaml && grep zzz pkg` is refused even though
    // the view ran. That is acceptable ONLY because running the command alone still opens
    // the gate; otherwise a user who obeyed the discipline has no way forward but the
    // witness, and a witness used daily is a gate already switched off.
    //
    // An evaluator that returns the outcome of the FIRST matching call answers `missing`
    // here and keeps the gate shut however often the command is re-run. The failed call is
    // deliberately placed first — with the success first that shortcut would answer `found`.
    const failedCompound = shellCall('npm view yaml && grep zzz pkg', 'failed');

    expect(await precedentDecision([failedCompound])).toBe('missing');
    expect(await precedentDecision([failedCompound, shellCall('npm view yaml', 'succeeded')])).toBe(
      'found',
    );
  });

  it('accepts a command the shell short-circuited past — the under-blocking half, on purpose', async () => {
    // The other end of the same granularity gap. `true || npm view yaml` exits 0 while the
    // view never ran, so both axes say evidence: the anchor matches the second simple
    // command and the line succeeded. Shell control flow is outside what a transcript can
    // answer, and this pass is intended rather than approximated — a control-flow heuristic
    // would pay for it on the over-blocking side, where the cost lands on people obeying
    // the discipline.
    expect(await precedentDecision([shellCall('true || npm view yaml', 'succeeded')])).toBe(
      'found',
    );
  });
});
