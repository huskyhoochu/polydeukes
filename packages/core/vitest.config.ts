import { defineConfig } from 'vitest/config';

// Unit tests for @polydeukes/core. Tests live in __tests__/ (outside src/) so the
// core's agent/tool/language-literal grep gate — which scans src/ only — never trips
// on a `vitest` import. See _docs/prd/CORE-01.md §5.3.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
});
