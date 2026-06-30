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
