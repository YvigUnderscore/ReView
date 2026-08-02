// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Les scripts d'outillage du dépôt (en-têtes SPDX, notices tierces) vivent à la racine
    // et n'ont pas de suite à eux : ils sont couverts ici, avec les tests backend.
    include: ['src/**/*.test.ts', '../scripts/**/*.test.mjs'],
  },
});
