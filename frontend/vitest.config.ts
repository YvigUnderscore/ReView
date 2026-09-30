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
    /**
     * Mesure de couverture — inerte tant que `--coverage` n'est pas passé. Les seuils par
     * dossier et le cliquet vivent dans `scripts/check-coverage.mjs` (voir le commentaire
     * jumeau côté backend).
     */
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/setupTests.ts',
        'src/test/**',
        'src/**/*.d.ts',
        // Point d'entrée et déclarations : ni l'un ni les autres ne portent de logique.
        'src/main.tsx',
        'src/vite-env.d.ts',
      ],
    },
  },
});
