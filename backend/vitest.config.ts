// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Les scripts d'outillage du dépôt (en-têtes SPDX, notices tierces) vivent à la racine
    // et n'ont pas de suite à eux : ils sont couverts ici, avec les tests backend.
    include: ['src/**/*.test.ts', '../scripts/**/*.test.mjs'],
    /**
     * Mesure de couverture — inerte tant que `--coverage` n'est pas passé.
     *
     * Le rapport `json-summary` est le seul qui compte ici : c'est celui que lit
     * `scripts/check-coverage.mjs`, qui porte les seuils **par dossier** et le cliquet
     * (un plancher ne redescend jamais). Les seuils ne sont volontairement pas déclarés
     * dans `coverage.thresholds` : ils vivraient alors à deux endroits, et vitest ne sait
     * pas refuser une baisse de plancher.
     *
     * `include` sans exclusion des fichiers non importés : un service que personne ne teste
     * doit compter pour zéro, pas disparaître de la mesure — c'est tout l'objet du contrôle.
     */
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.itest.ts',
        // Décor et plomberie de la suite d'intégration : de l'outillage de test.
        'src/integration/**',
        'src/types/**',
        'src/**/*.d.ts',
      ],
    },
  },
});
