import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// COVENANT-13 §4.5 RED phase — AC 10, umbrella layer only. The commit surface
// (`pdks covenant check`) has no session evidence channel, so context-family entries
// (`requirePrecedent`) MUST be excluded from assembly — judging them against a noop
// transcript would block every trigger-matching commit, a verdict with no legitimate
// pass path. The exclusion is a REAL skip (unlike the command family, which is vacuously
// out of scope on this surface), so it must surface in the data: one `skipped` telemetry
// record per excluded entry per check run (label = entry id, subject = '-').
//
// RED by construction: `skipped` is not in core's TelemetryEvent yet (opened by the core
// layer of this same ticket), so `record.event === 'skipped'` fails typecheck AND parsed
// records can never carry it at runtime until GREEN. The schema also still rejects
// `requirePrecedent`, so every config below currently fails validation (exit 2).
import { runCovenantCheck } from '../src/index.ts';
import { type CheckRepo, createCheckRepo } from './helpers.ts';

// ---------------------------------------------------------------------------
// Each test builds a real throwaway git repo AND writes its own tmp config file, so
// no protected path from THIS repository is ever referenced — the fixture configs are
// absolute tmp paths and safe to author.
// ---------------------------------------------------------------------------

// Context-family fixture entries (injected values, PRD §4.1 shape). The regexes are
// data the config carries, not source literals.
//
// The `when` pattern anchors with `(^|\n)`, not a bare `^`: the trigger is tested against
// whole file content with no multiline flag, so a lone `^` would only ever match line 1 —
// and a dependency line never IS line 1 of a manifest. With a bare `^` every fixture below
// would pass for the wrong reason (trigger never matched), making the exclusion tests
// vacuous. The alternation makes the premise "the trigger genuinely matches" true.
const NPM_VIEW_ENTRY_ID = 'dependency-needs-npm-view';
const npmViewEntry = {
  id: NPM_VIEW_ENTRY_ID,
  in: 'manifest.json',
  when: '(^|\\n)\\s*"[^"]+"\\s*:\\s*"[~^]?\\d',
  requirePrecedent: { command: 'npm view ' },
};
const DOCS_ENTRY_ID = 'design-doc-first';
const docsEntry = {
  id: DOCS_ENTRY_ID,
  in: 'docs/**/*.md',
  requirePrecedent: { command: 'memory search ' },
};

let repo: CheckRepo;
let repoRoot: string;
let telemetryPath: string;
let git: CheckRepo['git'];
let write: CheckRepo['write'];
let writeConfig: CheckRepo['writeConfig'];

/** Commit the config alone first: loadConfig protects its own file (CONFIG-03 rule 6). */
function commitConfig(): void {
  git('add', 'polydeukes.config.json');
  git('commit', '--quiet', '-m', 'config');
}

function skippedRecords(): { label: string; subject: string }[] {
  return readRecords(telemetryPath)
    .records.filter((record) => record.event === 'skipped')
    .map((record) => ({ label: record.label, subject: record.subject }));
}

beforeEach(() => {
  repo = createCheckRepo('pdks-check-skipped-');
  ({ repoRoot, telemetryPath, git, write, writeConfig } = repo);
});

afterEach(() => {
  repo.cleanup();
});

describe('COVENANT-13 §4.5 AC-10 context family excluded from the commit surface', () => {
  it('passes (exit 0) a staged change whose context-family trigger matches', async () => {
    // P0 legitimate-pass-path proof: the staged dependency line matches both `in` and
    // `when`, and the commit surface has no evidence channel — so the entry must NOT be
    // judged. Mutation caught: the context family assembled against a noop transcript
    // (evidence always missing → every matching commit blocked, a validator with no
    // legitimate pass path), or the schema still rejecting `requirePrecedent`.
    writeConfig({ disciplines: [npmViewEntry] });
    commitConfig();
    write('manifest.json', '{\n  "left-pad": "^1.3.0"\n}\n');
    git('add', 'manifest.json');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
  });

  it('records the skip under the entry id and the change it would have judged', async () => {
    // No-silent-skip: the trigger DID match, so the skip must surface in the data with
    // the subject a verdict would have carried. Mutation caught: exclusion without any
    // record, or a wrong label that blinds per-discipline gain aggregation.
    writeConfig({ disciplines: [npmViewEntry] });
    commitConfig();
    write('manifest.json', '{\n  "left-pad": "^1.3.0"\n}\n');
    git('add', 'manifest.json');

    await runCovenantCheck({ repoRoot, telemetryPath });

    expect(skippedRecords()).toEqual([{ label: NPM_VIEW_ENTRY_ID, subject: 'manifest.json' }]);
  });

  it('records one skipped per matched change, the same unit every other event uses', async () => {
    // Cardinality follows the dispatch unit: the commit surface dispatches per staged
    // change (N:N), so two in-scope files produce two records exactly as passed and
    // blocked do. Mutation caught: a run-level record smuggled back in beside the loop.
    writeConfig({ disciplines: [docsEntry] });
    commitConfig();
    write('docs/one.md', '# one\n');
    write('docs/two.md', '# two\n');
    git('add', 'docs/one.md', 'docs/two.md');

    await runCovenantCheck({ repoRoot, telemetryPath });

    expect(
      skippedRecords()
        .map((record) => record.subject)
        .sort(),
    ).toEqual(['docs/one.md', 'docs/two.md']);
  });

  it('records nothing for a context entry whose scope the commit never touched', async () => {
    // The scope gate that makes the number mean something. `docs/**` was not staged, so
    // that entry had nothing to judge and its exclusion cost nothing. Mutation caught:
    // the record emitted per configured entry rather than per matched change — the count
    // would track commit volume instead of missed judgments, and `gain` would report a
    // gate "skipped N times" where the true number is near zero.
    writeConfig({ disciplines: [npmViewEntry, docsEntry] });
    commitConfig();
    write('manifest.json', '{\n  "left-pad": "^1.3.0"\n}\n');
    git('add', 'manifest.json');

    await runCovenantCheck({ repoRoot, telemetryPath });

    expect(skippedRecords().map((record) => record.label)).toEqual([NPM_VIEW_ENTRY_ID]);
  });
});

describe('COVENANT-13 §4.5 AC-10 other families unchanged beside the exclusion', () => {
  it('a delta-family violation in the same config still blocks (exit 2) while the context entry is skipped', async () => {
    // P0 regression + over-broad-filter probe: the exclusion targets ONLY the context
    // family. Mutation caught: the assembly filter dropping the delta family too (the
    // forbidden TODO would sail through, fail-open), or the skipped bookkeeping breaking
    // the judged families' dispatch.
    writeConfig({
      disciplines: [{ id: 'no-todo', forbid: { added: 'TODO' }, in: 'lib/**/*.ts' }, npmViewEntry],
    });
    write('lib/a.ts', 'export const x = 1;\n');
    git('add', 'lib/a.ts', 'polydeukes.config.json');
    git('commit', '--quiet', '-m', 'initial');
    write('lib/a.ts', 'export const x = 1;\n// TODO fix later\n');
    // Both families need an in-scope change, or the contrast is vacuous: the context
    // entry is scoped to the manifest, and an untouched scope now records nothing.
    write('manifest.json', '{\n  "left-pad": "^1.3.0"\n}\n');
    git('add', 'lib/a.ts', 'manifest.json');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(2);
    const { records } = readRecords(telemetryPath);
    expect(records.some((record) => record.event === 'blocked')).toBe(true);
    expect(skippedRecords()).toEqual([{ label: NPM_VIEW_ENTRY_ID, subject: 'manifest.json' }]);
  });

  it('a command-family entry records NO skipped — only the context entry does', async () => {
    // The decisive contrast (PRD §4.5): the command family is vacuously out of scope on
    // the commit surface (no shell axis), so its exclusion stays silent; the context
    // family's trigger could genuinely match, so its exclusion must be recorded.
    // Mutation caught: skipped emitted for every filtered entry regardless of family,
    // drowning the signal in noise.
    writeConfig({
      disciplines: [{ id: 'no-force-push', forbidCommand: 'push\\s+--force' }, npmViewEntry],
    });
    commitConfig();
    write('manifest.json', '{\n  "left-pad": "^1.3.0"\n}\n');
    git('add', 'manifest.json');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
    expect(skippedRecords()).toEqual([{ label: NPM_VIEW_ENTRY_ID, subject: 'manifest.json' }]);
  });

  it('records zero skipped when the config has no context-family entry', async () => {
    // No excluded entry → no noise. Mutation caught: an unconditional skipped record
    // per run (or per non-context discipline), polluting unrelated runs' data.
    writeConfig({
      disciplines: [{ id: 'no-todo', forbid: { added: 'TODO' }, in: 'lib/**/*.ts' }],
    });
    commitConfig();
    write('lib/clean.ts', 'export const y = 2;\n');
    git('add', 'lib/clean.ts');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
    expect(skippedRecords()).toEqual([]);
  });

  it('records zero skipped when assembly itself fails closed', async () => {
    // P0 ordering boundary (review F7): a run that blocked because it could not assemble
    // judged nothing, so it must not also claim a deliberate skip — `skipped` means "this
    // entry was consciously left out of a working assembly", not "the run died before
    // reaching it". The failure is reached through the CONFIG-07 layering seam: core
    // validates only the `adapters` container and passes contents through verbatim, so an
    // unknown enforce level survives defineConfig and throws in the git adapter's own
    // resolver at assembly time. Mutation caught: the skipped bookkeeping hoisted above
    // the assembly block, inflating skip counts with runs that never judged anything.
    writeConfig({
      disciplines: [npmViewEntry],
      adapters: { git: { enforce: 'loud' } },
    });
    commitConfig();
    write('manifest.json', '{\n  "left-pad": "^1.3.0"\n}\n');
    git('add', 'manifest.json');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(2);
    expect(skippedRecords()).toEqual([]);
  });

  it('records zero skipped when nothing is staged at all', async () => {
    // P0 boundary the other fixtures never reach: an empty staging area returns early,
    // BEFORE assembly, so the exclusion never happens and nothing is recorded. Mutation
    // caught: the skipped bookkeeping hoisted above the empty-staging early return, which
    // would write a phantom record for every no-op run (e.g. `git commit --amend` with
    // nothing staged) and inflate the per-discipline skip counts.
    writeConfig({ disciplines: [npmViewEntry] });
    commitConfig();

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
    expect(skippedRecords()).toEqual([]);
  });

  it('excludes and records identically under enforce: advise', async () => {
    // Decision item (reported, not in the PRD): the exclusion is an assembly-level fact
    // of the surface, not a verdict, so the enforce level must not change it — same
    // exit 0, same single skipped record. Mutation caught: skipped recording gated on
    // the block level only, losing the measurement exactly where this repo runs
    // (this repo's own config is advise).
    writeConfig({
      disciplines: [npmViewEntry],
      adapters: { git: { enforce: 'advise' } },
    });
    commitConfig();
    write('manifest.json', '{\n  "left-pad": "^1.3.0"\n}\n');
    git('add', 'manifest.json');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
    expect(skippedRecords()).toEqual([{ label: NPM_VIEW_ENTRY_ID, subject: 'manifest.json' }]);
  });
});
