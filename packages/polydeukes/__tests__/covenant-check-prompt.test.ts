import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// COVENANT-17 §4.5 RED phase — the commit-surface TTY valve moves behind the verdict and
// its prompt names what it witnesses. Two seam changes pinned here:
//   1. the prompt fires only when a judge actually BLOCKED (PR #38 review F6: today every
//      MATCHED registration prompts, so a clean commit touching an observed scope pays the
//      token ritual for nothing);
//   2. `ttyPrompt` widens from `() => string | null` to `(prompt: string) => string | null`
//      so the umbrella can put the broken registration's label, the matched entry, and the
//      commit-wide reach of the answer on screen (PR #38 review F1: the nameless prompt).
// Written in the CURRENT vocabulary (config key `witness`, event 'witnessed') per §4.7 step 1;
// the later mechanical rename sweeps the words, so this file's NAME stays vocabulary-neutral.
// The widened seam signature does not exist yet — transient type drift until GREEN; vitest
// transpiles without typechecking.
import { runCovenantCheck } from '../src/index.ts';
import { type CheckRepo, createCheckRepo } from './helpers.ts';

// ---------------------------------------------------------------------------
// Each test builds a real throwaway git repo AND writes its own tmp config file, so
// no protected path from THIS repository is ever referenced — the fixture configs are
// absolute tmp paths and safe to author (covenant-check.test.ts precedent, copied
// rather than shared: the fixture helpers live inline in that shipped file).
// ---------------------------------------------------------------------------

const WITNESS_TOKEN = 'i-accept-this-commit-covenant';
const PROTECTED_ENTRY = 'secret.txt';
const SECOND_PROTECTED_ENTRY = 'guarded.txt';
const DISCIPLINE_ID = 'no-todo';
const DISCIPLINE_SCOPE = 'lib/**/*.ts';
const SCOPED_SOURCE = 'lib/a.ts';
const FORBIDDEN_TOKEN = 'TODO';
/** The umbrella's protected-paths registration label — an observable contract, not a fixture choice. */
const SELF_MOD_LABEL = 'self-mod';
/** The judge body filename the commit surface composes for that registration (CONFIG-06b). */
const SELF_MOD_BODY = 'self-mod-body.js';

let repo: CheckRepo;
let repoRoot: string;
let telemetryPath: string;
let git: CheckRepo['git'];
let write: CheckRepo['write'];
let writeConfig: CheckRepo['writeConfig'];

/** Commit the config first so the staged batch is the target change alone. */
function commitConfig(): void {
  git('add', 'polydeukes.config.json');
  git('commit', '--quiet', '-m', 'config');
}

beforeEach(() => {
  repo = createCheckRepo('pdks-check-prompt-', DISCIPLINE_SCOPE);
  ({ repoRoot, telemetryPath, git, write, writeConfig } = repo);
});

afterEach(() => {
  repo.cleanup();
  vi.restoreAllMocks();
});

describe('COVENANT-17 §4.5 covenant check — the prompt fires only on a blocked verdict', () => {
  it('a commit matching a discipline but breaking nothing never prompts and records passed (F6)', async () => {
    // AC §5.2 first item, the F6 fix pinned end-to-end: the discipline's `in:` scope
    // matches the staged file (the registration ROUTES) but the delta adds no forbidden
    // match (the judge UPHOLDS) — a clean commit must never see the token prompt, and the
    // spawned judge's 'passed' row is what proves the verdict happened instead of a
    // routing-time bypass. Mutation caught: the witness still evaluated per MATCH (today's
    // timing — the prompt fires, the spawn is skipped, and a would-pass verdict is written
    // down as 'witnessed', the roi.log pollution §3 measured at 3,275 rows).
    writeConfig({
      disciplines: [
        { id: DISCIPLINE_ID, forbid: { added: FORBIDDEN_TOKEN }, in: DISCIPLINE_SCOPE },
      ],
      witness: { token: WITNESS_TOKEN, ttlMinutes: 5 },
    });
    write(SCOPED_SOURCE, 'export const x = 1;\n');
    git('add', SCOPED_SOURCE, 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'initial');
    write(SCOPED_SOURCE, 'export const x = 2;\n');
    git('add', SCOPED_SOURCE);
    const ttyPrompt = vi.fn((_prompt: string) => WITNESS_TOKEN);

    const result = await runCovenantCheck({ repoRoot, telemetryPath, ttyPrompt });

    expect(result.exitCode).toBe(0);
    expect(ttyPrompt).not.toHaveBeenCalled();
    const { records } = readRecords(telemetryPath);
    expect(records.some((record) => record.event === 'witnessed')).toBe(false);
    expect(
      records.some((record) => record.label === DISCIPLINE_ID && record.event === 'passed'),
    ).toBe(true);
  });

  it('the prompt text names the broken registration, the matched entry, and the commit-wide reach of the answer', async () => {
    // AC §5.3 items 1–2 (review F1): the human must read WHAT broke (label + subject, the
    // subject being the MATCHED protected entry per the dispatcher contract) and how far
    // the answer reaches (the cache means one answer covers the whole commit — §4.8 makes
    // the copy carry that scope). Distinctive substrings, not exact copy. Mutation caught:
    // the seam still called with zero arguments (today), or a prompt naming neither the
    // registration nor the entry.
    writeConfig({
      protectedPaths: [PROTECTED_ENTRY],
      witness: { token: WITNESS_TOKEN, ttlMinutes: 5 },
    });
    commitConfig();
    write(PROTECTED_ENTRY, 'sensitive\n');
    git('add', PROTECTED_ENTRY);
    const prompts: string[] = [];
    const ttyPrompt = vi.fn((prompt: string) => {
      prompts.push(prompt);
      return WITNESS_TOKEN;
    });

    const result = await runCovenantCheck({ repoRoot, telemetryPath, ttyPrompt });

    expect(result.exitCode).toBe(0);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain(SELF_MOD_LABEL);
    expect(prompts[0]).toContain(PROTECTED_ENTRY);
    expect(prompts[0]).toMatch(/(whole|entire) commit/i);
    // AUDIT gap (a): the copy must state that only the full token opens the valve WITHOUT
    // printing the token itself — a prompt echoing the phrase turns "type it from memory"
    // (the conscious moment §4.8 keeps) into "copy it from the screen".
    expect(prompts[0]).not.toContain(WITNESS_TOKEN);
    const { records } = readRecords(telemetryPath);
    expect(
      records.some(
        (record) =>
          record.event === 'witnessed' &&
          record.label === SELF_MOD_LABEL &&
          record.subject === PROTECTED_ENTRY,
      ),
    ).toBe(true);
  });

  it('two registrations breaking on ONE staged change prompt exactly once (the first broken one is named)', async () => {
    // AUDIT gap (c) / PRD §4.8 pinned: within a single dispatched change, a file that is
    // BOTH a protected path (self-mod breaks) and a violating in-scope discipline edit
    // breaks two registrations — the shared cached valve prompts for the FIRST blocked
    // one and the second reuses the answer. Mutation caught: a per-registration valve
    // losing the shared cache (two prompts for one staged file).
    writeConfig({
      protectedPaths: ['lib'],
      disciplines: [
        {
          id: DISCIPLINE_ID,
          forbid: { added: FORBIDDEN_TOKEN },
          in: DISCIPLINE_SCOPE,
          enforce: 'block',
        },
      ],
      witness: { token: WITNESS_TOKEN, ttlMinutes: 5 },
    });
    commitConfig();
    write(SCOPED_SOURCE, `// ${FORBIDDEN_TOKEN}: forbidden marker\n`);
    git('add', SCOPED_SOURCE);
    const ttyPrompt = vi.fn((_prompt: string) => WITNESS_TOKEN);

    const result = await runCovenantCheck({ repoRoot, telemetryPath, ttyPrompt });

    expect(result.exitCode).toBe(0);
    expect(ttyPrompt).toHaveBeenCalledTimes(1);
    const witnessedLabels = readRecords(telemetryPath)
      .records.filter((record) => record.event === 'witnessed')
      .map((record) => record.label);
    expect(witnessedLabels).toContain(SELF_MOD_LABEL);
    expect(witnessedLabels).toContain(DISCIPLINE_ID);
  });

  it('two protected staged changes prompt exactly once, and the cached answer clears both (exit 0)', async () => {
    // AC §5.3 item 3 ("one commit, at most one prompt"), green today too: the cache is
    // retained across the timing move (§4.5), and the prompt copy's commit-wide statement
    // is honest only because this holds. Mutation caught: the per-verdict prompt losing
    // the cache — a commit staging N protected files asking N times.
    writeConfig({
      protectedPaths: [PROTECTED_ENTRY, SECOND_PROTECTED_ENTRY],
      witness: { token: WITNESS_TOKEN, ttlMinutes: 5 },
    });
    commitConfig();
    write(PROTECTED_ENTRY, 'a\n');
    write(SECOND_PROTECTED_ENTRY, 'b\n');
    git('add', PROTECTED_ENTRY, SECOND_PROTECTED_ENTRY);
    const ttyPrompt = vi.fn((_prompt: string) => WITNESS_TOKEN);

    const result = await runCovenantCheck({ repoRoot, telemetryPath, ttyPrompt });

    expect(result.exitCode).toBe(0);
    expect(ttyPrompt).toHaveBeenCalledTimes(1);
    const witnessedSubjects = readRecords(telemetryPath)
      .records.filter((record) => record.event === 'witnessed')
      .map((record) => record.subject);
    expect(witnessedSubjects).toContain(PROTECTED_ENTRY);
    expect(witnessedSubjects).toContain(SECOND_PROTECTED_ENTRY);
  });

  it('a padded config token still opens on a clean typed answer — both sides trimmed, session parity', async () => {
    // PR #41 review finding 1: config validation accepts a padded token and stores it
    // verbatim; ttlWitness trims at assembly for exactly that reason. Without the same
    // normalisation here, `'  token  '` in the config would reject the human's clean
    // answer, cache the refusal, and permanently shut the commit surface that the
    // session surface happily opens. Mutation caught: comparing against the raw token.
    writeConfig({
      protectedPaths: [PROTECTED_ENTRY],
      witness: { token: `  ${WITNESS_TOKEN}  `, ttlMinutes: 5 },
    });
    commitConfig();
    write(PROTECTED_ENTRY, 'sensitive\n');
    git('add', PROTECTED_ENTRY);
    const ttyPrompt = vi.fn((_prompt: string) => WITNESS_TOKEN);

    const result = await runCovenantCheck({ repoRoot, telemetryPath, ttyPrompt });

    expect(result.exitCode).toBe(0);
    expect(readRecords(telemetryPath).records.some((record) => record.event === 'witnessed')).toBe(
      true,
    );
  });

  it('a throwing prompt seam is consulted once, stays closed, and never re-prompts (exit 2)', async () => {
    // PR #41 review finding 3: the cache must latch CLOSED before the seam runs. A seam
    // that throws (EOF, SIGINT, a closed fd) previously left the cache unset, so every
    // later broken registration re-entered the prompt branch — contradicting the copy's
    // own commit-wide promise. Two protected changes give the second registration its
    // chance to re-prompt; the count pins that it never does.
    writeConfig({
      protectedPaths: [PROTECTED_ENTRY, SECOND_PROTECTED_ENTRY],
      witness: { token: WITNESS_TOKEN, ttlMinutes: 5 },
    });
    commitConfig();
    write(PROTECTED_ENTRY, 'a\n');
    write(SECOND_PROTECTED_ENTRY, 'b\n');
    git('add', PROTECTED_ENTRY, SECOND_PROTECTED_ENTRY);
    const ttyPrompt = vi.fn((_prompt: string): string | null => {
      throw new Error('tty seam blew up');
    });

    const result = await runCovenantCheck({ repoRoot, telemetryPath, ttyPrompt });

    expect(result.exitCode).toBe(2);
    expect(ttyPrompt).toHaveBeenCalledTimes(1);
    const { records } = readRecords(telemetryPath);
    expect(records.some((record) => record.event === 'witnessed')).toBe(false);
    expect(records.filter((record) => record.event === 'blocked').length).toBeGreaterThanOrEqual(2);
  });

  it('under advise an unjudgeable judge (body exit 2) blocks without ever prompting', async () => {
    // AC §5.2 last item — the CONFIG-06 §4.6 structural absence survives the new timing:
    // under advise the valve is never built, and an unjudgeable outcome still translates
    // to 'blocked' even at that level, so without the absence an advise commit would grow
    // a TTY prompt. Green today; it pins the future against a GREEN that derives "may
    // prompt" from the translated event alone. Mutation caught: the advise branch wiring
    // a valve because the translation says blocked.
    const stubDist = join(repoRoot, 'covenant-dist-stub');
    mkdirSync(stubDist, { recursive: true });
    // A judge body that answers "cannot judge" (exit 2) no matter the payload.
    writeFileSync(join(stubDist, SELF_MOD_BODY), 'process.exit(2);\n');
    writeConfig({
      protectedPaths: [PROTECTED_ENTRY],
      witness: { token: WITNESS_TOKEN, ttlMinutes: 5 },
      adapters: { git: { enforce: 'advise' } },
    });
    commitConfig();
    write(PROTECTED_ENTRY, 'sensitive\n');
    git('add', PROTECTED_ENTRY);
    const ttyPrompt = vi.fn((_prompt: string) => WITNESS_TOKEN);

    const result = await runCovenantCheck({
      repoRoot,
      telemetryPath,
      covenantDist: stubDist,
      ttyPrompt,
    });

    expect(result.exitCode).toBe(2);
    expect(ttyPrompt).not.toHaveBeenCalled();
    const { records } = readRecords(telemetryPath);
    expect(records.some((record) => record.event === 'witnessed')).toBe(false);
    expect(
      records.some((record) => record.event === 'blocked' && record.label === SELF_MOD_LABEL),
    ).toBe(true);
  });
});
