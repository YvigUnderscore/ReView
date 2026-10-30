// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, expect, type Page } from '@playwright/test';
import { openSeededReview, pinEnglish, signIn, trashProjects } from './support';

/** Review: a comment posted on a media shows up in the thread and survives a reload. */

const stamp = Date.now();
const PROJECT = `E2E Review ${stamp}`;
const MEDIA = 'comment.glb';
const COMMENT = `E2E comment ${stamp}`;

test.beforeEach(async ({ page }) => {
  await pinEnglish(page);
});

/** The composer of the comments panel; opens the panel first if the layout keeps it folded. */
async function composer(page: Page) {
  const box = page.getByRole('textbox', { name: /^Add a comment/ });
  if (!(await box.isVisible())) {
    await page.getByRole('button', { name: 'Comments' }).first().click();
  }
  await expect(box).toBeVisible();
  return box;
}

test('posts a comment on a media and finds it again after a reload', async ({ page }) => {
  await signIn(page);
  await openSeededReview(page, PROJECT, MEDIA);

  const box = await composer(page);
  await box.fill(COMMENT);
  // The Send of this composer: reply composers carry their own.
  await page.locator('form').filter({ has: box }).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(COMMENT).first()).toBeVisible();
  await expect(box).toHaveValue('');

  await page.reload();
  await expect(page.getByText(COMMENT).first()).toBeVisible({ timeout: 30_000 });

  await trashProjects(page, PROJECT);
});
