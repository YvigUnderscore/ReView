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

export default defineConfig([
  // Code applicatif uniquement : on exclut le build, les assets statiques et les
  // fichiers de configuration outillage (CommonJS, hors périmètre du lint applicatif).
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
  // Scripts Node de l'outillage frontend (build-docs) : environnement node, pas browser.
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
      // tsc (noUnusedLocals/Parameters) couvre déjà les variables inutilisées ;
      // la variante TS d'ESLint complète pour les cas que tsc ne voit pas.
      '@typescript-eslint/no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      // Règles d'analyse React (react-hooks v7) : repassées en `error` après
      // résorption des warnings (10.E1 + 10.F1). Aucune nouvelle dérogation.
      'react-hooks/static-components': 'error',
      'react-hooks/set-state-in-effect': 'error',
      'react-hooks/immutability': 'error',
      'react-hooks/purity': 'error',
      'react-refresh/only-export-components': ['error', { allowConstantExport: true }],
      // Budget de taille (10.F4) : composant/page ≤ 300 lignes de code (hors blancs/
      // commentaires). Au-delà : découper en sous-composants / hooks.
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      // console.log ne doit pas atteindre la prod ; warn/error restent permis
      // (avertissements de repli légitimes, ex. HLS → MP4).
      'no-console': ['error', { allow: ['warn', 'error'] }],
      // a11y : deux règles inadaptées à un outil de review VFX, désactivées avec
      // justification — les dailies/playblasts n'ont jamais de sous-titres, et
      // l'autoFocus dans les dialogs est conforme aux ARIA Authoring Practices.
      'jsx-a11y/media-has-caption': 'off',
      'jsx-a11y/no-autofocus': 'off',
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
      ],
    },
  },
  // Règles type-aware : src uniquement (e2e/ n'est pas dans le tsconfig projet).
  // Une promesse perdue (invalidation, navigation) est une erreur avalée : on impose
  // un `void` explicite pour chaque fire-and-forget assumé.
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      // attributes:false : un handler async passé à onClick/onSubmit est un usage
      // React normal ; la règle reste active pour les autres positions.
      '@typescript-eslint/no-misused-promises': ['error', { checksVoidReturn: { attributes: false } }],
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    },
  },
  // Qualité des tests : un test focalisé/désactivé qui atteint dev fausse la suite.
  {
    files: ['src/**/*.test.{ts,tsx}'],
    plugins: { vitest },
    rules: {
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/no-commented-out-tests': 'error',
      // maxArgs 2 : expect(valeur, message) est un usage vitest supporté (boucles).
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
      'vitest/no-standalone-expect': 'error',
    },
  },
  // Les fichiers de test et E2E ne sont pas soumis au budget de taille.
  {
    files: ['**/*.test.{ts,tsx}', 'e2e/**/*.ts'],
    rules: { 'max-lines': 'off' },
  },
  // Désactive les règles ESLint stylistiques susceptibles d'entrer en conflit avec
  // Prettier (formatage géré exclusivement par Prettier — cf. 10.F2). Toujours en dernier.
  prettier,
])
