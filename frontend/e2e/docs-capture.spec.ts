// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Documentation screenshots.
 *
 * This is not a test: it is the **generator** of the images in `DOCUMENTATION/assets/`.
 * Taking them by hand would condemn the documentation to age: an outdated screenshot
 * misleads more than it explains, and nobody redoes forty screenshots after a
 * theme change.
 *
 * Two requirements follow:
 *
 * - **Neutral demo data.** The repo is public: a screenshot must not
 *   show a client's name or a real production shot. The script therefore builds
 *   its own project and leaves it in place for the next run.
 * - **English interface**, like the documentation. The language is forced before the
 *   first render, otherwise the application takes the account's language.
 *
 * Lancer : `npx playwright test e2e/docs-capture.spec.ts --project=chromium`
 * (or `E2E_CHANNEL=msedge` locally, like the smoke test).
 */

/**
 * Browser without extensions: the profile's own ones (ad blockers, floating widgets)
 * draw over the page and end up in the screenshots.
 */
test.use({
  launchOptions: { args: ['--disable-extensions', '--disable-component-extensions-with-background-pages'] },
});

const EMAIL = process.env.E2E_EMAIL ?? 'admin@review.local';
const PASSWORD = process.env.E2E_PASSWORD ?? 'admin1234';
const OUT = join(process.cwd(), '..', 'DOCUMENTATION', 'assets');

/** Demo project, stable from one run to the next. */
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
 * Hides the other studio projects in the sidebar.
 *
 * The repo is public: a screenshot must not let the name of a client project be read
 * because it was pinned on the account that ran the script. We hide it in the
 * display rather than touching the person's favorites.
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
    // Overlays specific to the account running the script (pending drafts, uploads in
    // progress): they teach the reader nothing and date the screenshot.
    for (const node of document.querySelectorAll('.fixed.bottom-4')) {
      node.setAttribute('data-docs-hide', '');
    }
    // TanStack Query devtools button: it only exists in development, and a
    // documentation page showing it would describe a screen nobody will ever see.
    for (const node of document.querySelectorAll('[class*="tsqd-"]')) {
      node.setAttribute('data-docs-hide', '');
    }
    // No observer: marking sets an attribute, which triggers a mutation, which
    // re-runs the marking, and the page freezes. We simply re-mark at each capture.
  }, DEMO.project);
}

/**
 * Waits until the screen is really there.
 *
 * A fixed delay is not enough: heavy pages (kanban, production) load in a
 * deferred way, and the capture caught a "Loading…" on an empty background: a useless
 * image and, worse, one that looks like the screen.
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

/** Login, English language forced, window sized to the screenshots. */
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

/** Demo dataset, created only once and then reused. */
async function ensureDemoData(page: Page): Promise<number> {
  return page.evaluate(async (demo) => {
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
    const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const get = async (url: string) => (await fetch(url, { headers: h })).json();
    const post = async (url: string, body: unknown) =>
      (await fetch(url, { method: 'POST', headers: h, body: JSON.stringify(body) })).json();

    // Idempotent per entity, not just per project: an interrupted run
    // left a half-populated project that the next run took for complete.
    // `/api/projects` responds with a page (`items`), not `projects`: confusing it with the
    // sequence shape made the project get recreated on every run.
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
 * Uploads the demo media if they are missing, and returns the ID of the video media
 * ready to be opened in review. Returns `null` if the fixtures are missing: the
 * script then continues without the viewer screenshots rather than failing.
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
      const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      const json = async (url: string, init?: RequestInit) =>
        (await fetch(url, { headers: h, ...init })).json();

      // One task of the demo plan carries the version: it is the normal path
      // of a publish, and it exercises MinIO presigning like a real upload.
      const shots = (await json(`/api/shots?projectId=${pid}`)) as {
        items?: { id: number; code: string }[];
      };
      const shotId = shots.items?.find((s) => s.code === shotCode)?.id;
      if (!shotId) return null;
      const tasks = (await json(`/api/tasks?shotId=${shotId}`)) as { items?: { id: number }[] };
      const taskId = tasks.items?.[0]?.id;
      if (!taskId) return null;

      /**
       * Media already there? We reuse it.
       *
       * `GET /api/media?projectId=` only lists **published** media, which is exactly
       * what the script produces at the end, so the search succeeds from the second
       * run on. Without it, every pass piled up one more version (V02, V03, V04...).
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
      // Published: a review is read on a published media, and the screenshot's header
      // then shows it the way the team sees it.
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

/** Links the demo project to a simulator site for the duration of the captures. */
async function linkDemoToShotgrid(page: Page, projectId: number, siteId: number) {
  await page.evaluate(
    async ({ pid, site }) => {
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
      const h = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
      await fetch(`/api/shotgrid/projects/${pid}/connection`, {
        method: 'POST',
        headers: h,
        // The simulator project: the documentation must not show any real name.
        body: JSON.stringify({ siteId: site, sgProjectId: 70, sgProjectName: 'Demo Project' }),
      });
    },
    { pid: projectId, site: siteId },
  );
}

async function unlinkDemoFromShotgrid(page: Page, projectId: number) {
  await page.evaluate(async (pid) => {
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
    await fetch(`/api/shotgrid/projects/${pid}/connection`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  }, projectId);
}

test('documentation captures', async ({ page }) => {
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

  // ── Overview, sequences, shots ──────────────────────────────────────────
  await page.goto(`/projects/${projectId}`);
  await page.waitForTimeout(1200);
  await shot(page, 'user-guide', 'project-overview');

  await page.goto(`/projects/${projectId}?tab=sequences`);
  await expect(page.getByText(DEMO.sequence.code).first()).toBeVisible();
  await shot(page, 'user-guide', 'project-sequences');

  await page.goto(`/projects/${projectId}?tab=shots`);
  await expect(page.getByText(DEMO.shots[0]!.code).first()).toBeVisible();
  await shot(page, 'user-guide', 'project-shots');

  // Context menu of a shot card, with the "Status" submenu expanded: it is the gesture
  // the documentation describes, better shown than paraphrased.
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

  // ── Members (and ShotGrid team when the project is linked) ──────────────
  await page.goto(`/projects/${projectId}?tab=members`);
  await page.waitForTimeout(800);
  await shot(page, 'admin-guide', 'project-members');

  // ── Project settings ─────────────────────────────────────────────────────
  await page.goto(`/projects/${projectId}?tab=settings`);
  await page.waitForTimeout(1000);
  await shot(page, 'admin-guide', 'project-settings');

  // ── Media review ─────────────────────────────────────────────────────────
  // The demo media is generated outside the repo (FFmpeg, test patterns): a review
  // screenshot without media would show an empty page, and embedding a video in the
  // repo would only bloat it.
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

    // Comments panel open: that is where the review takes place.
    const comments = page.getByRole('button', { name: /^(Comments|Commentaires)$/ }).first();
    if (await comments.isVisible().catch(() => false)) {
      await comments.click();
      await shot(page, 'user-guide', 'review-comments');
    }
  }

  // ── Image review ────────────────────────────────────────────────────────
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

  // ── ShotGrid ──────────────────────────────────────────────────────────────
  // Without a connection, the tab shows the linking screen, which is useful in itself: it is the first
  // thing an administrator sees. With `DOCS_SG_SITE_ID` (a local simulator), we
  // link the demo project for the duration of the captures, then unlink it.
  const sgSiteId = process.env.DOCS_SG_SITE_ID ? Number(process.env.DOCS_SG_SITE_ID) : null;
  if (sgSiteId) await linkDemoToShotgrid(page, projectId, sgSiteId);
  await page.goto(`/projects/${projectId}?tab=shotgrid`);
  await shot(page, 'admin-guide', sgSiteId ? 'shotgrid-settings' : 'shotgrid-link');
  if (sgSiteId) {
    await page.goto(`/projects/${projectId}?tab=members`);
    await settle(page);
    const loadCrew = page.getByRole('button', { name: /ShotGrid crew|équipe ShotGrid/i });
    if (await loadCrew.isVisible().catch(() => false)) {
      await loadCrew.click();
      await page.waitForTimeout(2500);
      await shot(page, 'admin-guide', 'shotgrid-crew');
    }
    await unlinkDemoFromShotgrid(page, projectId);
  }

  // ── Studio administration ────────────────────────────────────────────────
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
