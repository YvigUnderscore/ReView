// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Génère THIRD-PARTY-NOTICES.md — l'attribution des composants tiers redistribués.
 *
 *   node scripts/generate-notices.mjs           # (re)génère le fichier
 *   node scripts/generate-notices.mjs --check   # n'écrit rien, échoue s'il est périmé
 *
 * Pourquoi : MIT, BSD, ISC et OFL exigent que leur notice de copyright accompagne toute
 * redistribution. ReView redistribue ses dépendances (bundle du navigateur, image Docker),
 * cette obligation s'applique donc, licence du projet mise à part.
 *
 * Seul l'arbre de **production** est retenu : les devDependencies (vite, eslint, vitest…)
 * ne sont jamais distribuées et n'ont donc aucune notice à porter.
 *
 * Zéro dépendance : la résolution npm est rejouée à la main sur les package-lock.json.
 */
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Paquets scannés, dans l'ordre d'apparition dans le fichier. */
export const WORKSPACES = [
  { dir: 'backend', label: 'Backend (Node.js runtime)' },
  { dir: 'frontend', label: 'Frontend (browser bundle)' },
];

const LICENSE_FILE = /^(LICEN[CS]E|COPYING|NOTICE)($|[.\-_])/i;

/**
 * Paquets qui omettent le champ `license` de leur package.json alors que leur fichier de
 * licence lève toute ambiguïté. Vérifié à la main, un par un — sans quoi le récapitulatif
 * afficherait un « UNKNOWN » trompeur.
 */
export const LICENSE_OVERRIDES = {
  // Fichier `license` du paquet : « The MIT License (MIT) — Copyright (c) 2019-present
  // Fabio Spampinato, Andrew Maney ». Tiré par mermaid ← @excalidraw/excalidraw.
  'khroma@2.1.0': 'MIT',
};

/**
 * Licences acceptables pour une dépendance de production : permissives, domaine public,
 * MPL-2.0 (compatible par sa clause 3.3) et les copyleft explicitement compatibles avec
 * l'AGPLv3 — donc « or later » à partir de GPL-2.0, jamais les variantes « only ».
 *
 * Toute licence hors de cette liste (propriétaire, BSL, Elastic, Commons Clause, SSPL,
 * GPL-2.0-only, ou paquet sans licence identifiable) fait échouer le script : la règle
 * « toute dépendance doit être compatible AGPL » est ainsi outillée et non plus seulement
 * écrite. Un paquet dont le champ `license` manque mais dont le fichier LICENSE tranche
 * passe par LICENSE_OVERRIDES, après vérification à la main.
 */
export const ALLOWED_LICENSES = new Set([
  '0BSD',
  'AGPL-3.0-or-later',
  'Apache-2.0',
  'Artistic-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'CC-BY-4.0',
  'GPL-2.0-or-later',
  'GPL-3.0-or-later',
  'ISC',
  'LGPL-2.1-or-later',
  'LGPL-3.0-or-later',
  'MIT',
  'MIT-0',
  'MPL-2.0',
  'OFL-1.1',
  'Python-2.0',
  'Unlicense',
  'WTFPL',
  'Zlib',
]);

/**
 * Évalue une expression SPDX contre `ALLOWED_LICENSES` : `MIT`, `(MIT AND Zlib)`,
 * `(MPL-2.0 OR Apache-2.0)`, `Apache-2.0 WITH LLVM-exception`.
 *
 * `OR` laisse le choix — une seule branche acceptable suffit. `AND` impose de respecter
 * les deux — toutes doivent l'être. Une exception (`WITH`) ne fait que lever des
 * obligations : seule la licence qu'elle accompagne est examinée.
 */
export function isAllowedLicense(expression) {
  if (typeof expression !== 'string' || !expression.trim()) return false;
  const tokens = expression.replace(/[()]/g, ' $& ').split(/\s+/).filter(Boolean);
  let pos = 0;

  const parseAtom = () => {
    const token = tokens[pos++];
    if (token === undefined) return false;
    if (token === '(') {
      const inner = parseOr();
      if (tokens[pos] !== ')') return false;
      pos++;
      return inner;
    }
    if (token === ')' || token === 'AND' || token === 'OR') return false;
    if (tokens[pos] === 'WITH') pos += 2; // l'exception nommée n'ajoute aucune obligation
    const id = token.endsWith('+') ? `${token.slice(0, -1)}-or-later` : token;
    return ALLOWED_LICENSES.has(id);
  };
  const parseAnd = () => {
    let value = parseAtom();
    while (tokens[pos] === 'AND') {
      pos++;
      value = parseAtom() && value;
    }
    return value;
  };
  const parseOr = () => {
    let value = parseAnd();
    while (tokens[pos] === 'OR') {
      pos++;
      value = parseAnd() || value;
    }
    return value;
  };

  const allowed = parseOr();
  return pos === tokens.length && allowed;
}

/**
 * Rejoue la résolution npm : depuis un dossier, un paquet est cherché dans le
 * node_modules local puis en remontant les parents.
 */
export function resolveEntry(packages, from, name) {
  let dir = from;
  for (;;) {
    const key = `${dir ? `${dir}/` : ''}node_modules/${name}`;
    if (packages[key]) return key;
    if (!dir) return null;
    const cut = dir.lastIndexOf('/node_modules/');
    dir = cut < 0 ? '' : dir.slice(0, cut);
  }
}

/**
 * Clés du lockfile constituant l'arbre de production : on part des dependencies du
 * paquet racine et on suit dependencies/optionalDependencies/peerDependencies.
 */
export function productionTree(lock) {
  const packages = lock.packages ?? {};
  const root = packages[''] ?? {};
  const seen = new Set();
  const stack = Object.keys(root.dependencies ?? {})
    .map((name) => resolveEntry(packages, '', name))
    .filter(Boolean);

  while (stack.length) {
    const key = stack.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = packages[key] ?? {};
    const deps = {
      ...entry.dependencies,
      ...entry.optionalDependencies,
      ...entry.peerDependencies,
    };
    for (const name of Object.keys(deps)) {
      const next = resolveEntry(packages, key, name);
      if (next && !seen.has(next)) stack.push(next);
    }
  }
  return [...seen].sort();
}

/** Nom npm d'une clé de lockfile (`node_modules/a/node_modules/b` → `b`). */
export function packageName(key) {
  return key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
}

/** URL de dépôt lisible, quelle que soit la forme du champ `repository`. */
export function repositoryUrl(pkg) {
  const repo = pkg?.repository;
  const raw = typeof repo === 'string' ? repo : repo?.url;
  if (!raw) return null;
  return raw
    .replace(/^git\+/, '')
    .replace(/\.git$/, '')
    .replace(/^git:\/\//, 'https://')
    .replace(/^github:/, 'https://github.com/');
}

/** Expression de licence déclarée, y compris la forme historique `licenses: [...]`. */
export function declaredLicense(pkg) {
  if (typeof pkg?.license === 'string') return pkg.license;
  if (pkg?.license?.type) return pkg.license.type;
  if (Array.isArray(pkg?.licenses)) return pkg.licenses.map((l) => l.type ?? l).join(' OR ');
  return null;
}

/** Lit le texte de licence livré par le paquet, s'il en fournit un. */
async function readLicenseText(dir) {
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return null;
  }
  const names = entries.filter((name) => LICENSE_FILE.test(name)).sort();
  const chunks = [];
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      if (!(await stat(full)).isFile()) continue;
      const text = (await readFile(full, 'utf8')).trim();
      if (text) chunks.push({ name, text });
    } catch {
      /* illisible : on garde au moins l'identifiant SPDX */
    }
  }
  return chunks.length ? chunks : null;
}

/** Collecte les métadonnées d'attribution d'un workspace. */
export async function collectWorkspace(repoRoot, workspace) {
  const lockPath = path.join(repoRoot, workspace.dir, 'package-lock.json');
  const lock = JSON.parse(await readFile(lockPath, 'utf8'));
  const seen = new Map();

  for (const key of productionTree(lock)) {
    const dir = path.join(repoRoot, workspace.dir, key);
    let pkg = {};
    try {
      pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
    } catch {
      /* paquet non installé (binaire optionnel d'une autre plateforme) */
    }
    const name = packageName(key);
    const version = pkg.version ?? lock.packages[key]?.version ?? '?';
    const id = `${name}@${version}`;
    if (seen.has(id)) continue;
    seen.set(id, {
      id,
      name,
      version,
      license: declaredLicense(pkg) ?? lock.packages[key]?.license ?? LICENSE_OVERRIDES[id] ?? 'UNKNOWN',
      repository: repositoryUrl(pkg),
      texts: await readLicenseText(dir),
    });
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Encadre un texte sans risquer de casser le Markdown. */
function fence(text) {
  const ticks = '`'.repeat(Math.max(3, ...(text.match(/`+/g) ?? ['']).map((m) => m.length + 1)));
  return `${ticks}text\n${text}\n${ticks}`;
}

/** Rend le fichier de notices complet. */
export function renderNotices(sections) {
  const all = sections.flatMap((s) => s.packages);
  const counts = new Map();
  for (const p of all) counts.set(p.license, (counts.get(p.license) ?? 0) + 1);

  const out = [
    '# Third-Party Notices',
    '',
    'ReView is distributed under the GNU Affero General Public License v3.0 or later',
    '(see [LICENSE](LICENSE)). It redistributes the third-party components listed below —',
    'in the browser bundle, in the Docker images, or both.',
    '',
    'Their licenses require their copyright and permission notices to be preserved, so each',
    'component appears here with the verbatim license text it ships. Only **production**',
    'dependencies are listed: build-time tooling is never redistributed.',
    '',
    '> Generated by `scripts/generate-notices.mjs`. Do not edit by hand — run the script.',
    '',
    '## Summary',
    '',
    '| License | Packages |',
    '| --- | --- |',
    ...[...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([license, n]) => `| ${license} | ${n} |`),
    `| **Total** | **${all.length}** |`,
    '',
    'Runtime services that ReView talks to over the network (PostgreSQL, Redis, MinIO,',
    'ClamAV, Prometheus, Grafana, nginx) run as separate programs in their own containers.',
    'They are aggregated, not linked, and keep their own licenses. Likewise, the backend',
    'image bundles FFmpeg (GPL-2.0-or-later, Debian build) and — only when built with',
    '`INSTALL_USD_TOOLS=1` — Blender (GPL-2.0-or-later): anyone redistributing that image',
    'must pass on the corresponding source offer for those programs.',
    '',
  ];

  for (const section of sections) {
    out.push(`## ${section.label}`, '', `${section.packages.length} packages.`, '');
    for (const pkg of section.packages) {
      out.push(`### ${pkg.id}`, '');
      out.push(`- License: \`${pkg.license}\``);
      if (pkg.repository) out.push(`- Source: ${pkg.repository}`);
      out.push('');
      if (pkg.texts) {
        for (const chunk of pkg.texts) out.push(fence(chunk.text), '');
      } else {
        out.push(
          `_No license file shipped in the package; the \`${pkg.license}\` declaration in its` +
            ' `package.json` governs._',
          '',
        );
      }
    }
  }
  return `${out.join('\n').trimEnd()}\n`;
}

/** Compare en ignorant les fins de ligne (le dépôt est cloné sous Windows comme sous Linux). */
const normalize = (text) => text.replace(/\r\n/g, '\n');

async function main() {
  const check = process.argv.includes('--check');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const target = path.join(repoRoot, 'THIRD-PARTY-NOTICES.md');

  const sections = [];
  for (const workspace of WORKSPACES) {
    sections.push({ label: workspace.label, packages: await collectWorkspace(repoRoot, workspace) });
  }

  // Garde-fou de compatibilité : une dépendance sous licence non compatible AGPL ne doit
  // pas se contenter d'apparaître dans les notices, elle doit arrêter la validation.
  const rejected = sections
    .flatMap((section) => section.packages)
    .filter((pkg) => !isAllowedLicense(pkg.license));
  if (rejected.length) {
    console.error(`✗ ${rejected.length} dépendance(s) sous licence non compatible AGPL-3.0 :`);
    for (const pkg of rejected) console.error(`  ${pkg.id} — ${pkg.license}`);
    console.error('  → remplacer la dépendance ; si la licence est mal déclarée, vérifier son fichier');
    console.error('    LICENSE puis compléter LICENSE_OVERRIDES ou ALLOWED_LICENSES.');
    process.exit(1);
  }

  const content = renderNotices(sections);

  if (check) {
    let current = '';
    try {
      current = await readFile(target, 'utf8');
    } catch {
      console.error('✗ THIRD-PARTY-NOTICES.md est absent → node scripts/generate-notices.mjs');
      process.exit(1);
    }
    if (normalize(current) !== normalize(content)) {
      console.error('✗ THIRD-PARTY-NOTICES.md est périmé → node scripts/generate-notices.mjs');
      process.exit(1);
    }
    console.log(
      `✓ THIRD-PARTY-NOTICES.md à jour (${sections.reduce((n, s) => n + s.packages.length, 0)} paquets)`,
    );
    return;
  }

  await writeFile(target, content);
  console.log(
    `✓ THIRD-PARTY-NOTICES.md écrit — ${sections.map((s) => `${s.packages.length} ${s.label.split(' ')[0].toLowerCase()}`).join(', ')}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
