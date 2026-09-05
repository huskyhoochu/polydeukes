import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// A declare entry judges shell-derived writes: the body's routing and judgment see the
// world a computable shell write delivers (disk pre read through the injected reader, an
// absent file meaning create, same-path writes chained in command order), while the
// per-entry skip arm keeps only the uncomputable writes. The two arms are disjoint: one
// call leaves one row.
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.ts';
import type { CovenantRegistration } from '../src/dispatch.ts';

const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const PATH_SOURCE = 'target.path';
const ID = 'no-lantern';
const ENTRY = 'nothing-added';
// The banned word is a fixture value with no relation to this repo's vocabulary.
const BANNED = 'lantern';
const PATTERN = `\\b(${BANNED})\\b`;
const SCOPE_DIR = 'lib';

/**
 * The disk reader the session surface injects. Tri-state: text, `null` for an absent file,
 * and `undefined` for a location that cannot be read at all.
 */
function readPreStateFromDisk(location: string): string | null | undefined {
  try {
    return readFileSync(location, 'utf-8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : undefined;
  }
}

/** The added-only declaration over `lib/`: matched strings keyed by match, added set empty. */
const ADDED_ONLY = {
  mechanism: 'added-only',
  scope: { source: PATH_SOURCE, include: [`^${SCOPE_DIR}/`] },
  supply: { pre: 'empty', post: 'empty' },
  extract: {
    before: [{ op: 'source', of: 'pre' }, { op: 'lines' }, { op: 'keyByPattern', re: PATTERN }],
    after: [{ op: 'source', of: 'post' }, { op: 'lines' }, { op: 'keyByPattern', re: PATTERN }],
    added: [{ op: 'onlyIn', of: 'after', notIn: 'before' }],
  },
  relate: [{ id: ENTRY, relation: { op: 'empty', of: 'added' }, message: 'adds {key}: {value}' }],
};

const entry = { id: ID, declare: ADDED_ONLY } as unknown as DisciplineEntry;

function specWith(
  rootDir: string,
  extra: Partial<CompileDisciplinesSpec> = {},
): CompileDisciplinesSpec {
  return {
    disciplines: [entry],
    rootDir,
    shellTools: [SHELL_TOOL],
    commandArgs: [COMMAND_ARG],
    readPreState: readPreStateFromDisk,
    ...extra,
  };
}

/** A CovenantInput whose single call is a shell invocation of `command`, no evidence. */
function bashInput(command: string): CovenantInput {
  return {
    toolCalls: [{ name: SHELL_TOOL, args: { [COMMAND_ARG]: command } }],
    subagentSpawns: [],
    userMessages: [],
  };
}

/** Join physical lines into the single command string a hook payload carries. */
function lines(...parts: string[]): string {
  return parts.join('\n');
}

function bodyRegOf(regs: CovenantRegistration[]): CovenantRegistration {
  const reg = regs.find((r) => r.label === ID && r.skip === undefined);
  if (reg === undefined) throw new Error(`no body registration compiled for ${ID}`);
  return reg;
}

function skipArmsOf(regs: CovenantRegistration[]): CovenantRegistration[] {
  return regs.filter((r) => r.label === ID && r.skip !== undefined);
}

function commonRegOf(regs: CovenantRegistration[]): CovenantRegistration | undefined {
  return regs.find((r) => r.label === 'shell-unjudgeable');
}

type BodyOutcome = {
  exitCode: number;
  reason?: string;
  witnesses?: readonly { id: string; witnesses: readonly { key: string; value: unknown }[] }[];
};

/** Route and judge one shell command through the body registration. */
async function judgeShell(
  rootDir: string,
  command: string,
  extra: Partial<CompileDisciplinesSpec> = {},
): Promise<{ routed: string | null; outcome: BodyOutcome }> {
  const reg = bodyRegOf(compileDisciplineRegistrations(specWith(rootDir, extra)));
  const input = bashInput(command);
  const routed = reg.matches?.(input) ?? null;
  const outcome = (await reg.body?.(input)) as BodyOutcome | undefined;
  return { routed, outcome: outcome ?? { exitCode: 2 } };
}

describe('declare body — shell evidence enrichment', () => {
  let dir: string;
  let target: string;
  const relTarget = `${SCOPE_DIR}/a.txt`;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pdks-declare-shell-'));
    mkdirSync(join(dir, SCOPE_DIR));
    target = join(dir, relTarget);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('a computable append over a clean disk pre routes to the body and breaks on the added match', async () => {
    // The whole seam — derive the write, read disk pre, judge the added set. A body whose
    // admitted worlds come from the raw input alone sees no file change on a Bash call:
    // `matches` answers null and the write passes with no row.
    writeFileSync(target, 'plain line\n');

    const { routed, outcome } = await judgeShell(dir, `echo '${BANNED}' >> ${target}`);

    expect(routed).toBe(relTarget);
    expect(outcome.exitCode).toBe(1);
    expect(outcome.reason).toContain(ID);
    expect(outcome.witnesses?.[0]?.witnesses).toEqual([{ key: BANNED, value: BANNED }]);
  });

  it('an append onto a disk pre that already carries the match passes (set semantics, declared)', async () => {
    // Existing debt is forgiven by key: the disk pre must reach the world as `pre`, or the
    // append reads as a create and the old occurrence breaks again on every edit.
    writeFileSync(target, `${BANNED} already lives here\n`);

    const { outcome } = await judgeShell(dir, `echo '${BANNED}' >> ${target}`);

    expect(outcome.exitCode).toBe(0);
  });

  it('a heredoc CREATE of an absent file whose body carries the match breaks', async () => {
    // ENOENT means create, and `supply: { pre: empty }` makes the whole post added. A
    // reader answer of null degraded to unjudgeable lands the brand-new violation as a
    // skip row instead of a break.
    const fresh = join(dir, SCOPE_DIR, 'fresh.txt');
    const command = lines(`cat > ${fresh} <<'EOF'`, `${BANNED} rides in the body`, 'EOF');

    const { outcome } = await judgeShell(dir, command);

    expect(outcome.exitCode).toBe(1);
    expect(outcome.witnesses?.[0]?.witnesses).toEqual([
      { key: BANNED, value: `${BANNED} rides in the body` },
    ]);
  });

  it('an append that creates an absent file breaks on the added match', async () => {
    // `>>` onto a missing file is a create too; only the redirect kind differs from the
    // heredoc case, so a derivation that reads null pre as unjudgeable for append alone
    // is caught here and not above.
    const fresh = join(dir, SCOPE_DIR, 'fresh.txt');

    const { outcome } = await judgeShell(dir, `echo '${BANNED}' >> ${fresh}`);

    expect(outcome.exitCode).toBe(1);
  });

  it('chains same-path writes in command order — the second write is judged against the first post', async () => {
    // Disk pre carries the word and the first write truncates it away. Unchained, the
    // body compares disk pre with the final post, finds the key on both sides, and passes
    // the re-entry; chained, the second write's pre is `clean` and the append is new.
    writeFileSync(target, `${BANNED}\n`);

    const { outcome } = await judgeShell(
      dir,
      `echo 'clean' > ${target} && echo '${BANNED}' >> ${target}`,
    );

    expect(outcome.exitCode).toBe(1);
    expect(outcome.witnesses?.[0]?.witnesses).toEqual([{ key: BANNED, value: BANNED }]);
  });

  it('a pre-read failure that is not ENOENT fails closed at exit 2, never 0', async () => {
    // Dropped evidence must not read as a clean pass. ENOTDIR here: an intermediate path
    // component is a plain file, so the reader answers undefined rather than null.
    writeFileSync(target, 'a file, not a directory\n');
    const blocked = join(target, 'x.txt');

    const { outcome } = await judgeShell(dir, `echo '${BANNED}' >> ${blocked}`);

    expect(outcome.exitCode).toBe(2);
  });

  it('a reader that throws fails closed at exit 2 as well', async () => {
    // The injected reader is the surface's; an exception from it must land on the
    // cannot-judge exit, not escape the body (which would take every sibling with it) or
    // fall through to a judged pass on an empty world.
    const throwing = () => {
      throw new Error('disk unavailable');
    };

    const { outcome } = await judgeShell(dir, `echo '${BANNED}' >> ${target}`, {
      readPreState: throwing,
    });

    expect(outcome.exitCode).toBe(2);
  });
});

describe('declare shell axis — the two arms are disjoint', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pdks-declare-arms-'));
    mkdirSync(join(dir, SCOPE_DIR));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('a computable in-scope write routes to the body and not to the skip arm', () => {
    // Both arms matching leaves two rows for one call and a `skipped` beside a break.
    const regs = compileDisciplineRegistrations(specWith(dir));
    const input = bashInput(`echo '${BANNED}' > ${join(dir, SCOPE_DIR, 'a.txt')}`);

    expect(bodyRegOf(regs).matches?.(input)).toBe(`${SCOPE_DIR}/a.txt`);
    expect(skipArmsOf(regs)).toHaveLength(1);
    expect(skipArmsOf(regs)[0]?.matches?.(input)).toBeNull();
  });

  it('an uncomputable in-scope write (sed -i) routes to the skip arm and not to the body', () => {
    // The body judging an uncomputable write judges an empty world and passes it; the
    // skip arm is the row that says the write was seen and not judged.
    const regs = compileDisciplineRegistrations(specWith(dir));
    const input = bashInput(`sed -i 's/a/b/' ${join(dir, SCOPE_DIR, 'a.txt')}`);

    expect(skipArmsOf(regs)[0]?.matches?.(input)).toBe(`${SCOPE_DIR}/a.txt`);
    expect(bodyRegOf(regs).matches?.(input)).toBeNull();
  });

  it('a tokenize-failing line over an in-scope path lands on the common backstop, never on the body', () => {
    // Silence on an unparseable line is a call that passes with no row; the body
    // answering a subject for it would judge a world no derivation produced.
    const regs = compileDisciplineRegistrations(specWith(dir));
    const input = bashInput(`echo 'x > ${join(dir, SCOPE_DIR, 'a.txt')}`);

    expect(commonRegOf(regs)?.matches?.(input)).toBe('-');
    expect(bodyRegOf(regs).matches?.(input)).toBeNull();
  });

  it('an opaque head over an in-scope target routes the per-entry skip arm, not the backstop', () => {
    // Path known and scope-attributable: the entry's label owns the row.
    const regs = compileDisciplineRegistrations(specWith(dir));
    const input = bashInput(`$CMD > ${join(dir, SCOPE_DIR, 'a.txt')}`);

    expect(skipArmsOf(regs)[0]?.matches?.(input)).toBe(`${SCOPE_DIR}/a.txt`);
    expect(commonRegOf(regs)?.matches?.(input)).toBeNull();
    expect(bodyRegOf(regs).matches?.(input)).toBeNull();
  });
});
