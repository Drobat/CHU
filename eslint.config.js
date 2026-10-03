import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // .wrangler holds the bundle wrangler builds to run the Worker locally. It is
  // generated, it is gitignored, and linting it turns `npm run check` red for
  // anyone who has run the API once.
  globalIgnores(['dist', '.wrangler']),
  {
    // Server-side code: migration runner, import script, database access, and
    // the Worker. It runs outside the browser, so it needs the Node globals.
    files: ['src/db/**/*.js', 'tests/**/*.js', 'worker/**/*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: { react },
    rules: {
      // Without this rule, an identifier only referenced from JSX looks unused
      // to no-unused-vars, which then asks for an import the app needs at runtime.
      'react/jsx-uses-vars': 'error',
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
])
