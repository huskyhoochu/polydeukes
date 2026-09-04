// A draft entry changes NO judgment on either surface: the config with a draft and the
// config without it produce identical exit codes and identical telemetry rows, and no
// row ever carries the draft id.
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runClaudeCodeHook } from '../src/claude-code-hook.ts';
import { runCovenantCheck } from '../src/covenant-check.ts';
import {
  type CheckRepo,
  createCheckRepo,
  DEFAULT_PRODUCTION_GLOB,
  telemetryRows,
  writeConfigAt,
} from './helpers.ts';

const DRAFT_ID = 'bilingual-docs-sync';
const draftEntry = { id: DRAFT_ID, why: 'keep the en and ko doc mirrors in sync', draft: true };
const judgedForbid = { id: 'no-todo', forbid: 'TODO', in: DEFAULT_PRODUCTION_GLOB };

const JUDGED_ONLY = [judgedForbid];
const WITH_DRAFT = [judgedForbid, draftEntry];

const PASSING_CONTENT = 'export const a = 1;\n';
const BREAKING_CONTENT = 'export const a = 1; // TODO remove\n';

/** Rows with the repo root replaced, so two throwaway repos compare row-for-row. */
function normalizedRows(telemetryPath: string, repoRoot: string): [string, string, string][] {
  return telemetryRows(telemetryPath).map(([event, label, subject]) => [
    event,
    label,
    subject.split(repoRoot).join('<root>'),
  ]);
}

describe('session surface judgment parity', () => {
  let repos: CheckRepo[];

  beforeEach(() => {
    repos = [];
  });

  afterEach(() => {
    for (const repo of repos) {
      repo.cleanup();
    }
  });

  /** Run the session hook once in a fresh repo under the given disciplines. */
  async function sessionRun(
    disciplines: unknown[],
    content: string,
  ): Promise<{ exitCode: number; rows: [string, string, string][] }> {
    const repo = createCheckRepo('pdks-draft-parity-session-');
    repos.push(repo);
    writeConfigAt(repo.repoRoot, repo.telemetryPath, { disciplines });
    const rawPayload = JSON.stringify({
      tool_name: 'Write',
      tool_input: { file_path: join(repo.repoRoot, 'lib/a.ts'), content },
    });

    const { exitCode } = await runClaudeCodeHook({
      repoRoot: repo.repoRoot,
      rawPayload,
      telemetryPath: repo.telemetryPath,
    });
    return { exitCode, rows: normalizedRows(repo.telemetryPath, repo.repoRoot) };
  }

  it.each([
    ['passing', PASSING_CONTENT],
    ['breaking', BREAKING_CONTENT],
  ] as const)('the %s payload: identical exit and rows with and without the draft', async (_kind, content) => {
    // Any divergence means the draft reached a judge.
    const without = await sessionRun(JUDGED_ONLY, content);
    const withDraft = await sessionRun(WITH_DRAFT, content);

    expect(withDraft.exitCode).toBe(without.exitCode);
    expect(withDraft.rows).toEqual(without.rows);
    // A row carrying the draft id would be a judgment the entry never promised.
    for (const [, label, subject] of withDraft.rows) {
      expect(label).not.toContain(DRAFT_ID);
      expect(subject).not.toContain(DRAFT_ID);
    }
  });
});

describe('commit surface judgment parity', () => {
  let repos: CheckRepo[];

  beforeEach(() => {
    repos = [];
  });

  afterEach(() => {
    for (const repo of repos) {
      repo.cleanup();
    }
  });

  /** Stage one file and run `covenant check` in a fresh repo under the given disciplines. */
  async function commitRun(
    disciplines: unknown[],
    content: string,
  ): Promise<{ exitCode: number; rows: [string, string, string][] }> {
    const repo = createCheckRepo('pdks-draft-parity-commit-');
    repos.push(repo);
    repo.writeConfig({ disciplines });
    repo.write('lib/a.ts', content);
    repo.git('add', 'lib/a.ts');

    const { exitCode } = await runCovenantCheck({
      repoRoot: repo.repoRoot,
      telemetryPath: repo.telemetryPath,
    });
    return { exitCode, rows: normalizedRows(repo.telemetryPath, repo.repoRoot) };
  }

  it.each([
    ['passing', PASSING_CONTENT],
    ['breaking', BREAKING_CONTENT],
  ] as const)('the %s staged diff: identical exit and rows with and without the draft', async (_kind, content) => {
    // Same contract as the session case, observed on the staged-diff re-observation.
    const without = await commitRun(JUDGED_ONLY, content);
    const withDraft = await commitRun(WITH_DRAFT, content);

    expect(withDraft.exitCode).toBe(without.exitCode);
    expect(withDraft.rows).toEqual(without.rows);
    for (const [, label, subject] of withDraft.rows) {
      expect(label).not.toContain(DRAFT_ID);
      expect(subject).not.toContain(DRAFT_ID);
    }
  });
});
