import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

// ---------------------------------------------------------------------------
// Each test builds a real throwaway git repo AND writes its own tmp config file, so
// no protected path from THIS repository is ever referenced — the fixture configs are
// absolute tmp paths and safe to author.
// ---------------------------------------------------------------------------

// Context-family fixture entries (injected values, PRD §4.1 shape). The regexes are
// data the config carries, not source literals.
const NPM_VIEW_ENTRY_ID = 'dependency-needs-npm-view';
const npmViewEntry = {
  id: NPM_VIEW_ENTRY_ID,
  in: 'manifest.json',
  when: '^\\s*"[^"]+"\\s*:\\s*"[~^]?\\d',
  requirePrecedent: { command: 'npm view ' },
};
const DOCS_ENTRY_ID = 'design-doc-first';
const docsEntry = {
  id: DOCS_ENTRY_ID,
  in: 'docs/**/*.md',
  requirePrecedent: { command: 'memory search ' },
};

let repoRoot: string;
let telemetryPath: string;

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8' });
}

function write(relPath: string, content: string): void {
  const absolute = join(repoRoot, relPath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

/** Minimal valid config (languages is required) plus the caller's extra keys. */
function writeConfig(extra: Record<string, unknown>): void {
  const config = {
    languages: {
      typescript: { productionGlob: 'lib/**/*.ts', testCmd: 'echo {scope}' },
    },
    telemetry: { logPath: telemetryPath },
    ...extra,
  };
  writeFileSync(join(repoRoot, 'polydeukes.config.json'), JSON.stringify(config, null, 2));
}

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
  repoRoot = mkdtempSync(join(tmpdir(), 'pdks-check-skipped-'));
  telemetryPath = join(repoRoot, 'roi.log');
  git('init', '--quiet');
  git('config', 'user.email', 'test@polydeukes.local');
  git('config', 'user.name', 'Polydeukes Test');
  git('config', 'commit.gpgsign', 'false');
});

afterEach(() => {
  rmSync(repoRoot, { recursive: true, force: true });
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

  it('records exactly one skipped record with label = entry id and subject = "-"', async () => {
    // P0 no-silent-skip: the exclusion is a real skip (the trigger DID match) and must
    // surface in the data. Mutation caught: exclusion without any record (silent skip),
    // a wrong label (not the entry id), or a real subject leaking into the assembly-level
    // sentinel slot.
    writeConfig({ disciplines: [npmViewEntry] });
    commitConfig();
    write('manifest.json', '{\n  "left-pad": "^1.3.0"\n}\n');
    git('add', 'manifest.json');

    await runCovenantCheck({ repoRoot, telemetryPath });

    expect(skippedRecords()).toEqual([{ label: NPM_VIEW_ENTRY_ID, subject: '-' }]);
  });

  it('records skipped ONCE per check run, not once per staged change', async () => {
    // P0 cardinality: exclusion is an assembly-level fact. With two in-scope staged
    // files, a per-change dispatch loop that emits skipped inside the loop would write
    // two records. Mutation caught: skipped emitted per file change instead of per run.
    writeConfig({ disciplines: [docsEntry] });
    commitConfig();
    write('docs/one.md', '# one\n');
    write('docs/two.md', '# two\n');
    git('add', 'docs/one.md', 'docs/two.md');

    await runCovenantCheck({ repoRoot, telemetryPath });

    expect(skippedRecords()).toEqual([{ label: DOCS_ENTRY_ID, subject: '-' }]);
  });

  it('records one skipped per context-family entry, each under its own id', async () => {
    // Two excluded entries → two records, each labelled with its own id. Mutation
    // caught: only the first excluded entry recorded, or one aggregate record for the
    // whole family (which would make per-discipline gain aggregation blind).
    writeConfig({ disciplines: [npmViewEntry, docsEntry] });
    commitConfig();
    write('manifest.json', '{\n  "left-pad": "^1.3.0"\n}\n');
    git('add', 'manifest.json');

    await runCovenantCheck({ repoRoot, telemetryPath });

    const labels = skippedRecords()
      .map((record) => record.label)
      .sort();
    expect(labels).toEqual([NPM_VIEW_ENTRY_ID, DOCS_ENTRY_ID].sort());
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
    git('add', 'lib/a.ts');

    const result = await runCovenantCheck({ repoRoot, telemetryPath });

    expect(result.exitCode).toBe(2);
    const { records } = readRecords(telemetryPath);
    expect(records.some((record) => record.event === 'blocked')).toBe(true);
    expect(skippedRecords()).toEqual([{ label: NPM_VIEW_ENTRY_ID, subject: '-' }]);
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
    expect(skippedRecords()).toEqual([{ label: NPM_VIEW_ENTRY_ID, subject: '-' }]);
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
    expect(skippedRecords()).toEqual([{ label: NPM_VIEW_ENTRY_ID, subject: '-' }]);
  });
});
