import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // `extract` is a DOM interpreter, so most of the suite needs a document.
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    environmentOptions: {
      jsdom: {
        // Fixed page URL so href resolution is deterministic.
        url: 'https://www.linkedin.com/search/results/people/',
      },
    },
    clearMocks: true,
    restoreMocks: true,
  },
});
