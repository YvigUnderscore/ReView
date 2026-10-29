// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { expect, type Page } from '@playwright/test';

/**
 * Shared steps of the E2E specs (sign-in, API set-up/cleanup, seeding a reviewable media).
 *
 * The labels are English constants of the tests, not hard-coded interface strings: each spec pins
 * the language before the first render (`pinEnglish`), as the smoke test does.
 */

export const EMAIL = process.env.E2E_EMAIL ?? 'admin@review.local';
export const PASSWORD = process.env.E2E_PASSWORD ?? 'admin1234';

/** Run before the first `goto`: a language saved on the device wins over the account's. */
export async function pinEnglish(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('locale', 'en'));
}

/** Fills and submits the sign-in form (the page must already be on /login). */
export async function submitLogin(page: Page, email: string, password: string): Promise<void> {
  await page.fill('#email', email);
  await page.fill('#password', password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

/**
 * The authenticated shell is mounted: its "Log out" button only exists there. `main` is not a signal —
 * the sign-in and setup pages have one too, so waiting for it returned before the sign-in request had
 * answered, and the next `goto` aborted that request (no session cookie, back to sign-in).
 */
export async function expectSignedIn(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Log out', exact: true })).toBeVisible();
}

/**
 * Signs in as the E2E administrator. A fresh instance goes through the first-install setup instead
 * (studio, then admin account), so every spec runs on a blank database as well as a seeded one.
 */
export async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  // Wait for the form the app settles on: the URL is already "/" before the app redirects, so it
  // cannot tell setup from sign-in.
  const studioName = page.locator('#studioName');
  await expect(studioName.or(page.locator('#email'))).toBeVisible();
  if (await studioName.isVisible()) {
    await studioName.fill('E2E Studio');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.fill('#adminEmail', EMAIL);
    await page.fill('#adminPassword', PASSWORD);
    await page.getByRole('button', { name: 'Create studio' }).click();
  } else {
    await submitLogin(page, EMAIL, PASSWORD);
  }
  await dismissOnboarding(page);
  await expectSignedIn(page);
}

/**
 * A new account gets the first-run tour, a modal over the whole shell. Skip it the way a user would (it
 * records `onboardingSeen`, so it does not come back on the next load).
 */
async function dismissOnboarding(page: Page): Promise<void> {
  const tour = page.getByRole('dialog', { name: 'Welcome to ReView' });
  const skip = tour.getByRole('button', { name: 'Skip', exact: true });
  await expect(skip.or(page.getByRole('button', { name: 'Log out', exact: true }))).toBeVisible();
  // The tour opens once the preferences load, which can land just after the shell renders.
  const opened = await skip
    .waitFor({ state: 'visible', timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (!opened) return;
  await skip.click();
  await expect(tour).toBeHidden();
}

/**
 * Calls the API from the browser, with the session the page holds. The access token lives in the
 * page's memory only, so the helper obtains its own from the refresh cookie (same origin), then sends
 * it as the bearer header.
 */
export async function apiCall(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      // The access token lives in the page's memory only: ask for one through the refresh cookie.
      const token = (
        (await (
          await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'X-Requested-With': 'ReView' },
          })
        ).json()) as { token?: string }
      ).token;
      const res = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: (await res.json().catch(() => null)) as unknown };
    },
    { method, path, body },
  );
}

/** Creates a project from the Projects page and opens it. */
export async function createProject(page: Page, name: string): Promise<void> {
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Create', exact: true }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByPlaceholder('My project').fill(name);
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();
  await page
    .locator('main')
    .getByRole('link', { name: new RegExp(name) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/projects\/[^/]+$/);
}

/** Sends the test projects to the trash (API, outside the tested path). */
export async function trashProjects(page: Page, name: string): Promise<void> {
  const list = (await apiCall(page, 'GET', '/api/projects?pageSize=200')).json as {
    items?: { id: number; name: string }[];
  } | null;
  for (const project of list?.items?.filter((p) => p.name === name) ?? []) {
    await apiCall(page, 'DELETE', `/api/projects/${project.id}`);
  }
}

// Fake GLB: the "glTF" magic bytes are enough for finalize (server validation) → READY.
const GLB_FIXTURE = Buffer.concat([Buffer.from('glTF', 'ascii'), Buffer.alloc(120)]);

/**
 * Builds the shortest path to a reviewable media and opens its review: project → shot → task
 * (created by the version picker on a pipeline step) → version → GLB upload → review page.
 * Same path as the smoke test, which protects each step; here it is only set-up.
 */
export async function openSeededReview(page: Page, project: string, mediaName: string): Promise<void> {
  await createProject(page, project);
  const created = await apiCall(page, 'POST', '/api/departments', { name: 'Compositing' });
  expect([201, 409]).toContain(created.status);

  const prefix = `R${Date.now() % 100000}`;
  await page.getByRole('tab', { name: 'Shots', exact: true }).click();
  // The "+" of the Shots tab opens the batch generator in a dialog.
  await page.getByRole('button', { name: 'New shot', exact: true }).click();
  await page.getByLabel('Prefix').fill(prefix);
  await page.getByLabel('Start').fill('10');
  await page.getByLabel('Count').fill('1');
  await page
    .getByRole('button', { name: /^Create 1 item/ })
    .first()
    .click();
  await page
    .locator('main')
    .getByRole('link', { name: new RegExp(prefix) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/shots\/\d+/);

  await page.getByRole('button', { name: '+ New version' }).first().click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /Create a .*COMPOSITING.* task/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/tasks\/\d+/);

  await page
    .locator('.border-dashed input[type="file"]')
    .first()
    .setInputFiles({ name: mediaName, mimeType: 'model/gltf-binary', buffer: GLB_FIXTURE });
  const mediaLink = page.getByRole('link', { name: new RegExp(mediaName) });
  await expect(mediaLink.first()).toBeVisible({ timeout: 30_000 });
  await mediaLink.first().click();
  await expect(page).toHaveURL(/\/review\/[^/]+$/);
  await expect(page.locator('header').first()).toContainText(mediaName);
}
