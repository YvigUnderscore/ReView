// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, expect, type Page } from '@playwright/test';

/**
 * Smoke E2E du parcours critique :
 * setup/login → projet → shot → tâche → version → upload → review.
 * Tolère une instance vierge (fait le setup) comme une instance seedée (login).
 *
 * **La langue est épinglée** avant le premier rendu (`localStorage.locale = 'en'`). C'est ce
 * qui rend les libellés prévisibles : un choix enregistré sur l'appareil l'emporte sur la
 * préférence du compte (`syncAccountLocale` ne l'écrase pas), là où viser « les deux
 * langues » faisait dépendre le test du compte de test — et le laissait pointer des
 * libellés français sur une interface passée à l'anglais. Les textes anglais écrits ici
 * sont donc des constantes du test, pas des textes en dur d'interface.
 *
 * Le parcours suit l'application telle qu'elle est : une version pend d'une **tâche**, et
 * le sélecteur de tâche sait créer l'étape manquante. C'est ce chemin-là qu'on protège.
 */

const stamp = Date.now();
const PROJECT = `E2E Smoke ${stamp}`;
const SHOT_PREFIX = `E${stamp % 100000}`;
/** Étape du pipe utilisée pour la tâche : sa clé est le nom normalisé en majuscules. */
const STEP_NAME = 'Compositing';
const STEP_KEY = 'COMPOSITING';
const MEDIA_NAME = 'smoke.glb';
const EMAIL = process.env.E2E_EMAIL ?? 'admin@review.local';
const PASSWORD = process.env.E2E_PASSWORD ?? 'admin1234';

// Faux GLB : les octets magiques « glTF » suffisent au finalize (validation serveur) → READY.
const GLB_FIXTURE = Buffer.concat([Buffer.from('glTF', 'ascii'), Buffer.alloc(120)]);

/** Appelle l'API avec le jeton de la session du navigateur (préparation et nettoyage). */
async function apiCall(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: unknown }> {
  return page.evaluate(
    async ({ method, path, body }) => {
      const res = await fetch(path, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: (await res.json().catch(() => null)) as unknown };
    },
    { method, path, body },
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('locale', 'en'));
});

test('parcours critique : auth → projet → shot → tâche → version → upload → review', async ({ page }) => {
  // ── 1) Authentification (setup de première installation, sinon login) ───────
  await page.goto('/');
  await page.waitForURL(/\/(login|setup)?(\?.*)?$/);
  if (page.url().includes('/setup')) {
    // Le setup est en deux temps : le studio, puis le compte administrateur. Les remplir
    // d'une traite échouait — les champs du second écran n'existent pas encore.
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
  // La coquille authentifiée est montée : c'est le signal le plus stable qu'on est entré.
  await expect(page.locator('main')).toBeVisible();

  // ── 2) Créer un projet et l'ouvrir ──────────────────────────────────────────
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

  // Une étape de pipe doit exister pour qu'une tâche puisse être créée. Un studio neuf n'en
  // déclare aucune : on la pose par l'API (préparation, hors parcours testé). 409 = déjà là.
  const created = await apiCall(page, 'POST', '/api/departments', { name: STEP_NAME });
  expect([201, 409]).toContain(created.status);

  // ── 3) Créer un shot depuis l'onglet Shots (générateur en lot) ──────────────
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
  // Le code exact dépend du remplissage réglé sur le projet (`E12345010` ou `E123450010`) :
  // on vise le préfixe, qui, lui, est à nous.
  await page
    .locator('main')
    .getByRole('link', { name: new RegExp(SHOT_PREFIX) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/shots\/\d+/);

  // ── 4) Nouvelle version : le sélecteur crée la tâche manquante sur l'étape ──
  await page.getByRole('button', { name: '+ New version' }).first().click();
  const taskPicker = page.getByRole('dialog');
  await expect(taskPicker.getByText('Which task is this version for?')).toBeVisible();
  await taskPicker
    .getByRole('button', { name: new RegExp(`Create a .*${STEP_KEY}.* task`) })
    .first()
    .click();
  // La version créée vit sous sa tâche : c'est là qu'on dépose le média.
  await expect(page).toHaveURL(/\/tasks\/\d+/);

  // ── 5) Déposer un GLB (crée la version suivante et la remplit) ──────────────
  await page
    .locator('.border-dashed input[type="file"]')
    .first()
    .setInputFiles({ name: MEDIA_NAME, mimeType: 'model/gltf-binary', buffer: GLB_FIXTURE });
  const mediaLink = page.getByRole('link', { name: new RegExp(MEDIA_NAME) });
  await expect(mediaLink.first()).toBeVisible({ timeout: 30_000 });

  // ── 6) Ouvrir la review du média ────────────────────────────────────────────
  await mediaLink.first().click();
  await expect(page).toHaveURL(/\/review\/[^/]+$/);
  // Le fil d'Ariane de la barre du haut porte le média (contexte complet chargé).
  await expect(page.locator('header').first()).toContainText(MEDIA_NAME);
  // Chrome de review : rail d'outils à gauche (outil de navigation) et dock inspecteur à
  // droite (onglet Caméra du viewer 3D) — c'est la coquille unifiée, pas une barre flottante.
  await expect(page.getByRole('button', { name: 'Navigate', exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Camera', exact: true }).first()).toBeVisible();

  // ── Nettoyage : le projet de test part à la corbeille (API, hors parcours) ──
  const list = (await apiCall(page, 'GET', '/api/projects?pageSize=200')).json as {
    items?: { id: number; name: string }[];
  } | null;
  for (const project of list?.items?.filter((p) => p.name === PROJECT) ?? []) {
    await apiCall(page, 'DELETE', `/api/projects/${project.id}`);
  }
});
