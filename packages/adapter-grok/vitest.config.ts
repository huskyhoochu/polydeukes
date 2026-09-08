import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Tests must run on a clean clone without a prior core build: @polydeukes/core's
    // exports map points only at dist/ (gitignored), so resolve it to source here.
    alias: {
      '@polydeukes/core': resolve(import.meta.dirname, '../core/src/index.ts'),
    },
  },
});
