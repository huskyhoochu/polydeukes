import { describe, expect, it } from 'vitest';
import { renderHookResponse } from '../src/render-hook-response.ts';

const REASON = 'judge unavailable';
describe('renderHookResponse host protocol', () => {
  it.each([0, 2] as const)('renders status %s as one valid matching host decision', (exitCode) => {
    // Grok consumes the JSON decision; a contradictory exit status or extra text loses denial.
    const result = renderHookResponse({ exitCode, reason: REASON });
    expect(result.exitCode).toBe(exitCode);
    const decision = JSON.parse(result.stdout);
    expect(decision.decision).toBe(exitCode === 2 ? 'deny' : 'allow');
    if (exitCode === 2) expect(decision.reason).toBe(REASON);
    expect(result.stderr).toBe('');
  });
});
