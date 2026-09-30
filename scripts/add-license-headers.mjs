// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * En-têtes de licence SPDX — pose et vérification.
 *
 *   node scripts/add-license-headers.mjs           # pose les en-têtes manquants
 *   node scripts/add-license-headers.mjs --check   # n'écrit rien, échoue s'il en manque
 *
 * Idempotent : un fichier déjà en-hêté n'est jamais retouché. Le mode --check est
 * appelé par scripts/validate.sh, ce qui garantit qu'aucun fichier source ne part
 * sans sa licence.
 *
 * Les fins de ligne du fichier sont préservées (les sources sont en CRLF sous Windows,
 * et prettier tourne en endOfLine "auto" : injecter du LF déclencherait une réécriture
 * complète du fichier).
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COPYRIGHT = 'SPDX-FileCopyrightText: 2026 Yvig Bidon';
export const LICENSE_ID = 'SPDX-License-Identifier: AGPL-3.0-or-later';

/** Racines balayées, relatives à la racine du dépôt. */
export const ROOTS = [
  'backend/src',
  'backend/scripts',
  'backend/prisma',
  'frontend/src',
  'frontend/scripts',
  'frontend/e2e',
  'scripts',
];

/** Fichiers de configuration à la racine des paquets (hors des racines ci-dessus). */
export const EXTRA_FILES = [
  'backend/vitest.config.ts',
  'backend/vitest.integration.config.ts',
  'frontend/eslint.config.js',
  'frontend/playwright.config.ts',
  'frontend/postcss.config.js',
  'frontend/tailwind.config.js',
  'frontend/vite.config.js',
  'frontend/vitest.config.ts',
  'frontend/vitest.setup.ts',
];

/** Dossiers jamais balayés (dépendances, artefacts, code généré). */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'generated', 'migrations']);

const SLASH_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.prisma']);
const HASH_EXT = new Set(['.sh', '.py']);
/** Types sans commentaire de ligne : l'en-tête s'écrit en commentaires de bloc d'une ligne. */
const BLOCK_EXT = new Set(['.css']);

/** Préfixe de commentaire correspondant à l'extension, ou null si le type est ignoré. */
export function commentPrefix(ext) {
  if (SLASH_EXT.has(ext)) return '//';
  if (HASH_EXT.has(ext)) return '#';
  if (BLOCK_EXT.has(ext)) return '/*';
  return null;
}

/** Fermeture du commentaire — vide pour les types commentés ligne à ligne. */
export function commentSuffix(ext) {
  return BLOCK_EXT.has(ext) ? ' */' : '';
}

/** Vrai si l'en-tête SPDX est déjà présent dans les premières lignes. */
export function hasHeader(content) {
  return content.split(/\r?\n/, 15).some((line) => line.includes('SPDX-License-Identifier'));
}

/** Fin de ligne dominante du fichier (celle de sa première ligne). */
export function detectEol(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Retourne le contenu en-têté. Le shebang reste en première ligne ; l'en-tête se glisse
 * juste après. Rend le contenu inchangé s'il porte déjà un en-tête.
 */
export function withHeader(content, ext) {
  const prefix = commentPrefix(ext);
  if (!prefix || hasHeader(content)) return content;

  const eol = detectEol(content);
  const suffix = commentSuffix(ext);
  const header = `${prefix} ${COPYRIGHT}${suffix}${eol}${prefix} ${LICENSE_ID}${suffix}${eol}`;
  const lines = content.split(eol);

  if (lines[0]?.startsWith('#!')) {
    const rest = lines.slice(1).join(eol);
    const spacer = rest.startsWith(eol) || rest === '' ? '' : eol;
    return `${lines[0]}${eol}${header}${spacer}${rest}`;
  }
  const spacer = content.startsWith(eol) || content === '' ? '' : eol;
  return `${header}${spacer}${content}`;
}

/** Liste récursive des fichiers éligibles sous `dir`. */
async function collect(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) await collect(full, out);
    } else if (commentPrefix(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

/** Tous les fichiers source du dépôt qui doivent porter l'en-tête. */
export async function listSourceFiles(repoRoot) {
  const files = [];
  for (const root of ROOTS) await collect(path.join(repoRoot, root), files);
  for (const extra of EXTRA_FILES) files.push(path.join(repoRoot, extra));
  return files.sort();
}

async function main() {
  const check = process.argv.includes('--check');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const files = await listSourceFiles(repoRoot);

  const touched = [];
  for (const file of files) {
    let content;
    try {
      content = await readFile(file, 'utf8');
    } catch {
      continue; // fichier optionnel absent (EXTRA_FILES)
    }
    const next = withHeader(content, path.extname(file));
    if (next === content) continue;
    touched.push(path.relative(repoRoot, file).replaceAll('\\', '/'));
    if (!check) await writeFile(file, next);
  }

  if (check) {
    if (touched.length) {
      console.error(`✗ ${touched.length} fichier(s) sans en-tête SPDX :`);
      for (const f of touched) console.error(`  ${f}`);
      console.error('  → lancer : node scripts/add-license-headers.mjs');
      process.exit(1);
    }
    console.log(`✓ en-têtes SPDX présents (${files.length} fichiers)`);
    return;
  }
  console.log(
    touched.length
      ? `✓ en-tête ajouté à ${touched.length} fichier(s) sur ${files.length}`
      : `✓ rien à faire, les ${files.length} fichiers portent déjà l'en-tête`,
  );
}

// Exécuté directement (et non importé par un test) → on lance.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
