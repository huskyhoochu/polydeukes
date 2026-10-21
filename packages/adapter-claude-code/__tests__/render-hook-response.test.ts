import { describe, expect, it } from 'vitest';
import { renderHookResponse } from '../src/render-hook-response.ts';

const REASON = 'judge unavailable';
describe('renderHookResponse host protocol', () => {
  it.each([0, 2] as const)(
    'renders status %s without leaking child stdout into the host protocol',
    (exitCode) => {
      // These hosts consume exit status and stderr; stdout is not a second decision channel.
      const result = renderHookResponse({ exitCode, reason: REASON });
      expect(result.exitCode).toBe(exitCode);
      expect(result.stdout).toBe('');
      expect(result.stderr.trim()).toBe(REASON);
    },
  );
});
