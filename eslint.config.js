import globals from 'globals';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';

export default tseslint.config(
  // Global ignores first - these apply to all configurations
  {
    ignores: [
      'node_modules/',
      'dist/',
      '.output/',
      '.wxt/',
      'logs/',
      '*.log',
      '.cache/',
      '.temp/',
      '.idea/',
      '.DS_Store',
      'Thumbs.db',
      '*.zip',
      '*.tar.gz',
      'stats.html',
      'stats-*.json',
      'pnpm-lock.yaml',
      '**/workers/**',
      'app/**/workers/**',
      'packages/**/workers/**',
      'test-inject-script.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Global rule adjustments
  {
    // Allow intentionally empty catch blocks (common in extension code),
    // while keeping other empty blocks reported.
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    files: ['app/**/*.{js,jsx,ts,tsx}', 'packages/**/*.{js,jsx,ts,tsx}', 'scripts/**/*.{js,mjs}'],
    ignores: ['**/workers/**'], // Additional ignores for this specific config
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      parser: tseslint.parser,
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },

    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  // Vue support has to live here too, not only in the extension's own config.
  // lint-staged runs eslint from the repo root, and a flat config does not pick
  // up a nested one, so without this a staged .vue file fails to parse.
  ...pluginVue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    // TypeScript already reports an identifier that does not exist, and it
    // knows the DOM lib types that `no-undef` does not. Leaving the rule on
    // reports every type name, such as ScrollBehavior, as undefined.
    files: ['**/*.{ts,tsx,vue}'],
    rules: {
      'no-undef': 'off',
      // The same three the extension's own config turns off. Both configs see
      // .vue files now, so they have to agree, or a commit and CI disagree.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'no-empty': 'off',
    },
  },
  eslintConfigPrettier,
);
