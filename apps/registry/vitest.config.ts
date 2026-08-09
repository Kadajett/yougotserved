/**
 * Pins the test root to this package.
 *
 * Without it vitest searches upward for a config and finds one outside the
 * repository entirely, on whatever machine happens to have a stray
 * `vite.config.ts` in a parent directory, then fails on that file's plugins.
 * Naming the root here means the test run does not depend on what is sitting
 * above the checkout.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: __dirname,
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
