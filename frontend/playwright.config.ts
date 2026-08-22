// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from '@playwright/test';

/**
 * Smoke E2E (10.F3) — protège le parcours critique complet :
 * auth → projet → shot → tâche → upload → review.
 *
 * Prérequis : services Postgres + Redis + MinIO joignables (stack docker dev ou CI).
 * Les serveurs backend (:3000) et frontend (:5173) sont lancés automatiquement
 * (réutilisés s'ils tournent déjà — cas du poste de dev).
 */
export default defineConfig({
  testDir: 'e2e',
  /**
   * `npm run test:e2e` n'exécute que le smoke.
   *
   * `docs-capture.spec.ts` partage ce dossier mais n'est pas un test : c'est le générateur
   * des captures de `DOCUMENTATION/assets/`. Ramassé par la même commande, il réécrivait
   * dix-neuf PNG suivis par git et laissait un projet de démonstration dans la base à
   * chaque validation — de quoi rendre une suite « verte » salissante, et impossible à
   * brancher en CI. Le générateur reste lançable, explicitement :
   *
   *   E2E_DOCS=1 npx playwright test e2e/docs-capture.spec.ts
   */
  testIgnore: process.env.E2E_DOCS === '1' ? [] : ['**/docs-capture.spec.ts'],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    // Par défaut : Chromium bundlé Playwright (téléchargé en CI). En local, un navigateur
    // système peut être utilisé sans téléchargement : E2E_CHANNEL=msedge npm run test:e2e
    channel: process.env.E2E_CHANNEL,
  },
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../backend',
      url: 'http://localhost:3000/health',
      reuseExistingServer: true,
      timeout: 90_000,
    },
    {
      command: 'npm run dev -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: true,
      timeout: 90_000,
    },
  ],
});
