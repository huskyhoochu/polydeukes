import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// The commit-surface TTY valve sits behind the verdict: the prompt fires only when a
// judge actually blocked, and it names the broken registration, the matched entry, and
// the commit-wide reach of the answer.
//
// Each test builds a real throwaway git repo and writes its own tmp config, so no
// protected path of THIS repository is ever referenced.
import { runCovenantCheck } from '../src/index.ts';
import { type CheckRepo, createCheckRepo, stubDistWithUnjudgeableSelfMod } from './helpers.ts';

const WITNESS_TOKEN = 'i-accept-this-commit-covenant';
const PROTECTED_ENTRY = 'secret.txt';
const SECOND_PROTECTED_ENTRY = 'guarded.txt';
const DISCIPLINE_ID = 'no-todo';
const DISCIPLINE_SCOPE = 'lib/**/*.ts';
const SCOPED_SOURCE = 'lib/a.ts';
const FORBIDDEN_TOKEN = 'TODO';
/** The umbrella's protected-paths registration label — an observable contract, not a fixture choice. */
const SELF_MOD_LABEL = 'self-mod';
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

describe('covenant check — the prompt fires only on a blocked verdict', () => {
  it('a commit matching a discipline but breaking nothing never prompts and records passed (F6)', async () => {
    // The discipline's `in:` scope matches the staged file, so the registration routes,
    // but the delta adds no forbidden match, so the judge upholds. A clean commit must
    // never see the token prompt, and the 'passed' row is what proves a verdict happened
    // rather than a routing-time bypass recorded as 'witnessed'.
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
    // The human must read what broke (label plus subject, the subject being the matched
    // protected entry) and how far the answer reaches — the cache means one answer covers
    // the whole commit. Distinctive substrings, not exact copy.
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
    // The copy states that only the full token opens the valve without printing the token
    // itself: echoing it turns "type it from memory" into "copy it from the screen".
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
    // A file that is both a protected path and a violating in-scope discipline edit breaks
    // two registrations within one dispatched change: the shared cached valve prompts for
    // the first blocked one and the second reuses the answer.
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
    // One commit, at most one prompt. The prompt copy's commit-wide statement is honest
    // only because this holds; without the cache a commit staging N protected files would
    // ask N times.
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
    // Config validation accepts a padded token and stores it verbatim, and ttlWitness
    // trims at assembly for that reason. Comparing against the raw token would reject the
    // human's clean answer, cache the refusal, and permanently shut the commit surface
    // that the session surface happily opens.
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
    // The cache must latch CLOSED before the seam runs. A seam that throws (EOF, SIGINT,
    // a closed fd) leaving the cache unset would send every later broken registration back
    // into the prompt branch, contradicting the copy's commit-wide promise. Two protected
    // changes give the second registration its chance to re-prompt.
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
    // Under advise the valve is never built, yet an unjudgeable outcome still translates
    // to 'blocked' at that level — so an implementation deriving "may prompt" from the
    // translated event alone would grow a TTY prompt on an advise commit.
    //
    // The stub is a mirror of the real build with ONE module replaced by a self-mod judge
    // that answers "cannot judge" whatever the payload, so the barrel still loads and
    // every other registration behaves normally.
    const stubDist = stubDistWithUnjudgeableSelfMod(repoRoot);
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
