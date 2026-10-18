import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'agent-dist', 'output', 'licenses', 'test-results', 'playwright-report', 'tmp'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // `const { removed: _removed, ...rest } = value` drops a key; a leading underscore marks it as unused on purpose.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  // Tests read loosely typed JSON responses.
  { files: ['**/*.test.{ts,tsx}'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    // The two classic hook rules. The plugin's React Compiler rules (refs, set-state-in-effect, purity) are left
    // out: the editor does not use the compiler, and their findings here are deliberate patterns, not bugs.
    rules: { 'react-hooks/rules-of-hooks': 'error', 'react-hooks/exhaustive-deps': 'warn' },
  },
);
