// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from 'vitest/config';

/**
 * Tests unitaires frontend (10.F3) : stores Zustand, lib (apiClient, uploadClient),
 * utilitaires purs. Environnement happy-dom (localStorage, DOM léger).
 */
export default defineConfig({
  test: {
    environment: 'happy-dom',
    // Les scripts d'outillage du frontend (build-docs) vivent hors de `src` : leurs
    // tests sont ramassés ici plutôt que de rester sans suite.
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
