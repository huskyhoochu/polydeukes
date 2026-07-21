import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Unit tests for the umbrella `polydeukes` package (CONFIG-03 loader). Tests live in
// __tests__/ (outside src/) so build emit (tsconfig.build.json, rootDir src) never
// pulls in test files.
export default defineConfig({
  resolve: {
    // Tests must run on a clean clone without a prior core build: @polydeukes/core's
    // exports map points only at dist/ (gitignored), so resolve it to source here.
    alias: {
      '@polydeukes/core': resolve(import.meta.dirname, '../core/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
});
