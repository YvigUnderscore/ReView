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
        {
          // A swallowed rejection loses the only trace of a storage or database incident.
          selector:
            "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[params.length=0][body.type='Identifier'][body.name='undefined']",
          message: 'Use .catch(ignoreFailure(message, context)) from lib/ignoreFailure: log what is ignored.',
        },
        {
          selector:
            "CallExpression[callee.property.name='catch'] > ArrowFunctionExpression[params.length=0][body.type='BlockStatement'][body.body.length=0]",
          message: 'Use .catch(ignoreFailure(message, context)) from lib/ignoreFailure: log what is ignored.',
        },
      ],
    },
  },
  // Layering: `lib/` is the bottom layer (infrastructure clients, pure helpers). It must not reach up into
  // services, routes, middleware or workers — those depend on it, never the reverse. Tests may wire layers.
  {
    files: ['src/lib/**/*.ts'],
    ignores: ['src/lib/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/services',
                '**/services/**',
                '**/routes',
                '**/routes/**',
                '**/workers/**',
                '**/middleware/**',
              ],
              message:
                'lib/ is the bottom layer: move the shared piece into lib/ or inject it from the caller.',
            },
          ],
        },
      ],
    },
  },
  // Routes validate, call a service and respond: data access lives in services/. A ratchet rather than a
  // warning (the lint runs with --max-warnings 0): new route files may not import Prisma, and the files
  // below — 28 files, 79 direct calls when the rule was introduced — leave the list as they are migrated.
  // Never add to it.
  {
    files: ['src/routes/**/*.ts'],
    ignores: [
      'src/routes/**/*.test.ts',
      'src/routes/admin.routes.ts',
      'src/routes/auth-2fa.routes.ts',
      'src/routes/auth-oidc.routes.ts',
      'src/routes/auth.routes.ts',
      'src/routes/client.routes.ts',
      'src/routes/departments.routes.ts',
      'src/routes/entity-extras.routes.ts',
      'src/routes/sequences.routes.ts',
      'src/routes/setup.routes.ts',
      'src/routes/shotgrid-entity.routes.ts',
      'src/routes/shotgrid-sync.routes.ts',
      'src/routes/shotgrid-webhook.routes.ts',
      'src/routes/studio-appearance.routes.ts',
      'src/routes/studio.routes.ts',
      'src/routes/timelines.routes.ts',
      'src/routes/unsubscribe.routes.ts',
      'src/routes/v1/comments.routes.ts',
      'src/routes/v1/entities.routes.ts',
      'src/routes/v1/episodes.routes.ts',
      'src/routes/v1/events.routes.ts',
      'src/routes/v1/latestPick.ts',
      'src/routes/v1/mediaAccess.ts',
      'src/routes/v1/meta.routes.ts',
      'src/routes/v1/project-content.routes.ts',
      'src/routes/v1/projects.routes.ts',
      'src/routes/v1/tasks.routes.ts',
      'src/routes/v1/versions.routes.ts',
      'src/routes/visibility.routes.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/lib/prisma'],
              message: 'Routes do not query the database: move the data access into a service.',
            },
          ],
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
