import {
  type CheckCovenantVerdict,
  type CovenantInput,
  checkChangeSet,
  checkCovenant,
  type MemoryIngestOutcome,
  type MemorySearchOutcome,
  memoryIngest,
  memorySearch,
} from '@polydeukes/sdk-ts';

const input: CovenantInput = {
  toolCalls: [
    {
      name: 'fixture-edit',
      args: {},
      fileChange: { kind: 'create', path: 'file.ts', post: 'content' },
    },
  ],
  subagentSpawns: [],
  userMessages: [],
};
function unreachable(value: never): never {
  throw new Error(String(value));
}
function covenant(value: CheckCovenantVerdict): string {
  switch (value.verdict) {
    case 'upheld':
      return value.advisories;
    case 'blocked':
      return value.reason;
    case 'unjudged':
      return value.reason;
    default:
      return unreachable(value);
  }
}
function ingest(value: MemoryIngestOutcome): string {
  switch (value.outcome) {
    case 'ingested':
      return 'ingested';
    case 'unavailable':
      return value.reason;
    default:
      return unreachable(value);
  }
}
function search(value: MemorySearchOutcome): string {
  switch (value.outcome) {
    case 'found':
      return value.hits[0].id;
    case 'empty':
      return 'empty';
    case 'unavailable':
      return value.reason;
    default:
      return unreachable(value);
  }
}
async function example(): Promise<void> {
  const settings = { executable: '/opt/pdks', timeoutMs: 2000 };
  covenant(await checkCovenant({ ...settings, repoRoot: '.', input }));
  covenant(await checkChangeSet({ ...settings, repoRoot: '.', diff: '' }));
  ingest(await memoryIngest({ ...settings, root: '.' }));
  search(await memorySearch({ ...settings, root: '.', query: 'word', limit: 1 }));
}
void example;
