import { test, expect } from '@playwright/test';

/**
 * Smoke E2E du parcours critique (10.F3) :
 * setup/login → créer projet → créer shot → créer tâche → upload GLB → review.
 * Tolère une instance vierge (fait le setup) comme une instance seedée (login).
 */

const stamp = Date.now();
const PROJECT = `E2E Smoke ${stamp}`;
const SHOT_CODE = `E2E${stamp % 100000}`;
const TASK_NAME = 'Tâche smoke';
const MEDIA_NAME = 'smoke.glb';
const EMAIL = process.env.E2E_EMAIL ?? 'admin@review.local';
const PASSWORD = process.env.E2E_PASSWORD ?? 'admin1234';

// Faux GLB : magic bytes « glTF » suffisent au finalize (validation serveur) → READY.
const GLB_FIXTURE = Buffer.concat([Buffer.from('glTF', 'ascii'), Buffer.alloc(120)]);

test('parcours critique : auth → projet → shot → tâche → upload → review', async ({ page }) => {
  // ── 1) Authentification (setup première installation, sinon login) ──────────
  await page.goto('/');
  await page.waitForURL(/\/(login|setup)?(\?.*)?$/);
  if (page.url().includes('/setup')) {
    await page.fill('#studioName', 'E2E Studio');
    await page.fill('#adminEmail', EMAIL);
    await page.fill('#adminPassword', PASSWORD);
    await page.getByRole('button', { name: /Créer le studio/ }).click();
  } else {
    await page.fill('#email', EMAIL);
    await page.fill('#password', PASSWORD);
    await page.getByRole('button', { name: 'Se connecter' }).click();
  }
  await expect(page.getByRole('heading', { name: 'Projets', exact: true }).first()).toBeVisible();

  // ── 2) Créer un projet et l'ouvrir ───────────────────────────────────────────
  await page.getByPlaceholder('Nouveau projet…').fill(PROJECT);
  await page.getByRole('button', { name: 'Créer', exact: true }).click();
  await page
    .locator('main')
    .getByRole('link', { name: new RegExp(PROJECT) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/projects\/\d+/);

  // ── 3) Créer un shot (onglet Shots, formulaire simple) ──────────────────────
  await page.getByRole('button', { name: 'Shots', exact: true }).click();
  await page.getByPlaceholder('Code', { exact: true }).fill(SHOT_CODE);
  await page.getByRole('button', { name: 'Shot', exact: true }).click();
  // La carte du shot apparaît → l'ouvrir (drawer latéral)
  await page.locator('main').getByText(new RegExp(SHOT_CODE)).first().click();
  await expect(page).toHaveURL(new RegExp('shot=\\d+'));

  // ── 4) Créer une tâche dans le drawer et l'ouvrir ────────────────────────────
  await page.getByPlaceholder('Nouvelle tâche…').fill(TASK_NAME);
  await page.getByRole('button', { name: '+ Tâche' }).click();
  await page.getByRole('link', { name: new RegExp(TASK_NAME) }).click();
  await expect(page).toHaveURL(/\/tasks\/\d+/);

  // ── 5) Upload d'un GLB via la drop-zone (crée la version V01 automatiquement) ─
  await page
    .locator('.border-dashed input[type="file"]')
    .setInputFiles({ name: MEDIA_NAME, mimeType: 'model/gltf-binary', buffer: GLB_FIXTURE });
  // L'upload (présigné MinIO + finalize) aboutit → le média apparaît dans la timeline
  const mediaLink = page.getByRole('link', { name: new RegExp(MEDIA_NAME) });
  await expect(mediaLink.first()).toBeVisible({ timeout: 30_000 });

  // ── 6) Ouvrir la review du média ─────────────────────────────────────────────
  await mediaLink.first().click();
  await expect(page).toHaveURL(/\/review\/\d+/);
  // Le breadcrumb topbar affiche le média courant (contexte complet chargé)
  await expect(page.locator('header')).toContainText(MEDIA_NAME);

  // ── Nettoyage : projet de test → corbeille (via l'API, hors parcours testé) ──
  await page.evaluate(async (name) => {
    const token = localStorage.getItem('token');
    const headers = { Authorization: `Bearer ${token}` };
    const { projects } = (await fetch('/api/projects', { headers }).then((r) => r.json())) as {
      projects: { id: number; name: string }[];
    };
    for (const p of projects.filter((x) => x.name === name)) {
      await fetch(`/api/projects/${p.id}`, { method: 'DELETE', headers });
    }
  }, PROJECT);
});
