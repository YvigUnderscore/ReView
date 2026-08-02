// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from 'vitest/config';

// Tests d'intégration : nécessitent Postgres/MinIO/Redis (voir job CI dédié).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.itest.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
