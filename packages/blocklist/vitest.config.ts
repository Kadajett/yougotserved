import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pinned here so vitest stops walking up. Without a config in the package
    // it finds one outside the repo entirely and fails to start.
    root: __dirname,
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
});
