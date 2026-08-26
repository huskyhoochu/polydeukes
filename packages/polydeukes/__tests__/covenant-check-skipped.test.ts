import { readRecords } from '@polydeukes/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// The commit surface (`pdks covenant check`) has no session evidence channel, so
// context-family entries (`requirePrecedent`) are excluded from assembly: judging them
// against a noop transcript would block every trigger-matching commit, a verdict with no
// legitimate pass path. The exclusion is a real skip — unlike the command family, which
// is vacuously out of scope on this surface — so it surfaces in the data as one `skipped`
// record per excluded entry per matched change.
//
// Each test builds a real throwaway git repo and writes its own tmp config, so no
// protected path of THIS repository is ever referenced.
import { runCovenantCheck } from '../src/index.ts';
import { type CheckRepo, createCheckRepo } from './helpers.ts';

// The regexes below are data the config carries, not source literals.
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

/** Commit the config alone first: loadConfig protects its own file. */
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

describe('context family excluded from the commit surface', () => {
  it('passes (exit 0) a staged change whose context-family trigger matches', async () => {
    // The staged dependency line matches both `in` and `when`, and the surface has no
    // evidence channel, so the entry must not be judged. Assembled against a noop
    // transcript the evidence is always missing, blocking every matching commit.
    writeConfig({ disciplines: [npmViewEntry] });
    commitConfig();
    write('manifest.json', '{\n  "left-pad": "^1.3.0"\n}\n');
    git('add', 'manifest.json');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
  });

  it('records the skip under the entry id and the change it would have judged', async () => {
    // The trigger did match, so the skip must surface in the data with the subject a
    // verdict would have carried; a wrong label blinds per-discipline gain aggregation.
    writeConfig({ disciplines: [npmViewEntry] });
    commitConfig();
    write('manifest.json', '{\n  "left-pad": "^1.3.0"\n}\n');
    git('add', 'manifest.json');

    await runCovenantCheck({ repoRoot, telemetryPath });

    expect(skippedRecords()).toEqual([{ label: NPM_VIEW_ENTRY_ID, subject: 'manifest.json' }]);
  });

  it('records one skipped per matched change, the same unit every other event uses', async () => {
    // Cardinality follows the dispatch unit: the commit surface dispatches per staged
    // change, so two in-scope files produce two records exactly as passed and blocked do.
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
    // The scope gate that makes the number mean something: `docs/**` was not staged, so
    // that entry had nothing to judge and its exclusion cost nothing. A record per
    // configured entry rather than per matched change would track commit volume instead
    // of missed judgments.
    writeConfig({ disciplines: [npmViewEntry, docsEntry] });
    commitConfig();
    write('manifest.json', '{\n  "left-pad": "^1.3.0"\n}\n');
    git('add', 'manifest.json');

    await runCovenantCheck({ repoRoot, telemetryPath });

    expect(skippedRecords().map((record) => record.label)).toEqual([NPM_VIEW_ENTRY_ID]);
  });
});

describe('other families unchanged beside the exclusion', () => {
  it('a delta-family violation in the same config still blocks (exit 2) while the context entry is skipped', async () => {
    // The exclusion targets ONLY the context family: a filter that dropped the delta
    // family too would let the forbidden marker through unjudged.
    writeConfig({
      disciplines: [
        { id: 'no-todo', forbid: { added: 'TODO' }, in: 'lib/**/*.ts', enforce: 'block' },
        npmViewEntry,
      ],
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
    // The decisive contrast: the command family is vacuously out of scope on the commit
    // surface (no shell axis), so its exclusion stays silent; the context family's
    // trigger could genuinely match, so its exclusion must be recorded. Recording every
    // filtered entry regardless of family drowns the signal in noise.
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
    // No excluded entry, no noise: an unconditional record per run would pollute
    // unrelated runs' data.
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
    // A run that blocked because it could not assemble judged nothing, so it must not
    // also claim a deliberate skip: `skipped` means "this entry was consciously left out
    // of a working assembly", not "the run died before reaching it". The failure is
    // reached through the layering seam — core validates only the `adapters` container
    // and passes its contents through verbatim, so an unknown enforce level survives
    // defineConfig and throws in the git adapter's own resolver at assembly time.
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
    // An empty staging area returns early, before assembly, so the exclusion never
    // happens and nothing is recorded. Bookkeeping hoisted above that early return would
    // write a phantom record for every no-op run.
    writeConfig({ disciplines: [npmViewEntry] });
    commitConfig();

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(0);
    expect(skippedRecords()).toEqual([]);
  });

  it('excludes and records identically under enforce: advise', async () => {
    // The exclusion is an assembly-level fact of the surface, not a verdict, so the
    // enforce level must not change it: same exit 0, same single skipped record.
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
