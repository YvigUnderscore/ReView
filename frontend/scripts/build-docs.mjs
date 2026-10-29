// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

// Builds the in-app documentation: copies DOCUMENTATION/ (repo root) to
// public/docs/ and generates public/docs/manifest.json (ordered sections, titles,
// subtitles, update date, chapter titles).
// Runs automatically before `npm run dev` and `npm run build` (predev/prebuild).
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(__dirname, '../../DOCUMENTATION');
const TARGET = path.resolve(__dirname, '../public/docs');

// Display order of sections on the /docs page (unknown folders go last).
const SECTION_ORDER = [
  'getting-started',
  'user-guide',
  'admin-guide',
  'api',
  'infrastructure',
  'development',
];

/**
 * Reading order inside a section.
 *
 * Alphabetical order would put "3d-alembic" before "overview" and split the four pages of
 * review: this is not a table of contents, it is a listing. A page missing from this table goes
 * to the end, in alphabetical order. It is never lost, only misplaced, and the
 * build reports it.
 */
export const PAGE_ORDER = {
  'getting-started': ['feature-tour.md', 'installation.md', 'first-run.md', 'docker-stack.md', 'updating.md'],
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
    'client-portal.md',
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
    'updates-and-backups.md',
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

/** Display order: known sections first, the rest in alphabetical order. */
export const orderSections = (dirs) =>
  [...dirs].sort((a, b) => {
    const ia = SECTION_ORDER.indexOf(a);
    const ib = SECTION_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b);
  });

/** Reading order of a section; pages not listed come last. */
export const orderPages = (dir, files) => {
  const wanted = PAGE_ORDER[dir] ?? [];
  return [...files].sort((a, b) => {
    const ia = wanted.indexOf(a);
    const ib = wanted.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib) || a.localeCompare(b);
  });
};

/** Pages present on disk but missing from the table of contents: they will go at the end. */
export const unlistedPages = (dir, files) => {
  const wanted = PAGE_ORDER[dir];
  return wanted ? files.filter((f) => !wanted.includes(f)) : [];
};

/**
 * Title and subtitle are rendered as plain text: in the page header, in the list
 * of the table of contents, in the tooltip. The inline markdown they carry (`code`, **bold**,
 * *italic*, [link](url)) would be displayed as is there: "From `git clone` to…". It is therefore
 * stripped here, and kept in the file, where GitHub renders it correctly.
 */
export const plainText = (markdown) =>
  markdown
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .trim();

/**
 * Metadata of a page, read from its conventional form:
 *
 *     # Titre
 *     *One-line subtitle.*
 *     > Updated: 2026-08-23
 *
 * The title falls back to the file name, the rest to an empty string: a page that does not
 * follow the convention remains servable, it is just less well presented.
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

/**
 * Internal headings of a page: what we find it by.
 *
 * The manifest only carried the title and subtitle: searching "watermark" in the
 * palette rendered no page, although the documentation devotes three chapters to it.
 * Indexing the whole body would mean shipping 1.2 MB of markdown with every session;
 * the chapter titles are its table of contents, for thirty kilobytes, and they
 * also say *why* the page matches.
 *
 * Code blocks are removed first: a `## ` in the middle of a shell snippet is not
 * a chapter. Level 1 is excluded, since it is the page title, already indexed.
 */
export function pageHeadings(markdown) {
  const prose = markdown.replace(/^```[\s\S]*?^```/gm, '');
  const found = new Set();
  for (const line of prose.split('\n')) {
    const heading = /^#{2,4}\s+(.+?)\s*$/.exec(line);
    if (heading) {
      const text = plainText(heading[1]);
      if (text) found.add(text);
    }
  }
  return [...found];
}

/** Title of a page: its first level-1 heading, failing that the file name. */
export async function pageTitle(filePath) {
  const text = await readFile(filePath, 'utf8');
  return parsePageMeta(text, path.basename(filePath, '.md')).title;
}

/** Metadata of a page in the source folder. */
async function readPage(dir, file) {
  const filePath = path.join(SOURCE, dir, file);
  const text = await readFile(filePath, 'utf8');
  const meta = parsePageMeta(text, path.basename(file, '.md'));
  return { path: dir ? `${dir}/${file}` : file, ...meta, headings: pageHeadings(text) };
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

// Importable for tests; only runs when called directly.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
