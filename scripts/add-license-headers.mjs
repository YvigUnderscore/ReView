// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SPDX licence headers — writing and checking.
 *
 *   node scripts/add-license-headers.mjs           # adds the missing headers
 *   node scripts/add-license-headers.mjs --check   # writes nothing, fails if any is missing
 *
 * Idempotent: a file that already has a header is never touched. The --check mode is called by
 * scripts/validate.sh, which guarantees that no source file ships without its licence.
 *
 * The file's line endings are preserved (sources are CRLF under Windows, and prettier runs with
 * endOfLine "auto": injecting LF would trigger a full rewrite of the file).
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const COPYRIGHT = 'SPDX-FileCopyrightText: 2026 Yvig Bidon';
export const LICENSE_ID = 'SPDX-License-Identifier: AGPL-3.0-or-later';

/** Scanned roots, relative to the repository root. */
export const ROOTS = [
  'backend/src',
  'backend/scripts',
  'backend/prisma',
  'frontend/src',
  'frontend/scripts',
  'frontend/e2e',
  'scripts',
];

/** Configuration files at the package roots (outside the roots above). */
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

/** Directories never scanned (dependencies, artefacts, generated code). */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', 'generated', 'migrations']);

const SLASH_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.prisma']);
const HASH_EXT = new Set(['.sh', '.py']);
/** Types without line comments: the header is written as one-line block comments. */
const BLOCK_EXT = new Set(['.css']);

/** Comment prefix matching the extension, or null if the type is ignored. */
export function commentPrefix(ext) {
  if (SLASH_EXT.has(ext)) return '//';
  if (HASH_EXT.has(ext)) return '#';
  if (BLOCK_EXT.has(ext)) return '/*';
  return null;
}

/** Comment closing — empty for types commented line by line. */
export function commentSuffix(ext) {
  return BLOCK_EXT.has(ext) ? ' */' : '';
}

/** True if the SPDX header is already present in the first lines. */
export function hasHeader(content) {
  return content.split(/\r?\n/, 15).some((line) => line.includes('SPDX-License-Identifier'));
}

/** Dominant line ending of the file (that of its first line). */
export function detectEol(content) {
  return content.includes('\r\n') ? '\r\n' : '\n';
}

/**
 * Returns the content with the header. The shebang stays on the first line; the header slots in
 * right after it. Returns the content unchanged if it already carries a header.
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

/** Recursive list of the eligible files under `dir`. */
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

/** All the repository's source files that must carry the header. */
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

// Run directly (and not imported by a test) → launch it.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
