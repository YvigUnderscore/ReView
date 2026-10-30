// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, expect } from '@playwright/test';
import { EMAIL, PASSWORD, expectSignedIn, pinEnglish, signIn, submitLogin } from './support';

/** Sign-in, sign-out and the guard on authenticated routes. */

test.beforeEach(async ({ page }) => {
  await pinEnglish(page);
});

test('signs in, then signs out back to the sign-in page', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);
  // The session is really gone: an authenticated page sends back to sign-in.
  await page.goto('/projects');
  await expect(page).toHaveURL(/\/login/);
});

test('refuses a wrong password and lets the right one in', async ({ page }) => {
  // Make sure the instance is set up (first run on a blank database), then start signed out.
  await signIn(page);
  await page.getByRole('button', { name: 'Log out' }).click();
  await expect(page).toHaveURL(/\/login/);

  await submitLogin(page, EMAIL, `${PASSWORD}-wrong`);
  await expect(page.locator('form .text-destructive')).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: 'Log out', exact: true })).toHaveCount(0);

  await submitLogin(page, EMAIL, PASSWORD);
  await expectSignedIn(page);
  // A full page load restores the session from the refresh cookie (the access token lived in memory).
  await page.goto('/projects');
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
});
