// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Captures d'écran de la documentation.
 *
 * Ce n'est pas un test : c'est le **générateur** des images de `DOCUMENTATION/assets/`.
 * Les prendre à la main condamnait la documentation à vieillir — une capture périmée
 * ment plus qu'elle n'explique, et personne ne refait quarante captures après un
 * changement de thème.
 *
 * Deux exigences en découlent :
 *
 * - **Données de démonstration neutres.** Le dépôt est public : une capture ne doit
 *   montrer ni le nom d'un client, ni un plan de production réel. Le script fabrique donc
 *   son propre projet, et le laisse en place pour la prochaine exécution.
 * - **Interface en anglais**, comme la documentation. La langue est forcée avant le
 *   premier rendu, sinon l'application prend celle du compte.
 *
 * Lancer : `npx playwright test e2e/docs-capture.spec.ts --project=chromium`
 * (ou `E2E_CHANNEL=msedge` en local, comme le smoke).
 */

/**
 * Navigateur sans extensions : celles du profil de l'utilisateur (bloqueurs, widgets
 * flottants) se dessinent par-dessus la page et se retrouvent dans les captures.
 */
test.use({
  launchOptions: { args: ['--disable-extensions', '--disable-component-extensions-with-background-pages'] },
});

const EMAIL = process.env.E2E_EMAIL ?? 'admin@review.local';
const PASSWORD = process.env.E2E_PASSWORD ?? 'admin1234';
const OUT = join(process.cwd(), '..', 'DOCUMENTATION', 'assets');

/** Projet de démonstration, stable d'une exécution à l'autre. */
const DEMO = {
  project: 'Nebula Rising',
  sequence: { code: 'SQ010', name: 'Landing bay' },
  shots: [
    { code: 'SH010', name: 'Wide establishing' },
    { code: 'SH020', name: 'Pilot close-up' },
    { code: 'SH030', name: 'Bay doors open' },
  ],
  asset: { name: 'Pilot suit', type: 'CHARACTER' },
};

/**
 * Masque les autres projets du studio dans la barre latérale.
 *
 * Le dépôt est public : une capture ne doit pas laisser lire le nom d'un projet client
 * parce qu'il se trouvait épinglé sur le compte qui a lancé le script. On masque à
 * l'affichage plutôt que de toucher aux favoris de la personne.
 */
async function hideOtherProjects(page: Page) {
  await page.evaluate((name) => {
    const style = document.createElement('style');
    style.textContent = '[data-docs-hide]{display:none !important}';
    document.head.append(style);
    for (const link of document.querySelectorAll('a[href^="/projects/"]')) {
      const text = link.textContent?.trim() ?? '';
      if (text && !text.includes(name)) link.setAttribute('data-docs-hide', '');
    }
    // Surcouches propres au compte qui lance le script (brouillons en attente, envois en
    // cours) : elles n'apprennent rien au lecteur et datent la capture.
    for (const node of document.querySelectorAll('.fixed.bottom-4')) {
      node.setAttribute('data-docs-hide', '');
    }
    // Bouton des devtools TanStack Query : il n'existe qu'en développement, et une
    // documentation qui le montre décrit un écran que personne n'aura jamais.
    for (const node of document.querySelectorAll('[class*="tsqd-"]')) {
      node.setAttribute('data-docs-hide', '');
    }
    // Pas d'observateur : marquer pose un attribut, qui déclenche une mutation, qui
    // relance le marquage — la page se fige. On re-marque à chaque capture, c'est tout.
  }, DEMO.project);
}

/**
 * Attend que l'écran soit vraiment là.
 *
 * Un délai fixe ne suffit pas : les pages lourdes (kanban, production) se chargent en
 * différé, et la capture attrapait un « Loading… » sur fond vide — une image inutile, et
 * pire, une image qui a l'air d'être l'écran.
 */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page
    .getByText(/^(Loading|Chargement)/)
    .first()
    .waitFor({ state: 'hidden', timeout: 20_000 })
    .catch(() => undefined);
  await page.waitForTimeout(600); // animations d'entrée
}

async function shot(page: Page, section: string, name: string) {
  mkdirSync(join(OUT, section), { recursive: true });
  await settle(page);
  await hideOtherProjects(page);
  await page.screenshot({ path: join(OUT, section, `${name}.png`) });
}

/** Connexion, langue anglaise forcée, fenêtre au format des captures. */
async function signIn(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('locale', 'en');
  });
  await page.goto('/');
  await page.waitForURL(/\/(login|setup)?(\?.*)?$/);
  if (page.url().includes('/setup')) {
    await page.fill('#studioName', 'Demo Studio');
    await page.fill('#adminEmail', EMAIL);
    await page.fill('#adminPassword', PASSWORD);
    await page.getByRole('button', { name: /Create studio|Créer le studio/ }).click();
  } else {
    await page.fill('#email', EMAIL);
    await page.fill('#password', PASSWORD);
    await page.getByRole('button', { name: /Sign in|Se connecter/ }).click();
  }
  await page.waitForURL((url) => !/\/(login|setup)/.test(url.pathname), { timeout: 30_000 });
}

/** Jeu de démonstration, créé une seule fois puis réutilisé. */
async function ensureDemoData(page: Page): Promise<number> {
  return page.evaluate(async (demo) => {
    const token = window.localStorage.getItem('token');
    const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const get = async (url: string) => (await fetch(url, { headers: h })).json();
    const post = async (url: string, body: unknown) =>
      (await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) })).json();

    // Idempotent entité par entité, pas seulement sur le projet : une exécution
    // interrompue laissait un projet à demi peuplé que la suivante croyait complet.
    // `/api/projects` répond en page (`items`), pas en `projects` : la confondre avec la
    // forme des séquences faisait recréer le projet à chaque exécution.
    const projects = (await get('/api/projects')) as { items?: { id: number; name: string }[] };
    let pid = projects.items?.find((p) => p.name === demo.project)?.id;
    if (!pid) {
      const created = (await post('/api/projects', { name: demo.project })) as {
        project?: { id: number };
        id?: number;
      };
      pid = created.project?.id ?? created.id!;
    }

    const sequences = (await get(`/api/sequences?projectId=${pid}`)) as {
      sequences?: { id: number; code: string }[];
    };
    let sequenceId = sequences.sequences?.find((s) => s.code === demo.sequence.code)?.id;
    if (!sequenceId) {
      const created = (await post('/api/sequences', {
        projectId: pid,
        code: demo.sequence.code,
        name: demo.sequence.name,
      })) as { sequence?: { id: number }; id?: number };
      sequenceId = created.sequence?.id ?? created.id!;
    }

    const shots = (await get(`/api/shots?projectId=${pid}`)) as {
      items?: { id: number; code: string }[];
    };
    for (const s of demo.shots) {
      if (shots.items?.some((x) => x.code === s.code)) continue;
      const created = (await post('/api/shots', {
        projectId: pid,
        sequenceId,
        code: s.code,
        name: s.name,
      })) as { shot?: { id: number }; id?: number };
      const shotId = created.shot?.id ?? created.id;
      if (!shotId) continue;
      for (const task of ['Layout', 'Animation', 'Compositing']) {
        await post('/api/tasks', { shotId, name: task, type: 'OTHER' });
      }
    }

    const assets = (await get(`/api/assets?projectId=${pid}`)) as {
      items?: { id: number; name: string }[];
    };
    if (!assets.items?.some((a) => a.name === demo.asset.name)) {
      await post('/api/assets', { projectId: pid, name: demo.asset.name, type: demo.asset.type });
    }
    return pid;
  }, DEMO);
}

/**
 * Téléverse les médias de démonstration s'ils manquent, et rend l'identifiant du média
 * vidéo prêt à être passé en review. Rend `null` si les fixtures ne sont pas là — le
 * script continue alors sans les captures de viewer plutôt que d'échouer.
 */
async function uploadDemoMedia(
  page: Page,
  projectId: number,
  spec: { shotCode: string; file: string; kind: 'VIDEO' | 'IMAGE'; mime: string },
): Promise<number | null> {
  const fixtures = process.env.DOCS_FIXTURES ?? join(process.cwd(), '..', '..', 'tmp', 'review-demo');
  const source = join(fixtures, spec.file);
  if (!existsSync(source)) return null;

  const bytes = readFileSync(source);

  return page.evaluate(
    async ({ pid, base64, name, shotCode, kind, mime }) => {
      const token = window.localStorage.getItem('token');
      const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const json = async (url: string, init?: RequestInit) =>
        (await fetch(url, { headers: h, ...init })).json();

      // Une tâche du plan de démonstration porte la version : c'est le chemin normal
      // d'un publish, et il exerce la présignature MinIO comme un vrai dépôt.
      const shots = (await json(`/api/shots?projectId=${pid}`)) as {
        items?: { id: number; code: string }[];
      };
      const shotId = shots.items?.find((s) => s.code === shotCode)?.id;
      if (!shotId) return null;
      const tasks = (await json(`/api/tasks?shotId=${shotId}`)) as { items?: { id: number }[] };
      const taskId = tasks.items?.[0]?.id;
      if (!taskId) return null;

      /**
       * Un média déjà là ? On le réutilise.
       *
       * `GET /api/media?projectId=` ne liste que les médias **publiés** — c'est justement
       * ce que le script produit à la fin, donc la recherche aboutit dès la deuxième
       * exécution. Sans elle, chaque passe empilait une version de plus (V02, V03, V04…).
       */
      const media = (await json(`/api/media?projectId=${pid}&kind=${kind}`)) as {
        items?: { id: number; kind: string }[];
      };
      const already = media.items?.find((m) => m.kind === kind);
      if (already) return already.id;

      const version = (await json('/api/versions', {
        method: 'POST',
        body: JSON.stringify({ taskId, projectId: pid }),
      })) as { version?: { id: number }; id?: number };
      const versionId = version.version?.id ?? version.id;
      if (!versionId) return null;

      const upload = (await json('/api/media/upload-url', {
        method: 'POST',
        body: JSON.stringify({ versionId, filename: name, contentType: mime, kind }),
      })) as { mediaObjectId?: number; uploadUrl?: string };
      const mediaId = upload.mediaObjectId;
      const url = upload.uploadUrl;
      if (!mediaId || !url) return null;

      const binary = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      await fetch(url, { method: 'PUT', body: binary, headers: { 'Content-Type': mime } });
      await json(`/api/media/${mediaId}/finalize`, { method: 'POST' });
      // Publié : une review se lit sur un média publié, et l'en-tête de la capture le
      // montre alors tel que l'équipe le voit.
      await json(`/api/media/${mediaId}/publish`, { method: 'POST' });
      return mediaId;
    },
    {
      pid: projectId,
      base64: bytes.toString('base64'),
      name: spec.file,
      shotCode: spec.shotCode,
      kind: spec.kind,
      mime: spec.mime,
    },
  );
}

test('captures de la documentation', async ({ page }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await signIn(page);

  // ── Accueil ───────────────────────────────────────────────────────────────
  await page.goto('/');
  await expect(page.getByText(/Hello|Bonjour/).first()).toBeVisible();
  await shot(page, 'getting-started', 'home');

  const projectId = await ensureDemoData(page);

  // ── Projets ───────────────────────────────────────────────────────────────
  await page.goto('/projects');
  await expect(page.getByText(DEMO.project).first()).toBeVisible();
  await shot(page, 'user-guide', 'projects-list');

  // ── Vue d'ensemble, séquences, plans ──────────────────────────────────────
  await page.goto(`/projects/${projectId}`);
  await page.waitForTimeout(1200);
  await shot(page, 'user-guide', 'project-overview');

  await page.goto(`/projects/${projectId}?tab=sequences`);
  await expect(page.getByText(DEMO.sequence.code).first()).toBeVisible();
  await shot(page, 'user-guide', 'project-sequences');

  await page.goto(`/projects/${projectId}?tab=shots`);
  await expect(page.getByText(DEMO.shots[0]!.code).first()).toBeVisible();
  await shot(page, 'user-guide', 'project-shots');

  // Menu contextuel d'une carte de plan, sous-menu « Status » déplié : c'est le geste
  // que la documentation décrit, il vaut mieux le montrer que le paraphraser.
  await page.getByText(DEMO.shots[0]!.code).first().click({ button: 'right' });
  const statusEntry = page.getByRole('menuitem', { name: /^(Status|Statut)$/ });
  if (await statusEntry.isVisible().catch(() => false)) {
    await statusEntry.hover();
    await page.waitForTimeout(600);
    await shot(page, 'user-guide', 'shot-context-menu-status');
  }
  await page.keyboard.press('Escape');

  // ── Assets ────────────────────────────────────────────────────────────────
  await page.goto(`/projects/${projectId}?tab=assets`);
  await expect(page.getByText(DEMO.asset.name).first()).toBeVisible();
  await shot(page, 'user-guide', 'project-assets');

  // ── Kanban ────────────────────────────────────────────────────────────────
  await page.goto(`/projects/${projectId}/kanban`);
  await page.waitForTimeout(1500);
  await shot(page, 'user-guide', 'kanban');

  // ── Production (statistiques, calendrier) ─────────────────────────────────
  await page.goto(`/projects/${projectId}?tab=production`);
  await page.waitForTimeout(1500);
  await shot(page, 'user-guide', 'production-reporting');

  // ── Membres (et équipe ShotGrid quand le projet est relié) ────────────────
  await page.goto(`/projects/${projectId}?tab=members`);
  await page.waitForTimeout(800);
  await shot(page, 'admin-guide', 'project-members');

  // ── Réglages du projet ────────────────────────────────────────────────────
  await page.goto(`/projects/${projectId}?tab=settings`);
  await page.waitForTimeout(1000);
  await shot(page, 'admin-guide', 'project-settings');

  // ── Review d'un média ─────────────────────────────────────────────────────
  // Les médias de démonstration sont générés hors du dépôt (FFmpeg, mires de test) : une
  // capture de review sans média montrerait une page vide, et embarquer une vidéo dans le
  // dépôt le ferait grossir pour rien.
  const uploaded = await uploadDemoMedia(page, projectId, {
    shotCode: 'SH010',
    file: 'SH010_comp_v001.mp4',
    kind: 'VIDEO',
    mime: 'video/mp4',
  });
  if (uploaded) {
    await page.goto(`/review/${uploaded}`);
    await settle(page);
    await page.waitForTimeout(2500); // décodage de la première image
    await shot(page, 'user-guide', 'review-video');

    // Panneau de commentaires ouvert : c'est là que se joue la review.
    const comments = page.getByRole('button', { name: /^(Comments|Commentaires)$/ }).first();
    if (await comments.isVisible().catch(() => false)) {
      await comments.click();
      await shot(page, 'user-guide', 'review-comments');
    }
  }

  // ── Review d'image ────────────────────────────────────────────────────────
  const image = await uploadDemoMedia(page, projectId, {
    shotCode: 'SH020',
    file: 'SH020_matte_v001.png',
    kind: 'IMAGE',
    mime: 'image/png',
  });
  if (image) {
    await page.goto(`/review/${image}`);
    await settle(page);
    await page.waitForTimeout(1500);
    await shot(page, 'user-guide', 'review-image');
  }

  // ── Playlists (dailies) ───────────────────────────────────────────────────
  await page.goto(`/projects/${projectId}?tab=playlists`);
  await shot(page, 'user-guide', 'playlists');

  // ── Partages ──────────────────────────────────────────────────────────────
  await page.goto(`/projects/${projectId}?tab=shares`);
  await shot(page, 'user-guide', 'shares');

  // ── Administration du studio ──────────────────────────────────────────────
  await page.goto('/admin');
  await page.waitForTimeout(1500);
  await shot(page, 'admin-guide', 'admin-overview');

  // ── Recherche globale ─────────────────────────────────────────────────────
  await page.goto('/');
  await page.keyboard.press('Control+k');
  await page.waitForTimeout(700);
  await shot(page, 'user-guide', 'command-palette');
  await page.keyboard.press('Escape');
});
