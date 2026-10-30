// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import vitest from '@vitest/eslint-plugin'
import prettier from 'eslint-config-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'
import legacyApiComponents from './eslint.legacy-api-components.json' with { type: 'json' }

/**
 * Import paths: three `../` or more is a path nobody can read or move safely; `@/` (= `src/`,
 * declared in tsconfig `paths`, vite.config.js and vitest.config.ts) says where the module lives.
 */
const DEEP_RELATIVE_IMPORT = {
  regex: '^(\\.\\./){3,}',
  message: 'Import trop profond : utiliser l’alias `@/` (= src/).',
}

export default defineConfig([
  // Application code only: the build, static assets and
  // tooling config files (CommonJS, outside the scope of the application lint) are excluded.
  globalIgnores(['dist', 'public', '*.config.js']),
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
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  // Node scripts of the frontend tooling (build-docs): node environment, not browser.
  {
    files: ['scripts/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // tsc (noUnusedLocals/Parameters) already covers unused variables;
      // the full ESLint TS variant covers the cases tsc does not see.
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      // React analysis rules (react-hooks v7): switched back to `error` after
      // the warnings were cleared (10.E1 + 10.F1). No new exemptions.
      'react-hooks/static-components': 'error',
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/purity': 'error',
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      // Size budget (10.F4): component/page ≤ 300 lines of code (excluding blank/
      // comments). Beyond that: split into sub-components / hooks.
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      // console.log must not reach production; warn/error remain allowed
      // (legitimate fallback warnings, e.g. HLS → MP4).
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // a11y: two rules unsuited to a VFX review tool, disabled with
      // justification: dailies/playblasts never have subtitles, and
      // autoFocus in dialogs complies with the ARIA Authoring Practices.
      'jsx-a11y/media-has-caption': 'off',
      'jsx-a11y/no-autofocus': 'off',
      'no-restricted-imports': ['error', { patterns: [DEEP_RELATIVE_IMPORT] }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value='fr-FR']",
          message: 'Locale en dur interdite : dates et nombres suivent le lecteur via intlLocale().',
        },
        {
          selector: "CallExpression[callee.name='useEffect'] CallExpression[callee.name='fetch']",
          message: 'Pas de fetch dans un useEffect : le data-fetching passe par TanStack Query (lib/queries).',
        },
        {
          selector:
            "JSXAttribute[name.name='dangerouslySetInnerHTML'] Property[key.name='__html']:not([value.callee.name='sanitizeHtml'])",
          message: 'HTML injecté non assaini : passer par sanitizeHtml() (@/v2/lib/sanitizeHtml).',
        },
      ],
    },
  },
  // Type-aware rules: src only (e2e/ is not in the project tsconfig).
  // A lost promise (invalidation, navigation) is a swallowed error, so we require
  // an explicit `void` for each intentional fire-and-forget.
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      // attributes:false: an async handler passed to onClick/onSubmit is a normal
      // React usage; the rule stays active for the other positions.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    },
  },
  // Components do not call the HTTP layer: `api.*` belongs in a query module (lib/queries.ts,
  // lib/*Api.ts, pages/**/*Api.ts) that the component consumes as hooks/functions. A warning, but
  // lint runs with --max-warnings 0, so it blocks new offenders; the components that still do it are
  // listed in eslint.legacy-api-components.json (ratchet: remove entries, never add).
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/**/*.test.tsx', ...legacyApiComponents.files],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'warn',
        {
          patterns: [
            {
              regex: 'lib/apiClient$',
              importNames: ['api'],
              message: 'Pas d’appel API dans un composant : passer par un module de requêtes (hooks).',
            },
          ],
        },
      ],
    },
  },
  // Test quality: a focused/disabled test that reaches dev skews the suite.
  {
    files: ['src/**/*.test.{ts,tsx}'],
    plugins: { vitest },
    rules: {
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/no-commented-out-tests': 'error',
      // maxArgs 2: expect(value, message) is a supported vitest usage (loops).
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
      'vitest/no-standalone-expect': 'error',
    },
  },
  // Test and E2E files are not subject to the size budget.
  {
    files: ['**/*.test.{ts,tsx}', 'e2e/**/*.ts'],
    rules: { 'max-lines': 'off' },
  },
  // Disables the stylistic ESLint rules that may conflict with
  // Prettier (formatting handled exclusively by Prettier, cf. 10.F2). Always last.
  prettier,
])
