// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { defineConfig } from '@playwright/test';

/**
 * `E2E_SERVER_LOG` (CI): file that receives the backend's output. Without it, the request log and the
 * server errors of a failed run were lost — Playwright drops a web server's stdout.
 */
const serverLog = process.env.E2E_SERVER_LOG;
if (serverLog) mkdirSync(dirname(serverLog), { recursive: true });

/**
 * Smoke E2E (10.F3): protects the complete critical path:
 * auth → project → shot → task → upload → review.
 *
 * Prerequisites: Postgres + Redis + MinIO services reachable (dev docker stack or CI).
 * The backend (:3000) and frontend (:5173) servers are started automatically
 * (reused if already running, which is the case on a dev machine).
 */
export default defineConfig({
  testDir: 'e2e',
  /**
   * `npm run test:e2e` runs the specs of `e2e/` (smoke, sign-in, projects, review comment).
   *
   * `docs-capture.spec.ts` shares this folder but is not a test: it is the generator
   * of the screenshots in `DOCUMENTATION/assets/`. Picked up by the same command, it rewrote
   * nineteen git-tracked PNGs and left a demo project in the database on
   * every validation: enough to make a suite "green" but dirty, and impossible to
   * plug into CI. The generator remains runnable, explicitly:
   *
   *   E2E_DOCS=1 npx playwright test e2e/docs-capture.spec.ts
   */
  testIgnore: process.env.E2E_DOCS === '1' ? [] : ['**/docs-capture.spec.ts'],
  /**
   * One worker, files in order. The specs share one database: on a blank instance the first one
   * goes through the studio setup, which two parallel workers would race for.
   */
  workers: 1,
  fullyParallel: false,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  // In CI, an HTML report as well: the workflow uploads it with the traces when the job fails.
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    // Default: the Chromium bundled with Playwright (downloaded in CI). Locally, a system browser
    // can be used without downloading: E2E_CHANNEL=msedge npm run test:e2e
    channel: process.env.E2E_CHANNEL,
  },
  webServer: [
    {
      command: serverLog ? `npm run dev > "${serverLog}" 2>&1` : 'npm run dev',
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
