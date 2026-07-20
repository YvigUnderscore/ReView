import { defineConfig } from 'vitest/config';

/**
 * Tests unitaires frontend (10.F3) : stores Zustand, lib (apiClient, uploadClient),
 * utilitaires purs. Environnement happy-dom (localStorage, DOM léger).
 */
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
