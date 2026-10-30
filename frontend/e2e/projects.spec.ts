// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, expect } from '@playwright/test';
import { createProject, pinEnglish, signIn, trashProjects } from './support';

/** The project list: a new project appears in it and opens on its page. */

const PROJECT = `E2E Projects ${Date.now()}`;

test.beforeEach(async ({ page }) => {
  await pinEnglish(page);
});

test('a created project is listed and opens on its own page', async ({ page }) => {
  await signIn(page);
  await createProject(page, PROJECT);
  const projectUrl = page.url();

  // Back to the list: the project is there, and its link leads to the same page.
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
  const link = page
    .locator('main')
    .getByRole('link', { name: new RegExp(PROJECT) })
    .first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(projectUrl);
  await expect(page.locator('main')).toContainText(PROJECT);

  await trashProjects(page, PROJECT);
});
