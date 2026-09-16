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
 *
 * **Limite fermée en F-lot8.** Parcourir l'arbre du lockfile ne voit que ce qui est
 * *déclaré*. Un paquet qui recopie le code d'un tiers dans son propre build (mermaid
 * embarque js-yaml 4.1.1, Prisma embarque execa, glob, fs-extra…) échappait complètement
 * au générateur : ce code partait en production sans notice. `collectVendored` le repère
 * désormais aux marqueurs que les bundlers laissent (`nom@version/node_modules/nom/…`) et
 * le fichier produit le dit — y compris quand la licence n'a pas pu être établie.
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
      // Fins de ligne normalisées en LF : plusieurs paquets livrent leur LICENSE en CRLF
      // (color-name, fluent-ffmpeg, tslib…). Sans cette normalisation, le fichier produit
      // contient des CR que git retire au commit (`.gitattributes` : `text eol=lf`), et la
      // comparaison de fraîcheur de validate.sh ne peut jamais réussir en CI.
      const text = (await readFile(full, 'utf8')).replace(/\r\n/g, '\n').trim();
      if (text) chunks.push({ name, text });
    } catch {
      /* illisible : on garde au moins l'identifiant SPDX */
    }
  }
  return chunks.length ? chunks : null;
}

/** Collecte les métadonnées d'attribution d'un workspace. */
export async function collectWorkspace(repoRoot, workspace, lock, tree) {
  if (!lock) {
    const lockPath = path.join(repoRoot, workspace.dir, 'package-lock.json');
    lock = JSON.parse(await readFile(lockPath, 'utf8'));
  }
  const seen = new Map();

  for (const key of tree ?? productionTree(lock)) {
    const dir = path.join(repoRoot, workspace.dir, key);
    /*
     * Binaire natif restreint à une plateforme : on ne lit rien de `node_modules`.
     *
     * npm n'installe que la variante de la machine courante — `@esbuild/win32-x64` ici,
     * `@esbuild/linux-x64` sur le runner. Le générateur trouvait donc le `package.json` de
     * l'une et pas des autres, et n'écrivait le champ « Source » que pour celle-là : le
     * fichier produit dépendait de l'OS de build, et la comparaison de fraîcheur de
     * `validate.sh` ne pouvait pas réussir des deux côtés à la fois. C'est ce qui faisait
     * échouer toutes les exécutions de la CI, sur une seule ligne de différence
     * (`@msgpackr-extract/msgpackr-extract-*`).
     *
     * Le lockfile, lui, décrit les 53 à 59 variantes à l'identique partout : nom, version
     * et licence suffisent à l'attribution, et la sortie redevient déterministe.
     */
    const locked = lock.packages[key] ?? {};
    const platformSpecific = Array.isArray(locked.os) || Array.isArray(locked.cpu);
    let pkg = {};
    if (!platformSpecific) {
      try {
        pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
      } catch {
        /* paquet non installé : on se contente de ce que dit le lockfile */
      }
    }
    const name = packageName(key);
    const version = pkg.version ?? locked.version ?? '?';
    const id = `${name}@${version}`;
    if (seen.has(id)) continue;
    seen.set(id, {
      id,
      name,
      version,
      license: declaredLicense(pkg) ?? locked.license ?? LICENSE_OVERRIDES[id] ?? 'UNKNOWN',
      repository: repositoryUrl(pkg),
      // Même raison que ci-dessus : le texte de licence n'existe sur disque que pour la
      // variante installée. Le lire rendrait la sortie dépendante de la plateforme.
      texts: platformSpecific ? null : await readLicenseText(dir),
    });
  }
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/* ------------------------------------------------------------------------------------ *
 * Code tiers recopié à l'intérieur d'un paquet (« vendored »)
 * ------------------------------------------------------------------------------------ */

/**
 * Licences de copies internes vérifiées à la main, quand ni l'une ni l'autre des deux
 * heuristiques ci-dessous ne tranche. Même contrat que `LICENSE_OVERRIDES` : on n'y inscrit
 * que ce qu'on a réellement lu dans le dépôt du projet concerné.
 */
export const VENDORED_LICENSES = {};

/** Fichiers susceptibles de contenir du code empaqueté (pas les `.map`, jamais livrées). */
const SHIPPED_CODE = /\.(m|c)?js$/;

/** Prédécoupage rapide : inutile de décoder un fichier qui ne cite aucun `node_modules`. */
const NODE_MODULES = Buffer.from('/node_modules/');

/**
 * Marqueur de module empaqueté laissé par esbuild/rollup quand le paquet a été construit
 * avec pnpm : `.pnpm/js-yaml@4.1.1/node_modules/js-yaml/dist/js-yaml.mjs`. Le suffixe
 * `_peer@x` des installations à pairs est toléré. pnpm encode `@scope/nom` en
 * `@scope+nom` côté magasin : les deux graphies doivent donc désigner le même paquet.
 */
const VENDORED_MARKER = /(@?[\w.+-]+)@(\d[\w.+-]*)(?:_[^/]*)?\/node_modules\/((?:@[\w.-]+\/)?[\w.-]+)\//g;

/**
 * Identifiants `nom@version` du code tiers recopié dans un texte source.
 *
 * Volontairement restreint aux marqueurs **versionnés** : un commentaire de bundler sans
 * version (`../node_modules/foo/index.js`) ne permet ni d'attribuer une licence ni de
 * distinguer une copie d'un simple chemin cité. Mieux vaut ne pas prétendre le voir.
 */
export function vendoredIdsFrom(text) {
  const out = new Set();
  for (const [, outer, version, inner] of text.matchAll(VENDORED_MARKER)) {
    if (inner !== outer && inner !== outer.replace('+', '/')) continue;
    out.add(`${inner}@${version}`);
  }
  return out;
}

/** Parcourt un paquet installé sans descendre dans ses `node_modules` imbriqués. */
async function* shippedFiles(dir) {
  const stack = [dir];
  while (stack.length) {
    let entries;
    const cur = stack.pop();
    try {
      entries = await readdir(cur, { withFileTypes: true });
    } catch {
      continue; // paquet non installé : rien à scanner
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue;
      const full = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (SHIPPED_CODE.test(entry.name)) yield full;
    }
  }
}

/**
 * Copies internes trouvées dans l'arbre de production d'un workspace : `id` → paquets
 * hôtes. Une copie déjà présente dans l'arbre sous la même version est ignorée — elle a
 * déjà sa notice. C'est bien la **version** qui compte : le lockfile du frontend porte
 * js-yaml 4.3.1 (via eslint, donc jamais distribué) quand mermaid en recopie 4.1.1.
 */
export async function collectVendored(repoRoot, workspace, lock, tree) {
  const shipped = new Set(tree.map((k) => `${packageName(k)}@${lock.packages[k]?.version ?? '?'}`));
  const found = new Map();
  for (const key of tree) {
    const locked = lock.packages[key] ?? {};
    // Même raison qu'au-dessus : un binaire natif n'est installé que pour la plateforme
    // courante. Le scanner rendrait un résultat différent sous Windows et sous Linux.
    if (Array.isArray(locked.os) || Array.isArray(locked.cpu)) continue;
    const host = packageName(key);
    for await (const file of shippedFiles(path.join(repoRoot, workspace.dir, key))) {
      let buffer;
      try {
        buffer = await readFile(file);
      } catch {
        continue;
      }
      if (!buffer.includes(NODE_MODULES)) continue;
      for (const id of vendoredIdsFrom(buffer.toString('latin1'))) {
        if (shipped.has(id) || id === `${host}@${locked.version}`) continue;
        if (!found.has(id)) found.set(id, new Set());
        found.get(id).add(host);
      }
    }
  }
  return found;
}

/** Index licence des deux lockfiles, dev comprises : une copie interne peut venir de n'importe où. */
export function lockLicenseIndex(locks) {
  const byId = new Map();
  const byName = new Map();
  for (const lock of locks) {
    for (const [key, entry] of Object.entries(lock.packages ?? {})) {
      if (!key.includes('node_modules/') || !entry.version || !entry.license) continue;
      const name = packageName(key);
      byId.set(`${name}@${entry.version}`, entry.license);
      if (!byName.has(name)) byName.set(name, new Set());
      byName.get(name).add(entry.license);
    }
  }
  return { byId, byName };
}

/**
 * Licence d'une copie interne, et sur quoi elle repose — c'est cette seconde information
 * qui rend le signalement honnête : une licence lue sur *une autre version* du même paquet
 * est une présomption, pas une vérification.
 */
export function vendoredLicense(id, index) {
  const name = id.slice(0, id.lastIndexOf('@'));
  if (VENDORED_LICENSES[id]) return { license: VENDORED_LICENSES[id], basis: 'verified by hand' };
  if (index.byId.has(id)) return { license: index.byId.get(id), basis: 'same version in a lockfile' };
  const versions = index.byName.get(name);
  if (versions?.size === 1) {
    return { license: [...versions][0], basis: 'other versions of the package, all agreeing' };
  }
  return { license: null, basis: 'not determined' };
}

/** Assemble la liste triée des copies internes d'un workspace, licence comprise. */
export function describeVendored(found, index, workspaceLabel) {
  return [...found.entries()]
    .map(([id, hosts]) => ({
      id,
      workspace: workspaceLabel,
      hosts: [...hosts].sort(),
      ...vendoredLicense(id, index),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Encadre un texte sans risquer de casser le Markdown. */
function fence(text) {
  const ticks = '`'.repeat(Math.max(3, ...(text.match(/`+/g) ?? ['']).map((m) => m.length + 1)));
  return `${ticks}text\n${text}\n${ticks}`;
}

/**
 * Chapitre des copies internes. Rédigé pour dire deux choses : ce que le scan a trouvé,
 * et ce qu'il ne peut pas voir. Une liste qui se présenterait comme exhaustive sans l'être
 * serait pire que pas de liste du tout.
 */
export function renderVendored(vendored) {
  if (!vendored.length) return [];
  const unknown = vendored.filter((v) => !v.license).length;
  return [
    '## Vendored third-party code',
    '',
    'Some packages ship a copy of another project inside their own build output instead of',
    'depending on it. Those copies are redistributed with ReView, but they appear in no',
    'lockfile, so the lists above cannot see them: mermaid inlines js-yaml, Prisma inlines',
    'execa, glob and fs-extra, and none of them was named here before.',
    '',
    'They are recovered from the build markers bundlers leave behind',
    '(`name@version/node_modules/name/…`) and listed for attribution.',
    '',
    '> **This list is a best effort, not a proof of completeness.** Only markers that carry a',
    '> version can be attributed; a copy inlined without one stays invisible to the scan, and',
    '> no verbatim license text is available for these copies since they are not installed as',
    '> packages. Please report anything you find missing.',
    '',
    `${vendored.length} copies, ${unknown} of which with no license established.`,
    '',
    '| Component | Copied inside | License | Determined from |',
    '| --- | --- | --- | --- |',
    ...vendored.map(
      (v) =>
        `| \`${v.id}\` | ${v.hosts.map((h) => `\`${h}\``).join(', ')} (${v.workspace}) |` +
        ` ${v.license ? `\`${v.license}\`` : '**unverified**'} | ${v.basis} |`,
    ),
    '',
  ];
}

/** Rend le fichier de notices complet. */
export function renderNotices(sections, vendored = []) {
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
  out.push(...renderVendored(vendored));
  return `${out.join('\n').trimEnd()}\n`;
}

/** Compare en ignorant les fins de ligne (le dépôt est cloné sous Windows comme sous Linux). */
const normalize = (text) => text.replace(/\r\n/g, '\n');

async function main() {
  const check = process.argv.includes('--check');
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const target = path.join(repoRoot, 'THIRD-PARTY-NOTICES.md');

  const sections = [];
  const locks = [];
  const trees = [];
  for (const workspace of WORKSPACES) {
    const lock = JSON.parse(await readFile(path.join(repoRoot, workspace.dir, 'package-lock.json'), 'utf8'));
    const tree = productionTree(lock);
    locks.push(lock);
    trees.push(tree);
    sections.push({
      label: workspace.label,
      packages: await collectWorkspace(repoRoot, workspace, lock, tree),
    });
  }

  // Code tiers recopié dans un paquet : invisible du lockfile, donc du reste de ce script.
  const index = lockLicenseIndex(locks);
  const vendored = [];
  for (const [i, workspace] of WORKSPACES.entries()) {
    const found = await collectVendored(repoRoot, workspace, locks[i], trees[i]);
    vendored.push(...describeVendored(found, index, workspace.dir));
  }
  vendored.sort((a, b) => a.id.localeCompare(b.id) || a.workspace.localeCompare(b.workspace));

  // Garde-fou de compatibilité : une dépendance sous licence non compatible AGPL ne doit
  // pas se contenter d'apparaître dans les notices, elle doit arrêter la validation. Une
  // copie interne dont la licence est établie y est soumise au même titre ; celle dont la
  // licence reste indéterminée est signalée dans le fichier, pas transformée en blocage
  // sur une présomption.
  const rejected = [
    ...sections.flatMap((section) => section.packages),
    ...vendored.filter((v) => v.license),
  ].filter((pkg) => !isAllowedLicense(pkg.license));
  if (rejected.length) {
    console.error(`✗ ${rejected.length} dépendance(s) sous licence non compatible AGPL-3.0 :`);
    for (const pkg of rejected) console.error(`  ${pkg.id} — ${pkg.license}`);
    console.error('  → remplacer la dépendance ; si la licence est mal déclarée, vérifier son fichier');
    console.error('    LICENSE puis compléter LICENSE_OVERRIDES ou ALLOWED_LICENSES.');
    process.exit(1);
  }

  const content = renderNotices(sections, vendored);
  const unverified = vendored.filter((v) => !v.license).length;
  if (unverified) {
    console.warn(
      `! ${unverified} copie(s) interne(s) sans licence établie — listées « unverified » dans` +
        ' THIRD-PARTY-NOTICES.md ; les vérifier une à une et compléter VENDORED_LICENSES.',
    );
  }

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
      `✓ THIRD-PARTY-NOTICES.md à jour (${sections.reduce((n, s) => n + s.packages.length, 0)} paquets,` +
        ` ${vendored.length} copies internes)`,
    );
    return;
  }

  await writeFile(target, content);
  console.log(
    `✓ THIRD-PARTY-NOTICES.md écrit — ${sections.map((s) => `${s.packages.length} ${s.label.split(' ')[0].toLowerCase()}`).join(', ')},` +
      ` ${vendored.length} copies internes`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
