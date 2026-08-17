// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

// Build de la documentation in-app : copie DOCUMENTATION/ (racine du repo) vers
// public/docs/ et génère public/docs/manifest.json (sections + pages + titres).
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

/** Titre d'une page : son premier titre de niveau 1, à défaut le nom du fichier. */
export async function pageTitle(filePath) {
  const text = await readFile(filePath, 'utf8');
  const heading = text.split('\n').find((l) => l.startsWith('# '));
  return heading ? heading.slice(2).trim() : path.basename(filePath, '.md');
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

  const sections = [];
  const rootReadme = path.join(SOURCE, 'README.md');
  sections.push({
    dir: '',
    label: 'Overview',
    pages: [{ path: 'README.md', title: await pageTitle(rootReadme) }],
  });

  const entries = await readdir(SOURCE, { withFileTypes: true });
  const dirs = orderSections(
    entries.filter((e) => e.isDirectory() && e.name !== 'assets').map((e) => e.name),
  );

  for (const dir of dirs) {
    const files = (await readdir(path.join(SOURCE, dir))).filter((f) => f.endsWith('.md')).sort();
    if (files.length === 0) continue;
    const pages = [];
    for (const file of files) {
      pages.push({
        path: `${dir}/${file}`,
        title: await pageTitle(path.join(SOURCE, dir, file)),
      });
    }
    sections.push({ dir, label: sectionLabel(dir), pages });
  }

  const manifest = { generatedAt: new Date().toISOString(), sections };
  await writeFile(path.join(TARGET, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const pageCount = sections.reduce((n, s) => n + s.pages.length, 0);
  console.log(`build-docs: ${pageCount} page(s), ${sections.length} section(s) → public/docs`);
}

// Importable pour les tests ; exécuté seulement quand on l'appelle directement.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
