import { defineConfig } from 'vitest/config';

// Unit tests for the umbrella `polydeukes` package (CONFIG-03 loader). Tests live in
// __tests__/ (outside src/) so build emit (tsconfig.build.json, rootDir src) never
// pulls in test files.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts'],
  },
});
