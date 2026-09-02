import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CanonicalTranscript, CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The shell axis reaches the disciplines: delta/context routing closures join shell-derived
// computable targets, each delta/context entry gains a per-entry SKIP registration for
// detected-but-uncomputable writes in its scope, and one common `shell-unjudgeable` skip
// registration receives the target-unknown remainder. The body enriches stdin IR with derived
// evidence (disk pre injected there — an absent file means create) before judgeDiscipline.
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.ts';
import type { CovenantRegistration } from '../src/dispatch.ts';

// The forbidden pattern is synthetic (`zzz_banned`) so the fixtures never carry this repo's
// own vocabulary.

const ROOT = '/repo';
const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const BANNED = 'zzz_banned';

/**
 * The disk reader the session surface injects, restated here because these cases judge real
 * files under a temp root. Tri-state: text, `null` for an absent file, and `undefined` for a
 * location that cannot be read at all — the last is what the fail-closed case below drives.
 */
function readPreStateFromDisk(location: string): string | null | undefined {
  try {
    return readFileSync(location, 'utf-8');
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ENOENT' ? null : undefined;
  }
}

const deltaEntry: DisciplineEntry = {
  id: 'no-banned',
  in: ['packages/**/*.ts'],
  forbid: BANNED,
};

function specWith(
  disciplines: DisciplineEntry[],
  extra: Partial<CompileDisciplinesSpec> = {},
): CompileDisciplinesSpec {
  return {
    disciplines,
    rootDir: ROOT,
    shellTools: [SHELL_TOOL],
    commandArgs: [COMMAND_ARG],
    readPreState: readPreStateFromDisk,
    ...extra,
  };
}

/** A CovenantInput whose single call is a shell invocation of `command`. */
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

/**
 * Stub the canonical-transcript seam with a fixed tool-call history. Only a call the provider
 * saw run AND succeed counts as evidence, so a fixture supplying evidence must set `succeeded`.
 */
function transcriptWithToolCalls(
  calls: { name: string; args: Record<string, unknown>; succeeded?: boolean }[],
): CanonicalTranscript {
  return {
    findUserMessages: () => [],
    findToolCalls: (name?: string) =>
      name === undefined ? calls : calls.filter((c) => c.name === name),
  } as unknown as CanonicalTranscript;
}

/** The body-bearing registration compiled for an entry id. */
function bodyRegOf(regs: CovenantRegistration[], label: string): CovenantRegistration | undefined {
  return regs.find((reg) => reg.label === label && reg.skip === undefined);
}

/** The skip-arm registrations compiled for an entry id. */
function skipArmsOf(regs: CovenantRegistration[], label: string): CovenantRegistration[] {
  return regs.filter((reg) => reg.label === label && reg.skip !== undefined);
}

describe('compileDisciplineRegistrations — delta matches joins shell-derived targets', () => {
  function compileDeltaMain(): CovenantRegistration | undefined {
    return bodyRegOf(compileDisciplineRegistrations(specWith([deltaEntry])), deltaEntry.id);
  }

  it('routes a computable in-scope heredoc write with the target path as subject', () => {
    // Shell-delivered mutations must reach the registration. Routing on allFileChanges alone
    // never sees this: a Bash call carries no fileChange.
    const reg = compileDeltaMain();
    const input = bashInput(
      lines("cat > packages/core/src/x.ts <<'EOF'", `${BANNED} rides in the body`, 'EOF'),
    );

    expect(reg?.matches?.(input)).toBe('packages/core/src/x.ts');
  });

  it('returns null for an out-of-scope shell write', () => {
    // A derived target outside the entry's globs must not route. Joining derived targets
    // without the scope filter would spawn every delta body for every shell write.
    const reg = compileDeltaMain();

    expect(reg?.matches?.(bashInput(`echo ${BANNED} > /tmp/y.ts`))).toBeNull();
  });

  it('returns null for a read that merely MENTIONS a scoped path', () => {
    // The mention/derivation divide: `cat <scoped>` names the path but derives no write.
    // Routing on arg-string mentions instead would make every read of a scoped file spawn
    // and record a phantom row.
    const reg = compileDeltaMain();

    expect(reg?.matches?.(bashInput('cat packages/core/src/a.ts'))).toBeNull();
  });

  it('returns null for an in-scope detected-but-UNcomputable write (sed -i)', () => {
    // Channel separation: the uncomputable write belongs to the per-entry skip registration.
    // If the main closure routes it too, the body judges without evidence, upholds, and
    // writes `passed` beside the `skipped` row — two rows for one call.
    const reg = compileDeltaMain();

    expect(reg?.matches?.(bashInput('sed -i s/x/y/ packages/core/src/a.ts'))).toBeNull();
  });
});

describe('compileDisciplineRegistrations — context matches routes shell targets when-blind', () => {
  it('routes a computable in-scope shell write even though its content never matches when', () => {
    // A when-bearing context entry routes shell-derived targets WITHOUT the when judgment,
    // because no pre-state exists at routing time. Applying the when pattern to derived
    // content makes the context gate silently never fire on shell-delivered edits.
    const whenEntry = {
      id: 'needs-view',
      in: ['packages/**/*.ts'],
      when: 'needs-precedent',
      requirePrecedent: { command: 'npm view ' },
    } as DisciplineEntry;
    const regs = compileDisciplineRegistrations(
      specWith([whenEntry], { transcript: transcriptWithToolCalls([]) }),
    );
    const input = bashInput("echo 'no trigger token here' > packages/core/src/dep.ts");

    expect(bodyRegOf(regs, 'needs-view')?.matches?.(input)).toBe('packages/core/src/dep.ts');
  });
});

describe('compileDisciplineRegistrations — per-entry skip registration', () => {
  it('adds exactly one skip-arm registration per delta entry, labeled with the entry id', () => {
    // Labelling the skip with the entry id keeps the gain aggregation in one group. Without
    // the registration entirely, a scoped `sed -i` stays silent — a call that passes with no
    // row at all.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));
    const skips = skipArmsOf(regs, deltaEntry.id);

    expect(skips).toHaveLength(1);
    expect(skips[0]?.body).toBeUndefined();
    expect(skips[0]?.skip?.reason).toBeTruthy();
  });

  it('its matches returns the target path for an in-scope detected-but-uncomputable write', () => {
    // A scope-blind skip closure would record an out-of-scope `sed -i` under this entry.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));
    const [skipReg] = skipArmsOf(regs, deltaEntry.id);

    expect(skipReg?.matches?.(bashInput('sed -i s/x/y/ packages/core/src/a.ts'))).toBe(
      'packages/core/src/a.ts',
    );
  });

  it('its matches returns null for out-of-scope writes and for mere read mentions', () => {
    // Consuming the per-item path list without the scope filter, or matching on mentions,
    // floods the entry's label with skips for files it never covered.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));
    const [skipReg] = skipArmsOf(regs, deltaEntry.id);

    expect(skipReg?.matches?.(bashInput('sed -i s/x/y/ docs/y.md'))).toBeNull();
    expect(skipReg?.matches?.(bashInput('cat packages/core/src/a.ts'))).toBeNull();
  });

  it('its matches returns null when the write IS computable (the body path owns it)', () => {
    // Channel separation, other direction: computable evidence spawns the body. If skip and
    // body both match, a blocked violation carries a sibling `skipped` row.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));
    const [skipReg] = skipArmsOf(regs, deltaEntry.id);

    expect(skipReg?.matches?.(bashInput(`echo ${BANNED} > packages/core/src/x.ts`))).toBeNull();
  });

  it('a context entry gains the per-entry skip registration too', () => {
    // Skip generation keyed on `forbid` alone drops a context entry's scoped `sed -i` to the
    // common label, losing the per-entry attribution the gain aggregation relies on.
    const contextEntry = {
      id: 'needs-view',
      in: ['packages/**/*.ts'],
      requirePrecedent: { command: 'npm view ' },
    } as DisciplineEntry;
    const regs = compileDisciplineRegistrations(
      specWith([contextEntry], { transcript: transcriptWithToolCalls([]) }),
    );
    const skips = skipArmsOf(regs, 'needs-view');

    expect(skips).toHaveLength(1);
    expect(skips[0]?.matches?.(bashInput('sed -i s/x/y/ packages/core/src/a.ts'))).toBe(
      'packages/core/src/a.ts',
    );
  });

  it('command and immutable entries gain NO per-entry skip registration', () => {
    // Only the delta and context families need one: a command entry's axis is the string
    // itself, always judgeable, and immutable's shell deletion is out of scope. Adding skips
    // for every family mints phantom rows under labels whose judgment needs no shell evidence.
    const commandEntry: DisciplineEntry = { id: 'pnpm-only', forbidCommand: 'npm install' };
    const immutableEntry: DisciplineEntry = { id: 'lockfile', immutable: ['config/*.lock'] };
    const regs = compileDisciplineRegistrations(specWith([commandEntry, immutableEntry]));

    expect(skipArmsOf(regs, 'pnpm-only')).toHaveLength(0);
    expect(skipArmsOf(regs, 'lockfile')).toHaveLength(0);
  });
});

describe('compileDisciplineRegistrations — common shell-unjudgeable registration', () => {
  function commonRegOf(regs: CovenantRegistration[]): CovenantRegistration | undefined {
    return regs.find((reg) => reg.label === 'shell-unjudgeable');
  }

  it('is generated even with zero disciplines, as the sole and last registration', () => {
    // The compiler appends it regardless of entry presence: gating it on a non-empty
    // discipline list loses the target-unknown record for a config with no disciplines.
    const regs = compileDisciplineRegistrations(specWith([]));

    expect(regs).toHaveLength(1);
    expect(regs[0]?.label).toBe('shell-unjudgeable');
    expect(regs[0]?.body).toBeUndefined();
    expect(regs[0]?.skip?.reason).toBeTruthy();
  });

  it('is appended exactly once regardless of entry count, in last position', () => {
    // `echo x > $F` leaves ONE skipped row, not one per entry, and it comes last because it
    // backstops the entries.
    const second: DisciplineEntry = { id: 'no-junk', in: ['packages/**'], forbid: 'zzz_junk' };
    const regs = compileDisciplineRegistrations(specWith([deltaEntry, second]));

    expect(regs.filter((reg) => reg.label === 'shell-unjudgeable')).toHaveLength(1);
    expect(regs[regs.length - 1]?.label).toBe('shell-unjudgeable');
  });

  it('matches target-unknown signals with subject "-"', () => {
    // No target path exists, so the subject is '-'. The failure directions are the class left
    // silent, and a fabricated path leaking into the subject.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));
    const common = commonRegOf(regs);

    for (const command of ['echo x > $F', 'bash x.sh', 'rm packages/*/dist/index.js']) {
      expect(common?.matches?.(bashInput(command))).toBe('-');
    }
  });

  it('returns null for signal-free commands (volume defence holds at the registration)', () => {
    // Zero telemetry rows for reads and plain runs. Matching any opaque token would turn
    // every ls/cat/echo glob into a skipped row and flood the log.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));
    const common = commonRegOf(regs);

    for (const command of ['ls *.md', 'echo $HOME', 'pnpm build']) {
      expect(common?.matches?.(bashInput(command))).toBeNull();
    }
  });

  it('returns null when the target is known — computable or per-item unjudgeable', () => {
    // Channel separation: computable targets spawn bodies, path-known skips belong to entry
    // labels. Swallowing per-item cases here gives an out-of-scope `sed -i` a row.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));
    const common = commonRegOf(regs);

    expect(common?.matches?.(bashInput('echo x > f.ts'))).toBeNull();
    expect(common?.matches?.(bashInput('sed -i s/a/b/ x.ts'))).toBeNull();
  });

  it('stays inert on commit-surface-shaped IR — non-shell call names derive nothing', () => {
    // Derivation is a no-op for commit-surface input. The call carries a command-shaped arg
    // string on purpose, to force the discrimination onto the tool NAME: keying derivation on
    // the arg key's presence instead would log a shell-unjudgeable row on every commit.
    const commitInput: CovenantInput = {
      toolCalls: [
        {
          name: 'git-staged-diff',
          args: { [COMMAND_ARG]: 'echo x > $F' },
          fileChange: {
            kind: 'modify',
            path: '/repo/packages/core/src/x.ts',
            pre: 'a;',
            post: 'b;',
          },
        },
      ],
      subagentSpawns: [],
      userMessages: [],
    };
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));

    expect(commonRegOf(regs)?.matches?.(commitInput)).toBeNull();
    expect(skipArmsOf(regs, deltaEntry.id)[0]?.matches?.(commitInput)).toBeNull();
    // The commit surface's own evidence channel keeps routing exactly as before.
    expect(bodyRegOf(regs, deltaEntry.id)?.matches?.(commitInput)).toBe('packages/core/src/x.ts');
  });
});

// The channels must disagree inside the fixture, or a routing rebuilt over the wrong channel
// still answers correctly and no branch is certified.

describe('delta matches — evidence/derivation attribution under divergent channels', () => {
  it('routes on the sibling EVIDENCE path, never the command string mention', () => {
    // The Bash call textually mentions in-scope a.ts (a read); only the sibling's nested
    // fileChange proves a mutation, and of b.ts. The args carry a non-scope path so no
    // arg-mention walk can produce the right answer.
    const input: CovenantInput = {
      toolCalls: [
        { name: SHELL_TOOL, args: { [COMMAND_ARG]: 'cat packages/core/src/a.ts' } },
        {
          name: 'Edit',
          args: { file_path: '/elsewhere/edited.ts' },
          fileChange: {
            kind: 'modify',
            path: '/repo/packages/core/src/b.ts',
            pre: 'clean;',
            post: `clean;\n${BANNED}`,
          },
        },
      ],
      subagentSpawns: [],
      userMessages: [],
    };
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));

    expect(bodyRegOf(regs, deltaEntry.id)?.matches?.(input)).toBe('packages/core/src/b.ts');
  });

  it('attributes a derived shell write to the command own target, never a sibling evidence path', () => {
    // The sibling's evidence sits outside the root; only the Bash command's own redirect
    // target is in scope. Attaching derived content to whatever fileChange exists on the
    // input, or requiring sibling evidence to activate derivation, answers wrongly here.
    const input: CovenantInput = {
      toolCalls: [
        { name: SHELL_TOOL, args: { [COMMAND_ARG]: `echo ${BANNED} > packages/core/src/x.ts` } },
        {
          name: 'Edit',
          args: { file_path: '/elsewhere/y.ts' },
          fileChange: { kind: 'modify', path: '/elsewhere/y.ts', pre: 'a;', post: 'b;' },
        },
      ],
      subagentSpawns: [],
      userMessages: [],
    };
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));

    expect(bodyRegOf(regs, deltaEntry.id)?.matches?.(input)).toBe('packages/core/src/x.ts');
  });
});

/**
 * Judge one entry's compiled thunk against a shell payload, rooted at `rootDir`.
 *
 * The shell-evidence completion these cases pin — derive, read disk pre-state, chain same-path
 * writes, judge — lives inside the compiled thunk. The answer is 0 uphold, 1 break,
 * 2 cannot-judge.
 */
async function judgeShellPayload(
  entry: DisciplineEntry,
  command: string,
  rootDir: string,
  extra: Partial<CompileDisciplinesSpec> = {},
): Promise<{ exitCode: number; reason?: string }> {
  const [registration] = compileDisciplineRegistrations({
    disciplines: [entry],
    rootDir,
    shellTools: [SHELL_TOOL],
    commandArgs: [COMMAND_ARG],
    readPreState: readPreStateFromDisk,
    ...extra,
  });
  const outcome = await registration?.body?.(bashInput(command));
  return outcome ?? { exitCode: 2 };
}

describe('compiled discipline thunk — shell evidence enrichment', () => {
  let dir: string;
  let target: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pdks-shell-axis-'));
    mkdirSync(join(dir, 'scoped'));
    target = join(dir, 'scoped', 'target.ts');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function judgeBody(command: string) {
    const entry: DisciplineEntry = { id: 'no-banned', in: ['scoped/**'], forbid: BANNED };
    return judgeShellPayload(entry, command, dir);
  }

  it('breaks an append that adds the pattern over a clean disk pre', async () => {
    // Append composes real disk pre with derived content, and the added direction then sees
    // the new match. This pins the whole seam — derive, read pre, judge — since a body that
    // performs no enrichment at all upholds here.
    writeFileSync(target, 'plain line\n');

    const result = await judgeBody(`echo '${BANNED}' >> ${target}`);

    expect(result.exitCode).toBe(1);
    expect(result.reason).toContain('no-banned');
  });

  it('still breaks when the disk pre already carries the pattern (occurrence added)', async () => {
    // Delta semantics are a per-string multiset: 1 -> 2 occurrences is an added instance, and
    // existing debt does not absolve it. Presence-based composition would forgive every
    // further insertion forever.
    writeFileSync(target, `${BANNED} already lives here\n`);

    const result = await judgeBody(`echo '${BANNED}' >> ${target}`);

    expect(result.exitCode).toBe(1);
  });

  it('upholds a clean append onto a clean file (passed direction)', async () => {
    // Computable with no violation is exit 0. Enrichment that blocks whenever any derivation
    // exists would block every ordinary shell write in scope.
    writeFileSync(target, 'plain line\n');

    const result = await judgeBody(`echo 'still clean' >> ${target}`);

    expect(result.exitCode).toBe(0);
  });

  it('breaks a heredoc CREATE of an absent file whose body carries the pattern', async () => {
    // An absent file means create, so the whole post is added. If the disk read's ENOENT
    // degrades the evidence to unjudgeable, the brand-new violation silently upholds.
    const command = lines(`cat > ${target} <<'EOF'`, `${BANNED} rides in the body`, 'EOF');

    const result = await judgeBody(command);

    expect(result.exitCode).toBe(1);
    expect(result.reason).toContain('no-banned');
  });
});

describe('shell-axis registrations — audit-round routing gaps (G1/G4)', () => {
  function commonRegOf(regs: CovenantRegistration[]): CovenantRegistration | undefined {
    return regs.find((reg) => reg.label === 'shell-unjudgeable');
  }

  it('the common registration matches a tokenize-failing command with subject "-"', () => {
    // Silence on an unparseable line is a call that passes with no row. The failure shapes
    // are derive answering nothing, or its throw caught into a null match.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));

    expect(commonRegOf(regs)?.matches?.(bashInput("echo 'x > f.ts"))).toBe('-');
  });

  it('an opaque command over an in-scope target routes the per-entry skip', () => {
    // Path known and scope-attributable means the entry's own label owns the row and the
    // common backstop stays out. The opaque head demoting this to the common bucket loses the
    // per-label attribution; both arms matching gives one call two rows.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));
    const input = bashInput('$CMD > packages/core/src/a.ts');

    expect(skipArmsOf(regs, deltaEntry.id)[0]?.matches?.(input)).toBe('packages/core/src/a.ts');
    expect(commonRegOf(regs)?.matches?.(input)).toBeNull();
  });
});

describe('compiled discipline thunk — absent-file append, same-path chaining, context verdict', () => {
  let dir: string;
  let target: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pdks-shell-axis-gaps-'));
    mkdirSync(join(dir, 'scoped'));
    target = join(dir, 'scoped', 'target.ts');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const forbidEntry: DisciplineEntry = { id: 'no-banned', in: ['scoped/**'], forbid: BANNED };

  function judgeEntryBody(
    entry: DisciplineEntry,
    command: string,
    extra: Partial<CompileDisciplinesSpec> = {},
  ) {
    return judgeShellPayload(entry, command, dir, extra);
  }

  it('breaks an append that CREATES an absent file (pre null, whole post added)', async () => {
    // `>>` onto a missing file is a create. An ENOENT read that demotes append evidence to
    // unjudgeable lands a brand-new violation as a skip row instead of a block.
    const fresh = join(dir, 'scoped', 'fresh.ts');

    const result = await judgeEntryBody(forbidEntry, `echo '${BANNED}' >> ${fresh}`);

    expect(result.exitCode).toBe(1);
    expect(result.reason).toContain('no-banned');
  });

  it('chains same-path evidence in command order, not against disk pre twice', async () => {
    // Disk pre already carries the pattern and the FIRST write truncates it away. A body that
    // does not chain judges disk-pre against final-post, sees the count unchanged (1 to 1,
    // forgiven as debt) and upholds; chaining hands the second write pre='clean\n', so its
    // append is 0 to 1 added and breaks.
    writeFileSync(target, `${BANNED}\n`);

    const result = await judgeEntryBody(
      forbidEntry,
      `echo 'clean' > ${target} && echo '${BANNED}' >> ${target}`,
    );

    expect(result.exitCode).toBe(1);
    expect(result.reason).toContain('no-banned');
  });

  it('a context entry judges a computable shell write by the transported verdict', async () => {
    // The derivation trigger meeting the precedent verdict: missing breaks (exit 1), found
    // upholds (exit 0). A context body that ignores derived evidence upholds a
    // missing-precedent shell write; one that breaks on derivation alone ignores the verdict.
    const contextEntry = {
      id: 'needs-view',
      in: ['scoped/**'],
      requirePrecedent: { command: 'npm view ' },
    } as DisciplineEntry;
    writeFileSync(target, 'plain line\n');
    const command = `echo 'dep bump' > ${target}`;

    // The compiler evaluates the evidence against the injected transcript and binds the answer
    // into the thunk, so the two directions are driven by what that transcript witnessed.
    const missing = await judgeEntryBody(contextEntry, command, {
      transcript: transcriptWithToolCalls([]),
    });
    const found = await judgeEntryBody(contextEntry, command, {
      transcript: transcriptWithToolCalls([
        { name: SHELL_TOOL, args: { [COMMAND_ARG]: 'npm view yaml version' }, succeeded: true },
      ]),
    });

    expect(missing.exitCode).toBe(1);
    expect(missing.reason).toContain('needs-view');
    expect(found.exitCode).toBe(0);
  });
});

describe('review-round regressions — routing scope spelling', () => {
  it('a ./-prefixed spelling of an in-scope target still routes the judged arm', () => {
    // Verbatim glob matching lets an equivalent spelling escape every scope.
    const [judged] = compileDisciplineRegistrations(specWith([deltaEntry]));

    expect(judged.matches?.(bashInput(`echo '${BANNED}' > ./packages/core/src/a.ts`))).toBe(
      'packages/core/src/a.ts',
    );
  });

  it('a ./-prefixed sed target still routes the per-entry skip arm', () => {
    // The recorded row must not be spelled away either.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));
    const skipArm = regs.find((reg) => reg.label === deltaEntry.id && reg.skip !== undefined);

    expect(skipArm?.matches?.(bashInput('sed -i s/a/b/ ./packages/core/src/a.ts'))).toBe(
      'packages/core/src/a.ts',
    );
  });
});

describe('review-round regressions — thunk pre-read failure', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'pdks-review-regr-'));
    mkdirSync(join(dir, 'scoped'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('a pre-read failure that is not ENOENT blocks instead of passing (fail-closed)', async () => {
    // Dropped evidence must never read as a clean pass. This raises ENOTDIR: an intermediate
    // path component is a plain file.
    writeFileSync(join(dir, 'scoped', 'blocker.txt'), 'a file, not a directory\n');
    const entry: DisciplineEntry = { id: 'no-banned', in: ['scoped/**'], forbid: BANNED };
    const target = join(dir, 'scoped', 'blocker.txt', 'x.ts');

    const result = await judgeShellPayload(entry, `echo '${BANNED}' >> ${target}`, dir);

    // Not a judged break: routing matched, the evidence could not be completed, and
    // cannot-judge blocks at exit 2.
    expect(result.exitCode).toBe(2);
  });
});

// Which registrations carry a body at all is the compiler's answer, not the assembly root's.
// An assembly that guesses with `disciplines.length === 0 ? [] : compile(...)` deletes the
// backstop in one direction, and in the other assumes a body for configs whose entries all
// compile to body-less skips. Both halves are pinned here.

describe('compileDisciplineRegistrations — a body is composed only where one can judge', () => {
  const precedentEntry = {
    id: 'needs-precedent',
    in: ['packages/**/*.ts'],
    requirePrecedent: { tool: 'WebFetch' },
  } as DisciplineEntry;

  it('composes no body when no discipline is declared, and the backstop is still emitted', () => {
    // An assembly root that answers the judgment question itself skips this call, and skipping
    // it drops the shell-unjudgeable backstop — an uncomputable shell write in a config with
    // no disciplines then goes from `skipped` to silence.
    const regs = compileDisciplineRegistrations(specWith([]));

    expect(regs.map((reg) => [reg.label, reg.body === undefined])).toEqual([
      ['shell-unjudgeable', true],
    ]);
  });

  it('composes no body for an entry that compiles to a body-less skip', () => {
    // Entry count is not the question either: a requirePrecedent entry with no transcript and
    // no evaluator injected — the commit surface's own shape — compiles to a skip carrying no
    // body. A body composed on the skip arm would judge an entry whose evidence channel is
    // absent and block every matched input with no legitimate pass path.
    const regs = compileDisciplineRegistrations(specWith([precedentEntry]));
    const reg = regs.find((r) => r.label === precedentEntry.id);

    expect(reg?.skip).toBeDefined();
    expect(reg?.body).toBeUndefined();
  });
});
