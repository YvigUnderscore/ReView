// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from 'vitest/config';

/**
 * Tests unitaires frontend (10.F3) : stores Zustand, lib (apiClient, uploadClient),
 * utilitaires purs, **et tests de rendu** (Testing Library) sous `src/test/`.
 * Environnement happy-dom (localStorage, DOM léger).
 */
export default defineConfig({
  test: {
    environment: 'happy-dom',
    // Les scripts d'outillage du frontend (build-docs) vivent hors de `src` : leurs
    // tests sont ramassés ici plutôt que de rester sans suite.
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.mjs'],
    // `vitest.setup.ts` corrige une incompatibilité WebAssembly ; `src/setupTests.ts`
    // installe le socle DOM des tests de rendu (jest-dom, démontage, API manquantes).
    setupFiles: ['./vitest.setup.ts', './src/setupTests.ts'],
  },
});
