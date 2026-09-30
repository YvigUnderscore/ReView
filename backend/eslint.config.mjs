// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vitest from '@vitest/eslint-plugin';
import prettier from 'eslint-config-prettier';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores(['dist', 'coverage']),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
      // tsconfig dédié au lint : contrairement à tsconfig.json (build), il inclut les
      // tests, prisma/ et scripts/ pour que les règles type-aware couvrent tout.
      parserOptions: { project: './tsconfig.eslint.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // pino est le seul canal de log du serveur.
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // Sûreté des promesses (type-aware) : une promesse perdue est une erreur avalée.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "Literal[value='fr-FR']",
          message:
            'Locale en dur interdite : la langue suit le lecteur (i18n) ; pour un log serveur, préférer toISOString().',
        },
      ],
    },
  },
  // Scripts CLI (seed, smoke) : console est leur canal de sortie légitime.
  {
    files: ['prisma/seed.ts', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['src/**/*.test.ts', 'src/**/*.itest.ts'],
    plugins: { vitest },
    rules: {
      // Un test focalisé ou désactivé qui atteint dev fausse la suite entière.
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/no-commented-out-tests': 'error',
      // maxArgs 2 : expect(valeur, message) est un usage vitest supporté (boucles).
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
      'vitest/no-standalone-expect': 'error',
    },
  },
  // Désactive les règles stylistiques en conflit avec Prettier. Toujours en dernier.
  prettier,
]);
