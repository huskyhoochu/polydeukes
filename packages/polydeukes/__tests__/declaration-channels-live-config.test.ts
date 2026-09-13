import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type AlgebraDeclarationBody, declarationChannels } from '@polydeukes/core';
import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

// This repository's own config as the fixture: every judged entry's channel set, derived
// from its declaration syntax by core's `declarationChannels`, against the table its
// placement follows. The entries are gathered from all three lists so the oracle reads the
// same whether the file has been split yet or not — what it pins is the derivation, and
// the placement validator's job is a separate suite. The set is compared sorted: order is
// not part of the contract.

const REPO_ROOT = resolve(import.meta.dirname, '../../..');
const CONFIG_PATH = resolve(REPO_ROOT, 'polydeukes.config.yaml');

type Entry = { id: string; declare?: AlgebraDeclarationBody; draft?: true };
type Lists = {
  disciplines?: Entry[];
  sessionDisciplines?: Entry[];
  changeSetDisciplines?: Entry[];
};

/** The channel set each judged entry of this repository's config reads. */
const EXPECTED: Record<string, string[]> = {
  // file-shaped: stand on both surfaces
  'covenant-vocabulary': [],
  'english-only-sources': [],
  'comments-state-facts': [],
  'barrels-only-reexport': [],
  'tests-import-modules': [],
  'core-stays-runner-agnostic': [],
  'sqlite-only-under-knowledge': [],
  'changelog-keeps-every-release': [],
  'valve-is-not-the-agents': [],
  'schema-enums-agree': [],
  'agent-models-in-tiers': [],
  // the command line
  'hooks-stay-armed': ['command'],
  'work-stays-recoverable': ['command'],
  'pnpm-only': ['command'],
  'commits-come-from-the-main-session': ['actor', 'command'],
  // the session history
  'manifest-needs-evidence': ['transcript'],
  'covenant-needs-knowledge-read': ['transcript'],
  'core-needs-knowledge-read': ['transcript'],
  'adapter-needs-knowledge-read': ['transcript'],
  'prd-needs-its-method-read': ['transcript'],
  'tests-before-implementation': ['transcript'],
  'merge-is-the-users-call': ['command', 'transcript'],
  'branches-come-from-a-ticket': ['command', 'transcript'],
  // the actor
  'tests-are-the-writers': ['actor'],
  // the change set
  'docs-stay-bilingual': ['changes'],
};
/** The one draft: no declaration, so no channel set. */
const DRAFT_ID = 'verbs-take-one-spec';

function liveEntries(): Entry[] {
  const lists = parseYaml(readFileSync(CONFIG_PATH, 'utf-8')) as Lists;
  return [
    ...(lists.disciplines ?? []),
    ...(lists.sessionDisciplines ?? []),
    ...(lists.changeSetDisciplines ?? []),
  ];
}

describe('the live config against the channel table', () => {
  it('carries exactly the 25 judged ids the table names plus the one draft', () => {
    // The table is the oracle; an entry added or renamed without a row here is a
    // placement nobody wrote down.
    const entries = liveEntries();
    const judged = entries.filter((entry) => entry.draft !== true).map((entry) => entry.id);
    const drafts = entries.filter((entry) => entry.draft === true).map((entry) => entry.id);

    expect(judged.sort()).toEqual(Object.keys(EXPECTED).sort());
    expect(drafts).toEqual([DRAFT_ID]);
  });

  it.each(Object.entries(EXPECTED))('%s reads %j', (id, channels) => {
    // One row per entry so a wrong derivation names the entry it got wrong. The
    // actor+command and command+transcript rows catch a derivation that stops at the first
    // channel; the eleven empty rows catch one that counts `target.path` or a `file`
    // binding as a channel.
    const entry = liveEntries().find((candidate) => candidate.id === id);
    expect(entry?.declare, `${id} has no declaration`).toBeDefined();

    const derived = declarationChannels(entry?.declare as AlgebraDeclarationBody);

    expect([...derived].sort()).toEqual([...channels].sort());
  });
});
