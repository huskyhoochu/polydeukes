import type { CheckCovenantVerdict, CovenantInput } from '@polydeukes/sdk-ts';

const wrongKind: CovenantInput = {
  toolCalls: [
    { name: 'fixture-edit', args: {}, fileChange: { kind: 'wrong', path: 'file.ts', post: 'x' } },
  ],
  subagentSpawns: [],
  userMessages: [],
};
const missingPost: CovenantInput = {
  toolCalls: [{ name: 'fixture-edit', args: {}, fileChange: { kind: 'create', path: 'file.ts' } }],
  subagentSpawns: [],
  userMessages: [],
};
function unreachable(value: never): never {
  throw new Error(String(value));
}
function incomplete(value: CheckCovenantVerdict): string {
  switch (value.verdict) {
    case 'upheld':
      return value.advisories;
    case 'blocked':
      return value.reason;
    default:
      return unreachable(value);
  }
}
void [wrongKind, missingPost, incomplete];
