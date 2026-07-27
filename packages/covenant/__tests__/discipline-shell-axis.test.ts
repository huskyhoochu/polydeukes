import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CanonicalTranscript, CovenantInput, DisciplineEntry } from '@polydeukes/core';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
// COVENANT-10b §2-b·§2-c — the shell axis reaches the disciplines: delta/context
// routing closures join shell-derived computable targets, each delta/context entry
// gains a per-entry SKIP registration for detected-but-uncomputable writes in its
// scope, and one common `shell-unjudgeable` skip registration receives the
// target-unknown remainder. The body enriches stdin IR with derived evidence (disk
// pre injected there — absent file = create) before the unchanged judgeDiscipline.
// None of that integration exists yet, so most of this file is RED by construction.
import { type CompileDisciplinesSpec, compileDisciplineRegistrations } from '../src/discipline.ts';
import type { CovenantRegistration } from '../src/dispatch.ts';

// ---------------------------------------------------------------------------
// Fixtures. Tool names, command arg names, and the repo root are injected
// assembly values, never source literals. The forbidden pattern is synthetic
// (`zzz_banned`) — never this repo's real vocabulary.
// ---------------------------------------------------------------------------

const ROOT = '/repo';
const SHELL_TOOL = 'Bash';
const COMMAND_ARG = 'command';
const BANNED = 'zzz_banned';

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
    bodyCommand: '/usr/bin/node',
    bodyModulePath: '/repo/discipline-body.js',
    shellTools: [SHELL_TOOL],
    commandArgs: [COMMAND_ARG],
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

/** Stub the canonical-transcript seam with a fixed tool-call history. */
function transcriptWithToolCalls(
  calls: { name: string; args: Record<string, unknown> }[],
): CanonicalTranscript {
  return {
    findSubagentInvocations: () => [],
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

// ===========================================================================
// §2-b — delta routing joins shell-derived computable targets
// ===========================================================================

describe('compileDisciplineRegistrations — delta matches joins shell-derived targets (§2-b)', () => {
  function compileDeltaMain(): CovenantRegistration | undefined {
    return bodyRegOf(compileDisciplineRegistrations(specWith([deltaEntry])), deltaEntry.id);
  }

  it('routes a computable in-scope heredoc write with the target path as subject', () => {
    // B3 core: shell-delivered mutations must reach the registration. Mutation caught:
    // routing left on allFileChanges alone — a Bash call carries no fileChange, so the
    // heredoc violation never routes (today's live hole, this test is RED against it).
    const reg = compileDeltaMain();
    const input = bashInput(
      lines("cat > packages/core/src/x.ts <<'EOF'", `${BANNED} rides in the body`, 'EOF'),
    );

    expect(reg?.matches?.(input)).toBe('packages/core/src/x.ts');
  });

  it('returns null for an out-of-scope shell write', () => {
    // Axis "scope" non-match end (AC §3.3): a derived target outside the entry's
    // globs must not route. Mutation caught: derived targets joined without the
    // forbidScope filter (every shell write would spawn every delta body).
    const reg = compileDeltaMain();

    expect(reg?.matches?.(bashInput(`echo ${BANNED} > /tmp/y.ts`))).toBeNull();
  });

  it('returns null for a read that merely MENTIONS a scoped path', () => {
    // The mention/derivation divide: `cat <scoped>` names the path but derives no
    // write. Mutation caught: routing on arg-string mentions instead of derived
    // targets (every read of a scoped file would spawn and record a phantom row).
    const reg = compileDeltaMain();

    expect(reg?.matches?.(bashInput('cat packages/core/src/a.ts'))).toBeNull();
  });

  it('returns null for an in-scope detected-but-UNcomputable write (sed -i)', () => {
    // Channel separation: the uncomputable write belongs to the per-entry skip
    // registration. Mutation caught: the main closure routing it anyway — the body
    // would judge without evidence, uphold, and write `passed` beside the `skipped`
    // row (AC §3.2 fixes exactly one row for that label).
    const reg = compileDeltaMain();

    expect(reg?.matches?.(bashInput('sed -i s/x/y/ packages/core/src/a.ts'))).toBeNull();
  });
});

describe('compileDisciplineRegistrations — context matches routes shell targets when-blind (§2-b)', () => {
  it('routes a computable in-scope shell write even though its content never matches when', () => {
    // §2-b: a when-bearing context entry routes shell-derived targets WITHOUT the when
    // judgment (no pre exists at routing time). Mutation caught: the when pattern
    // applied to derived content — the context gate would silently never fire on
    // shell-delivered edits of its scope.
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

// ===========================================================================
// §2-c — per-entry skip registration (delta/context families only)
// ===========================================================================

describe('compileDisciplineRegistrations — per-entry skip registration (§2-c)', () => {
  it('adds exactly one skip-arm registration per delta entry, labeled with the entry id', () => {
    // Label = id keeps the gain aggregation in the same group (§2-c). Mutation
    // caught: the skip registration missing entirely (sed -i in scope stays silent,
    // the quiet pass B3 measured), or labeled with a new vocabulary of its own.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));
    const skips = skipArmsOf(regs, deltaEntry.id);

    expect(skips).toHaveLength(1);
    expect(skips[0]?.body).toBeUndefined();
    expect(skips[0]?.skip?.reason).toBeTruthy();
  });

  it('its matches returns the target path for an in-scope detected-but-uncomputable write', () => {
    // AC §3.2 first bullet's routing half. Mutation caught: the skip matches built
    // scope-blind (out-of-scope sed -i would also record under this entry's label).
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));
    const [skipReg] = skipArmsOf(regs, deltaEntry.id);

    expect(skipReg?.matches?.(bashInput('sed -i s/x/y/ packages/core/src/a.ts'))).toBe(
      'packages/core/src/a.ts',
    );
  });

  it('its matches returns null for out-of-scope writes and for mere read mentions', () => {
    // Mutation caught: the per-item path list consumed without the entry-scope
    // filter, or mention-based matching — both would flood the entry's label with
    // skips for files it never covered (AC §3.3: out-of-scope shell edits leave 0 rows).
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));
    const [skipReg] = skipArmsOf(regs, deltaEntry.id);

    expect(skipReg?.matches?.(bashInput('sed -i s/x/y/ docs/y.md'))).toBeNull();
    expect(skipReg?.matches?.(bashInput('cat packages/core/src/a.ts'))).toBeNull();
  });

  it('its matches returns null when the write IS computable (the body path owns it)', () => {
    // Channel separation, other direction: computable evidence spawns the body.
    // Mutation caught: skip and body both matching — a blocked violation would carry
    // a sibling `skipped` row, corrupting the per-label accounting.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));
    const [skipReg] = skipArmsOf(regs, deltaEntry.id);

    expect(skipReg?.matches?.(bashInput(`echo ${BANNED} > packages/core/src/x.ts`))).toBeNull();
  });

  it('a context entry gains the per-entry skip registration too', () => {
    // §2-c covers delta AND context. Mutation caught: the skip generation keyed on
    // `forbid` only — a context entry's scoped sed -i would fall to the common label,
    // losing the per-entry attribution gain relies on.
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
    // §2-c names delta and context only: a command entry's axis is the string itself
    // (always judgeable) and immutable's shell deletion is out of scope (§2-e).
    // Mutation caught: skip registrations blanket-added for every family (phantom
    // skipped rows under labels whose judgment never needed shell evidence).
    const commandEntry: DisciplineEntry = { id: 'pnpm-only', forbidCommand: 'npm install' };
    const immutableEntry: DisciplineEntry = { id: 'lockfile', immutable: ['config/*.lock'] };
    const regs = compileDisciplineRegistrations(specWith([commandEntry, immutableEntry]));

    expect(skipArmsOf(regs, 'pnpm-only')).toHaveLength(0);
    expect(skipArmsOf(regs, 'lockfile')).toHaveLength(0);
  });
});

// ===========================================================================
// §2-c — the ONE common shell-unjudgeable registration
// ===========================================================================

describe('compileDisciplineRegistrations — common shell-unjudgeable registration (§2-c)', () => {
  function commonRegOf(regs: CovenantRegistration[]): CovenantRegistration | undefined {
    return regs.find((reg) => reg.label === 'shell-unjudgeable');
  }

  it('is generated even with zero disciplines, as the sole and last registration', () => {
    // §2-c: the compiler appends it regardless of entry presence. Mutation caught:
    // generation gated on disciplines.length > 0 — a config with no disciplines
    // would lose the target-unknown record entirely.
    const regs = compileDisciplineRegistrations(specWith([]));

    expect(regs).toHaveLength(1);
    expect(regs[0]?.label).toBe('shell-unjudgeable');
    expect(regs[0]?.body).toBeUndefined();
    expect(regs[0]?.skip?.reason).toBeTruthy();
  });

  it('is appended exactly once regardless of entry count, in last position', () => {
    // AC §3.2: `echo x > $F` leaves ONE skipped row, not one per entry. Mutation
    // caught: the common registration emitted per entry (N rows), or ordered before
    // the entries it backstops.
    const second: DisciplineEntry = { id: 'no-junk', in: ['packages/**'], forbid: 'zzz_junk' };
    const regs = compileDisciplineRegistrations(specWith([deltaEntry, second]));

    expect(regs.filter((reg) => reg.label === 'shell-unjudgeable')).toHaveLength(1);
    expect(regs[regs.length - 1]?.label).toBe('shell-unjudgeable');
  });

  it('matches target-unknown signals with subject "-"', () => {
    // §2-c: no target path exists, so the subject is '-'. Mutation caught: the
    // target-unknown class left silent (the 07b glob pin never becomes a skipped
    // row), or a fabricated path leaking into the subject.
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));
    const common = commonRegOf(regs);

    for (const command of ['echo x > $F', 'bash x.sh', 'rm packages/*/dist/index.js']) {
      expect(common?.matches?.(bashInput(command))).toBe('-');
    }
  });

  it('returns null for signal-free commands (volume defence holds at the registration)', () => {
    // AC §3.3: zero telemetry rows for reads and plain runs. Mutation caught: the
    // common registration matching any opaque token — every ls/cat/echo glob would
    // become a skipped row (the 2,414-bypass volume class all over again).
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));
    const common = commonRegOf(regs);

    for (const command of ['ls *.md', 'echo $HOME', 'pnpm build']) {
      expect(common?.matches?.(bashInput(command))).toBeNull();
    }
  });

  it('returns null when the target is known — computable or per-item unjudgeable', () => {
    // Channel separation: computable targets spawn bodies, path-known skips belong to
    // entry labels. Mutation caught: the common registration swallowing per-item
    // cases (an out-of-scope sed -i would suddenly leave a row, breaking AC §3.3).
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));
    const common = commonRegOf(regs);

    expect(common?.matches?.(bashInput('echo x > f.ts'))).toBeNull();
    expect(common?.matches?.(bashInput('sed -i s/a/b/ x.ts'))).toBeNull();
  });

  it('stays inert on commit-surface-shaped IR — non-shell call names derive nothing', () => {
    // AC §3.4: derivation is a no-op for `pdks covenant check` input. The call even
    // carries a command-shaped arg string to force the discrimination onto the tool
    // NAME. Mutation caught: derivation keyed on the arg key's presence instead of
    // shellTools membership — every commit would log a shell-unjudgeable row.
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

// ===========================================================================
// Killer pins — channels must disagree in the fixture, or no branch is certified
// (dev-log: realistic-fixtures-mirror-away-mutants)
// ===========================================================================

describe('delta matches — evidence/derivation attribution under divergent channels', () => {
  it('routes on the sibling EVIDENCE path, never the command string mention', () => {
    // The Bash call textually mentions in-scope a.ts (a read); only the sibling's
    // nested fileChange proves a mutation, and of b.ts — args carry a non-scope path
    // so no arg-mention walk can produce the right answer. Mutation caught: routing
    // rebuilt over arg-string mentions (would answer a.ts, or the args path).
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
    // The sibling's evidence sits outside the root; only the Bash command's own
    // redirect target is in scope. Mutation caught: derived content attached to
    // whatever fileChange evidence exists on the input (subject would go null or
    // name the sibling), or derivation requiring sibling evidence to activate.
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

// ===========================================================================
// §2-b — the spawned body enriches stdin IR with derived evidence + disk pre
// (real compiled artifact; judged break = exit 1, the run_covenant wrapper
// translates it into the blocking 2)
// ===========================================================================

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const bodyPath = fileURLToPath(new URL('../dist/discipline-body.js', import.meta.url));

beforeAll(() => {
  execFileSync('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@polydeukes/covenant'], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
}, 120_000);

describe('discipline-body CLI — shell evidence enrichment (§2-b)', () => {
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

  function spawnBody(command: string) {
    const entry: DisciplineEntry = { id: 'no-banned', in: ['scoped/**'], forbid: BANNED };
    return spawnSync(
      process.execPath,
      [
        bodyPath,
        '--discipline',
        JSON.stringify(entry),
        '--root-dir',
        dir,
        '--shell-tool',
        SHELL_TOOL,
        '--command-arg',
        COMMAND_ARG,
      ],
      { input: JSON.stringify(bashInput(command)), encoding: 'utf-8' },
    );
  }

  it('breaks an append that adds the pattern over a clean disk pre (AC §3.1)', () => {
    // Append composes REAL disk pre + derived content; the added direction then sees
    // the new match. Mutation caught: append judged as create/truncate (pre ignored)
    // still breaks here, BUT the no-enrichment mutant — today's body — upholds, so
    // this pins the whole seam: derive, read pre, judge. RED against current dist.
    writeFileSync(target, 'plain line\n');

    const result = spawnBody(`echo '${BANNED}' >> ${target}`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no-banned');
  });

  it('still breaks when the disk pre already carries the pattern (occurrence added)', () => {
    // Delta semantics are a per-string multiset: 1 -> 2 occurrences is an added
    // instance, debt does not absolve a NEW one. Mutation caught: presence-based
    // composition (pattern-in-pre would forgive every further insertion forever).
    writeFileSync(target, `${BANNED} already lives here\n`);

    const result = spawnBody(`echo '${BANNED}' >> ${target}`);

    expect(result.status).toBe(1);
  });

  it('upholds a clean append onto a clean file (passed direction, AC §3.3)', () => {
    // Axis "verdict" passed end: computable + no violation = exit 0, no new event
    // vocabulary. Mutation caught: the enrichment blocking whenever ANY derivation
    // exists (ordinary shell writes in scope would all block).
    writeFileSync(target, 'plain line\n');

    const result = spawnBody(`echo 'still clean' >> ${target}`);

    expect(result.status).toBe(0);
  });

  it('breaks a heredoc CREATE of an absent file whose body carries the pattern (AC §3.1)', () => {
    // Absent file = create: the whole post is added (§2-b, adapter readPreState
    // precedent). Mutation caught: the disk read's ENOENT degrading the evidence to
    // unjudgeable — the brand-new violation would silently uphold.
    const command = lines(`cat > ${target} <<'EOF'`, `${BANNED} rides in the body`, 'EOF');

    const result = spawnBody(command);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no-banned');
  });
});

// ===========================================================================
// Audit-round gaps (2026-07-27) — registration-layer routing (G1/G4)
// ===========================================================================

describe('shell-axis registrations — audit-round routing gaps (G1/G4)', () => {
  function commonRegOf(regs: CovenantRegistration[]): CovenantRegistration | undefined {
    return regs.find((reg) => reg.label === 'shell-unjudgeable');
  }

  it('the common registration matches a tokenize-failing command with subject "-"', () => {
    // (audit G1) Silence on an unparseable line would resurrect the quiet pass B3
    // measured. Mutation caught: the tokenize failure swallowed at the routing layer
    // (derive answering nothing, or its throw caught into a null match).
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));

    expect(commonRegOf(regs)?.matches?.(bashInput("echo 'x > f.ts"))).toBe('-');
  });

  it('an opaque command over an in-scope target routes the per-entry skip', () => {
    // (audit G4) Path known + scope-attributable = the entry's own label owns the row,
    // and the common backstop stays out. Mutation caught: the opaque head demoting the
    // case to the common bucket (per-label attribution lost), or both arms matching
    // (double row for one call).
    const regs = compileDisciplineRegistrations(specWith([deltaEntry]));
    const input = bashInput('$CMD > packages/core/src/a.ts');

    expect(skipArmsOf(regs, deltaEntry.id)[0]?.matches?.(input)).toBe('packages/core/src/a.ts');
    expect(commonRegOf(regs)?.matches?.(input)).toBeNull();
  });
});

// ===========================================================================
// Audit-round gaps (2026-07-27) — body-level judgment (G2/G13/G5)
// ===========================================================================

describe('discipline-body CLI — absent-file append, same-path chaining, context verdict', () => {
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

  function spawnEntryBody(entry: DisciplineEntry, command: string, extraArgs: string[] = []) {
    return spawnSync(
      process.execPath,
      [
        bodyPath,
        '--discipline',
        JSON.stringify(entry),
        '--root-dir',
        dir,
        '--shell-tool',
        SHELL_TOOL,
        '--command-arg',
        COMMAND_ARG,
        ...extraArgs,
      ],
      { input: JSON.stringify(bashInput(command)), encoding: 'utf-8' },
    );
  }

  it('breaks an append that CREATES an absent file (pre null, whole post added)', () => {
    // (audit G2) §2-b: `>>` onto a missing file is a create — the adapter readPreState
    // precedent. Mutation caught: the ENOENT read demoting append evidence to
    // unjudgeable, so a brand-new violation lands as a skip row instead of a block.
    const fresh = join(dir, 'scoped', 'fresh.ts');

    const result = spawnEntryBody(forbidEntry, `echo '${BANNED}' >> ${fresh}`);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no-banned');
  });

  it('chains same-path evidence in command order, not against disk pre twice', () => {
    // (audit G13) Disk pre already carries the pattern and the FIRST write truncates
    // it away. A no-chain body judging disk-pre → final-post sees the occurrence count
    // unchanged (1→1, forgiven as debt) and upholds; correct chaining hands evidence2
    // pre='clean\n', so its append is 0→1 added and breaks.
    writeFileSync(target, `${BANNED}\n`);

    const result = spawnEntryBody(
      forbidEntry,
      `echo 'clean' > ${target} && echo '${BANNED}' >> ${target}`,
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no-banned');
  });

  it('a context entry judges a computable shell write by the transported verdict', () => {
    // (audit G5) First interaction of the derivation trigger with the argv verdict:
    // missing → judged break (exit 1), found → uphold (exit 0). Mutation caught:
    // context bodies ignoring derived evidence (a missing-precedent shell write
    // upholds — fail-open), or breaking on derivation alone regardless of the verdict.
    const contextEntry = {
      id: 'needs-view',
      in: ['scoped/**'],
      requirePrecedent: { command: 'npm view ' },
    } as DisciplineEntry;
    writeFileSync(target, 'plain line\n');
    const command = `echo 'dep bump' > ${target}`;

    const missing = spawnEntryBody(contextEntry, command, ['--precedent-missing']);
    const found = spawnEntryBody(contextEntry, command, ['--precedent-found']);

    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain('needs-view');
    expect(found.status).toBe(0);
  });
});
