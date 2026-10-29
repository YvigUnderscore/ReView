// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from 'vitest/config';
import { loadItestDatabaseUrl } from './src/integration/itestEnv';

/**
 * Integration tests: require Postgres/Redis/MinIO (see the dedicated CI job).
 *
 * The suite no longer runs on the development database. `globalSetup` creates, then resets to
 * a clean state a dedicated database (`review_itest`, cf. `src/integration/itestEnv.ts`) by replaying the
 * versioned migrations, and `DATABASE_URL` is rewritten for the test processes:
 * `config/env.ts` loads `.env` via `dotenv`, which never overwrites a variable already set.
 *
 * `fileParallelism: false`: three test files write to the same database and the
 * first of them runs the studio's initial setup. In parallel, the order of
 * those writes would be a lottery.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.itest.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
    globalSetup: ['./src/integration/globalSetup.ts'],
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: loadItestDatabaseUrl(),
    },
  },
});
