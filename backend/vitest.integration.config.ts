// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from 'vitest/config';

// Tests d'intégration : nécessitent Postgres/MinIO/Redis (voir job CI dédié).
// `DATABASE_URL` n'est pas surchargée ici : la suite s'exécute sur la base configurée par
// `backend/.env` — en local, la base de développement, qu'aucune étape ne réinitialise
// entre deux exécutions. Chaque test doit donc rester rejouable sur une base déjà peuplée
// par ses propres passages précédents : identifiants et empreintes de contenu uniques par
// run, et nettoyage de ce qui pèse (objets de stockage).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.itest.ts'],
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
