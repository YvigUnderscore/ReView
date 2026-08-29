// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

// Build de la documentation in-app : copie DOCUMENTATION/ (racine du repo) vers
// public/docs/ et génère public/docs/manifest.json (sections ordonnées, titres,
// sous-titres, date de mise à jour).
// Exécuté automatiquement avant `npm run dev` et `npm run build` (predev/prebuild).
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(__dirname, '../../DOCUMENTATION');
const TARGET = path.resolve(__dirname, '../public/docs');

// Ordre d'affichage des sections dans la page /docs (les dossiers inconnus vont à la fin).
const SECTION_ORDER = [
  'getting-started',
  'user-guide',
  'admin-guide',
  'api',
  'infrastructure',
  'development',
];

/**
 * Ordre de lecture à l'intérieur d'une section.
 *
 * L'ordre alphabétique met « 3d-alembic » avant « overview » et sépare les quatre pages de
 * review : ce n'est pas un sommaire, c'est un listing. Une page absente de cette table part
 * à la fin, par ordre alphabétique — elle n'est jamais perdue, seulement mal placée, et le
 * build le signale.
 */
export const PAGE_ORDER = {
  'getting-started': [
    'feature-tour.md',
    'installation.md',
    'first-run.md',
    'sample-project.md',
    'docker-stack.md',
    'updating.md',
  ],
  'user-guide': [
    'navigation-and-search.md',
    'projects-and-pipeline.md',
    'entity-briefs.md',
    'upload-and-publishing.md',
    'media-processing.md',
    'review-workspace.md',
    'review-video.md',
    'review-image.md',
    'image-sequences.md',
    'review-3d.md',
    'camera-animation.md',
    'review-splat.md',
    'annotations-and-comments.md',
    'review-approvals.md',
    'playlists-and-live-review.md',
    'auto-cut-timelines.md',
    'kanban-and-tasks.md',
    'boards.md',
    'production-reporting.md',
    'sharing.md',
    'exporting-notes.md',
    'importing-a-project.md',
    'messaging-and-profiles.md',
    'personalization.md',
    'account-security.md',
  ],
  'admin-guide': [
    'overview.md',
    'users-and-roles.md',
    'project-organization.md',
    'hiding-elements.md',
    'pipeline-settings.md',
    'transcoding.md',
    'color-management.md',
    'storage.md',
    'data-retention.md',
    'content-explorer.md',
    'secure-distribution.md',
    'identity-and-api.md',
    'shotgrid-integration.md',
    'smtp-and-announcements.md',
    'branding-and-notifications.md',
    'hdri-library.md',
    'spatial-thumbnails.md',
    '3d-usd.md',
    '3d-alembic.md',
    'system-and-maintenance.md',
  ],
  api: ['overview.md', 'authentication.md', 'domains.md', 'v1-integration.md', 'python-client.md'],
  infrastructure: [
    'architecture.md',
    'containers-and-configuration.md',
    'storage-minio.md',
    'jobs-and-workers.md',
    'hls-delivery.md',
    'monitoring.md',
    'backups.md',
    'security.md',
  ],
  development: [
    'code-structure.md',
    'conventions.md',
    'validation-and-tests.md',
    'i18n.md',
    'accessibility.md',
    'documentation-style.md',
    'licensing.md',
  ],
};

export const sectionLabel = (dir) =>
  dir
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

/** Ordre d'affichage : les sections connues d'abord, le reste par ordre alphabétique. */
export const orderSections = (dirs) =>
  [...dirs].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a);
    const ib = SECTION_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });

/** Ordre de lecture d'une section ; les pages non listées ferment la marche. */
export const orderPages = (dir, files) => {
  const wanted = PAGE_ORDER[dir] ?? [];
  return [...files].sort((a, b) => {
    const ia = wanted.indexOf(a);
    const ib = wanted.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
  });
};

/** Pages présentes sur le disque mais absentes du sommaire : elles partiront à la fin. */
export const unlistedPages = (dir, files) => {
  const wanted = PAGE_ORDER[dir];
  return wanted ? files.filter((f) => !wanted.includes(f)) : [];
};

/**
 * Titre et sous-titre sont rendus en texte brut — dans l'en-tête de la page, dans la liste
 * du sommaire, dans l'infobulle. Le markdown en ligne qu'ils portent (`code`, **gras**,
 * *italique*, [lien](url)) s'y afficherait tel quel : « From `git clone` to… ». Il est donc
 * retiré ici, et conservé dans le fichier, où GitHub le rend correctement.
 */
export const plainText = (markdown) =>
  markdown
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();

/**
 * Métadonnées d'une page, lues sur sa forme conventionnelle :
 *
 *     # Titre
 *     *Sous-titre d'une ligne.*
 *     > Updated: 2026-08-23
 *
 * Le titre retombe sur le nom du fichier, le reste sur une chaîne vide : une page qui ne
 * suit pas la convention reste servable, elle est seulement moins bien présentée.
 */
export function parsePageMeta(text, fallbackTitle) {
  const lines = text.split('\n');
  const h1 = lines.findIndex((l) => l.startsWith('# '));
  const title = h1 === -1 ? fallbackTitle : plainText(lines[h1].slice(2));

  const head = lines.slice(h1 + 1, h1 + 8);
  const summary = plainText(
    head
      .find((l) => /^\*[^*].*\*\s*$/.test(l.trim()))
      ?.trim()
      .slice(1, -1) ?? '',
  );
  const updated = head.find((l) => /^>\s*Updated\s*:/i.test(l))?.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? '';

  return { title, summary, updated };
}

/** Titre d'une page : son premier titre de niveau 1, à défaut le nom du fichier. */
export async function pageTitle(filePath) {
  const text = await readFile(filePath, 'utf8');
  return parsePageMeta(text, path.basename(filePath, '.md')).title;
}

/** Métadonnées d'une page du dossier source. */
async function readPage(dir, file) {
  const filePath = path.join(SOURCE, dir, file);
  const text = await readFile(filePath, 'utf8');
  const meta = parsePageMeta(text, path.basename(file, '.md'));
  return { path: dir ? `${dir}/${file}` : file, ...meta };
}

async function main() {
  try {
    await stat(SOURCE);
  } catch {
    console.error(`build-docs: dossier source introuvable (${SOURCE})`);
    process.exit(1);
  }

  await rm(TARGET, { recursive: true, force: true });
  await mkdir(TARGET, { recursive: true });
  await cp(SOURCE, TARGET, {
    recursive: true,
    filter: (src) => !src.endsWith('.gitkeep'),
  });

  const sections = [{ dir: '', label: 'Overview', pages: [await readPage('', 'README.md')] }];

  const entries = await readdir(SOURCE, { withFileTypes: true });
  const dirs = orderSections(
    entries.filter((e) => e.isDirectory() && e.name !== 'assets').map((e) => e.name),
  );

  const unlisted = [];
  for (const dir of dirs) {
    const files = (await readdir(path.join(SOURCE, dir))).filter((f) => f.endsWith('.md'));
    if (files.length === 0) continue;
    unlisted.push(...unlistedPages(dir, files).map((f) => `${dir}/${f}`));
    const pages = [];
    for (const file of orderPages(dir, files)) pages.push(await readPage(dir, file));
    sections.push({ dir, label: sectionLabel(dir), pages });
  }

  const manifest = { generatedAt: new Date().toISOString(), sections };
  await writeFile(path.join(TARGET, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const pageCount = sections.reduce((n, s) => n + s.pages.length, 0);
  console.log(`build-docs: ${pageCount} page(s), ${sections.length} section(s) → public/docs`);
  if (unlisted.length > 0)
    console.warn(`build-docs: hors sommaire (rangées en fin de section) : ${unlisted.join(', ')}`);
}

// Importable pour les tests ; exécuté seulement quand on l'appelle directement.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
