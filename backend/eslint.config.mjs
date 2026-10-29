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
      // Type-aware lint tsconfig: unlike tsconfig.json (build), it includes tests, prisma/ and
      // scripts/ so the type-aware rules cover everything.
      parserOptions: { project: './tsconfig.eslint.json', tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // pino is the only logging channel of the server.
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^_', argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // Promise safety (type-aware): a lost promise is a silently swallowed error.
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
        {
          // `authenticate` narrows nothing at the type level: `req.user!` silently turns a route mounted
          // without it into a 500 on `undefined.id`. `requireUser(req)` (middleware/auth) is a 401.
          selector: "TSNonNullExpression > MemberExpression[object.name='req'][property.name='user']",
          message: 'Use requireUser(req) from middleware/auth instead of asserting req.user!.',
        },
      ],
    },
  },
  // CLI scripts (seed, smoke): console is their legitimate output channel.
  {
    files: ['prisma/seed.ts', 'scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['src/**/*.test.ts', 'src/**/*.itest.ts'],
    plugins: { vitest },
    rules: {
      // A focused or skipped test reaching dev would falsify the whole suite.
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/no-commented-out-tests': 'error',
      // maxArgs 2: expect(value, message) is a supported vitest usage (loops).
      'vitest/valid-expect': ['error', { maxArgs: 2 }],
      'vitest/no-standalone-expect': 'error',
    },
  },
  // Disables stylistic rules that conflict with Prettier. Always keep last.
  prettier,
]);
