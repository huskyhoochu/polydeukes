import { resolve } from 'node:path';
import type { CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
// The pre-state read is an INJECTED reader carried on the shell surface beside rootDir and
// the tool/arg names — the same channel that already exists so no domain value is a source
// literal. Its answer is TRI-STATE and each state has its own downstream consequence:
// a string is the content before the call (a modify), null is an absent file (a create),
// and undefined is a file that cannot be read at all, which must reach exit 2 rather than
// any verdict. Every fixture below drives the reader, never a disk.
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.ts';

// The forbidden pattern is synthetic (`zzz_banned`) so the fixtures never carry this repo's
// own vocabulary.

const ROOT = '/repo';
const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const BANNED = 'zzz_banned';
// A second banned word, so a case can add a match the pre-state does not already carry.
const OTHER_BANNED = 'zzz_other';
const SCOPED_PATH = 'scoped/target.ts';

/** A CovenantInput whose single call is a shell invocation of `command`. */
function bashInput(command: string): CovenantInput {
  return {
    toolCalls: [{ name: SHELL_TOOL, args: { [COMMAND_ARG]: command } }],
    subagentSpawns: [],
    userMessages: [],
  };
}

type PreState = string | null | undefined;

/**
 * A reader under the test's control that records every location it was handed.
 *
 * `answers` maps an absolute location to its pre-state; a location the map does not name
 * answers null. The recorded `calls` are what pins the same-path chaining rule — a
 * predecessor's post must be composed onto in memory, never re-read.
 */
function spyReader(answers: Record<string, PreState> = {}): {
  read: (location: string) => PreState;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    read: (location: string) => {
      calls.push(location);
      return location in answers ? answers[location] : null;
    },
    calls,
  };
}

/**
 * Judge one entry's compiled thunk against a shell payload, with the pre-state reader
 * injected through the shell surface. The answer is 0 uphold, 1 break, 2 cannot-judge.
 */
async function judgeWithReader(
  entry: DisciplineEntry,
  command: string,
  readPreState: (location: string) => PreState,
): Promise<{ exitCode: number; reason?: string }> {
  const [registration] = compileDisciplineRegistrations({
    disciplines: [entry],
    rootDir: ROOT,
    shellTools: [SHELL_TOOL],
    commandArgs: [COMMAND_ARG],
    readPreState,
  } satisfies CompileDisciplinesSpec);
  // An inert probe proves nothing about the body: confirm the payload routes before
  // trusting the outcome the body reports.
  expect(registration?.matches?.(bashInput(command))).toBeTypeOf('string');
  const outcome = await registration?.body?.(bashInput(command));
  return outcome ?? { exitCode: 2 };
}

/**
 * The added-only declaration over `scoped/`: each side's matched strings are keyed by the
 * match, and what `post` adds over `pre` must be empty. The pre-state the reader answers is
 * what fills `pre`, which is why this entry is the probe for that channel.
 */
const forbidEntry = {
  id: 'no-banned',
  declare: {
    mechanism: 'added-only',
    scope: { source: 'target.path', include: ['^scoped/'] },
    supply: { pre: 'empty', post: 'empty' },
    extract: {
      before: [
        { op: 'source', of: 'pre' },
        { op: 'lines' },
        { op: 'keyByPattern', re: `(${BANNED}|${OTHER_BANNED})` },
      ],
      after: [
        { op: 'source', of: 'post' },
        { op: 'lines' },
        { op: 'keyByPattern', re: `(${BANNED}|${OTHER_BANNED})` },
      ],
      added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
    },
    relate: [
      { id: 'nothing-added', relation: { op: 'empty', of: 'added' }, message: 'adds {key}' },
    ],
  },
} as unknown as DisciplineEntry;

describe('compiled discipline thunk — the injected reader is the only pre-state channel', () => {
  it('judges a string pre-state as a MODIFY carrying exactly that content', async () => {
    // The injected pre already carries one occurrence and the write puts one back, so the
    // multiset goes 1 -> 1: pre-existing debt, forgiven, exit 0. A reader whose string
    // answer is discarded — the field ignored, or a fallback read of a nonexistent file
    // answering null instead — makes this a create, counts the whole post as added, and
    // blocks an edit that added nothing.
    const reader = spyReader({ [resolve(ROOT, SCOPED_PATH)]: `${BANNED} already lives here\n` });

    const result = await judgeWithReader(
      forbidEntry,
      `echo '${BANNED}' > ${SCOPED_PATH}`,
      reader.read,
    );

    expect(result.exitCode).toBe(0);
  });

  it('still breaks when the write adds a match the pre-state does not carry', async () => {
    // The pass direction above must not be reachable by ignoring the write. Same injected
    // pre, a post whose line carries a match that pre never had: a `pre` fed straight
    // through as the post, or a write whose content is discarded, upholds here.
    const reader = spyReader({ [resolve(ROOT, SCOPED_PATH)]: `${BANNED} already lives here\n` });

    const result = await judgeWithReader(
      forbidEntry,
      `echo '${OTHER_BANNED} arrives' > ${SCOPED_PATH}`,
      reader.read,
    );

    expect(result.exitCode).toBe(1);
    expect(result.reason).toContain('no-banned');
  });

  it('a null pre-state still counts the whole post as added', async () => {
    // The other end of null: nothing is forgiven on a create, so a brand-new file carrying
    // the pattern breaks. A create whose evidence is degraded to unjudgeable, or whose post
    // is compared against itself, lets a new violation through as a pass.
    const reader = spyReader({ [resolve(ROOT, SCOPED_PATH)]: null });

    const result = await judgeWithReader(
      forbidEntry,
      `echo '${BANNED} rides in the body' > ${SCOPED_PATH}`,
      reader.read,
    );

    expect(result.exitCode).toBe(1);
    expect(result.reason).toContain('no-banned');
  });

  it('an undefined pre-state is unjudgeable (exit 2), never a quiet pass', async () => {
    // The fail-open hole: routing already matched, so an unreadable pre-state that is
    // collapsed into null — or swallowed into an upheld verdict — records the run as
    // passed. The write here adds no forbidden content on purpose, so a reader answer
    // folded into null lands exit 0 and this assertion is the only thing separating the
    // two.
    const reader = spyReader({ [resolve(ROOT, SCOPED_PATH)]: undefined });

    const result = await judgeWithReader(
      forbidEntry,
      `echo 'nothing forbidden here' > ${SCOPED_PATH}`,
      reader.read,
    );

    expect(result.exitCode).toBe(2);
  });

  it('calls the reader exactly once for two writes to one path', async () => {
    // Only the first write to a path consults the reader; every later one composes onto its
    // predecessor's post. A second call means the chain was rebuilt against the pre-state,
    // which is the shape that forgives a truncate followed by a re-add.
    const reader = spyReader({ [resolve(ROOT, SCOPED_PATH)]: `${BANNED}\n` });

    await judgeWithReader(
      forbidEntry,
      `echo 'clean' > ${SCOPED_PATH} && echo '${BANNED}' >> ${SCOPED_PATH}`,
      reader.read,
    );

    expect(reader.calls).toEqual([resolve(ROOT, SCOPED_PATH)]);
  });

  it('reads each DISTINCT path once — the chain is keyed per path, not per input', async () => {
    // The mirror of the rule above: a Map keyed on anything coarser than the location, or a
    // single cached pre-state reused across paths, judges the second file against the first
    // file's content.
    const other = 'scoped/other.ts';
    const reader = spyReader({
      [resolve(ROOT, SCOPED_PATH)]: 'a\n',
      [resolve(ROOT, other)]: 'b\n',
    });

    await judgeWithReader(
      forbidEntry,
      `echo 'x' >> ${SCOPED_PATH} && echo 'y' >> ${other}`,
      reader.read,
    );

    expect(reader.calls).toEqual([resolve(ROOT, SCOPED_PATH), resolve(ROOT, other)]);
  });
});

describe('compiled discipline thunk — the reader receives an absolute location', () => {
  it('leaves an already-absolute shell target unchanged', async () => {
    // The other end of the resolution axis. Concatenating the root onto every derived path
    // would hand the reader /repo/repo/... and turn an ordinary in-scope write into an
    // absent file, silently reclassifying every modify as a create.
    const absolute = `${ROOT}/${SCOPED_PATH}`;
    const reader = spyReader({ [absolute]: 'plain line\n' });

    await judgeWithReader(forbidEntry, `echo 'x' >> ${absolute}`, reader.read);

    expect(reader.calls).toEqual([absolute]);
  });
});

describe('compiled discipline thunk — no shell evidence, no read', () => {
  it('never consults the reader for a payload carrying its own file evidence', async () => {
    // Pre-state completion belongs to shell-derived evidence alone: a call that already
    // carries a fileChange has its pre from the surface that observed it. A body that reads
    // unconditionally overwrites a commit surface's observed pre with the working tree's
    // current content, judging the diff against the wrong baseline.
    const reader = spyReader();
    const [registration] = compileDisciplineRegistrations({
      disciplines: [forbidEntry],
      rootDir: ROOT,
      shellTools: [SHELL_TOOL],
      commandArgs: [COMMAND_ARG],
      readPreState: reader.read,
    } satisfies CompileDisciplinesSpec);
    const input: CovenantInput = {
      toolCalls: [
        {
          name: 'Edit',
          args: { file_path: `${ROOT}/${SCOPED_PATH}` },
          fileChange: {
            kind: 'modify',
            path: `${ROOT}/${SCOPED_PATH}`,
            pre: `${BANNED} debt\n`,
            post: `${BANNED} debt\n`,
          },
        },
      ],
      subagentSpawns: [],
      userMessages: [],
    };

    expect(registration?.matches?.(input)).toBeTypeOf('string');
    const outcome = await registration?.body?.(input);

    expect(outcome?.exitCode).toBe(0);
    expect(reader.calls).toEqual([]);
  });
});
