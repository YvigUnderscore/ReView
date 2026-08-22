// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from 'vitest/config';
import { loadItestDatabaseUrl } from './src/integration/itestEnv';

/**
 * Tests d'intégration : nécessitent Postgres/Redis/MinIO (voir job CI dédié).
 *
 * La suite ne tourne plus sur la base de développement. `globalSetup` crée puis remet à
 * neuf une base dédiée (`review_itest`, cf. `src/integration/itestEnv.ts`) en rejouant les
 * migrations versionnées, et `DATABASE_URL` est réécrite pour les processus de test —
 * `config/env.ts` charge `.env` par `dotenv`, qui n'écrase jamais une variable déjà posée.
 *
 * `fileParallelism: false` : trois fichiers de test écrivent dans la même base et le
 * premier d'entre eux exécute l'installation initiale du studio. En parallèle, l'ordre de
 * ces écritures serait un tirage au sort.
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
