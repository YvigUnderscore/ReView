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
