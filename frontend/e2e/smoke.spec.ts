// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, expect } from '@playwright/test';
import { apiCall } from './support';

/**
 * Smoke E2E of the critical path:
 * setup/login → project → shot → task → version → upload → review.
 * Tolerates a fresh instance (performs the setup) as well as a seeded one (login).
 *
 * **The language is pinned** before the first render (`localStorage.locale = 'en'`). This is what
 * keeps labels predictable: a choice saved on the device overrides the account
 * preference (`syncAccountLocale` does not overwrite it), whereas targeting "both
 * languages" made the test depend on the test account, and left it pointing at
 * French labels on an interface switched to English. The English texts written here
 * are therefore constants of the test, not hard-coded interface strings.
 *
 * The path follows the application as it is: a version hangs off a **task**, and
 * the task selector can create the missing step. That is the path we protect.
 */

const stamp = Date.now();
const PROJECT = `E2E Smoke ${stamp}`;
const SHOT_PREFIX = `E${stamp % 100000}`;
/** Pipeline step used for the task: its key is the normalized name in uppercase. */
const STEP_NAME = 'Compositing';
const STEP_KEY = 'COMPOSITING';
const MEDIA_NAME = 'smoke.glb';
const EMAIL = process.env.E2E_EMAIL ?? 'admin@review.local';
const PASSWORD = process.env.E2E_PASSWORD ?? 'admin1234';

// Fake GLB: the "glTF" magic bytes are enough for finalize (server validation) → READY.
const GLB_FIXTURE = Buffer.concat([Buffer.from('glTF', 'ascii'), Buffer.alloc(120)]);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('locale', 'en'));
});

test('critical path: auth → project → shot → task → version → upload → review', async ({ page }) => {
  // ── 1) Authentication (first-install setup, otherwise login) ───────
  await page.goto('/');
  await page.waitForURL(/\/(login|setup)?(\?.*)?$/);
  if (page.url().includes('/setup')) {
    // The setup comes in two steps: the studio, then the admin account. Filling them
    // in one go failed, because the fields of the second screen do not exist yet.
    await page.fill('#studioName', 'E2E Studio');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.fill('#adminEmail', EMAIL);
    await page.fill('#adminPassword', PASSWORD);
    await page.getByRole('button', { name: 'Create studio' }).click();
  } else {
    await page.fill('#email', EMAIL);
    await page.fill('#password', PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  // The authenticated shell is mounted: that is the most stable signal that we got in.
  await expect(page.locator('main')).toBeVisible();

  // ── 2) Create a project and open it ──────────────────────────────────────
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create', exact: true }).first().click();
  const newProject = page.getByRole('dialog');
  await newProject.getByPlaceholder('My project').fill(PROJECT);
  await newProject.getByRole('button', { name: 'Create', exact: true }).click();
  await page
    .locator('main')
    .getByRole('link', { name: new RegExp(PROJECT) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);

  // A pipeline step must exist for a task to be created. A new studio declares none,
  // so we add one via the API (setup, outside the tested path). 409 = already there.
  const created = await apiCall(page, 'POST', '/api/departments', { name: STEP_NAME });
  expect([201, 409]).toContain(created.status);

  // ── 3) Create a shot from the Shots tab (batch generator) ───────────────
  await page
    .getByRole('button', { name: /^Shots/ })
    .first()
    .click();
  await page.getByLabel('Prefix').fill(SHOT_PREFIX);
  await page.getByLabel('Start').fill('10');
  await page.getByLabel('Count').fill('1');
  await page
    .getByRole('button', { name: /^Create 1 item/ })
    .first()
    .click();
  // The exact code depends on the padding set on the project (`E12345010` or `E123450010`):
  // we target the prefix, which is ours.
  await page
    .locator('main')
    .getByRole('link', { name: new RegExp(SHOT_PREFIX) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/shots\/\d+/);

  // ── 4) New version: the selector creates the missing task on the step ──
  await page.getByRole('button', { name: '+ New version' }).first().click();
  const taskPicker = page.getByRole('dialog');
  await expect(taskPicker.getByText('Which task is this version for?')).toBeVisible();
  await taskPicker
    .getByRole('button', { name: new RegExp(`Create a .*${STEP_KEY}.* task`) })
    .first()
    .click();
  // The version created lives under its task: that is where the media is dropped.
  await expect(page).toHaveURL(/\/tasks\/\d+/);

  // ── 5) Drop a GLB (creates the next version and fills it) ───────────────
  await page
    .locator('.border-dashed input[type="file"]')
    .first()
    .setInputFiles({ name: MEDIA_NAME, mimeType: 'model/gltf-binary', buffer: GLB_FIXTURE });
  const mediaLink = page.getByRole('link', { name: new RegExp(MEDIA_NAME) });
  await expect(mediaLink.first()).toBeVisible({ timeout: 30_000 });

  // ── 6) Open the media review ─────────────────────────────────────────────
  await mediaLink.first().click();
  await expect(page).toHaveURL(/\/review\/[^/]+$/);
  // The breadcrumb in the top bar carries the media (full context loaded).
  await expect(page.locator('header').first()).toContainText(MEDIA_NAME);
  // Review chrome: tool rail on the left (navigation tool) and inspector dock on the
  // right (Camera tab of the 3D viewer). It is the unified shell, not a floating bar.
  await expect(page.getByRole('button', { name: 'Navigate', exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Camera', exact: true }).first()).toBeVisible();

  // ── Cleanup: the test project goes to the trash (API, outside the path) ──
  const list = (await apiCall(page, 'GET', '/api/projects?pageSize=200')).json as {
    items?: { id: number; name: string }[];
  } | null;
  for (const project of list?.items?.filter((p) => p.name === PROJECT) ?? []) {
    await apiCall(page, 'DELETE', `/api/projects/${project.id}`);
  }
});
