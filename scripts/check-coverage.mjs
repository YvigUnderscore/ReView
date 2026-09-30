// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Couverture de test — planchers par dossier, à cliquet.
 *
 * La suite savait tout de la *forme* du code et rien de ce qu'elle n'exécutait pas : aucun
 * provider de couverture n'était installé, donc aucun chiffre. Le manque n'était pas la
 * mesure elle-même mais son absence de conséquence — un service pouvait arriver sans un
 * test sans que rien ne l'empêche.
 *
 * Le dispositif est celui qui a déjà fait tomber `check-untranslated` à zéro : un plancher
 * écrit dans un fichier suivi par git, une comparaison à chaque validation, et une seule
 * direction autorisée. `--update` relève les planchers atteints ; il **refuse** de les
 * baisser. Descendre exige donc une modification manuelle, visible en revue.
 *
 * Les planchers sont par dossier parce qu'un chiffre global se laisse gonfler par les
 * fichiers faciles : `lib/` est du calcul pur et doit être très couvert, `routes/` traverse
 * la base et l'est beaucoup moins. Un seuil unique les moyennerait jusqu'à ne plus rien dire.
 *
 * Usage :
 *   node scripts/check-coverage.mjs backend            # contrôle
 *   node scripts/check-coverage.mjs backend --update   # relève les planchers atteints
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLOORS_FILE = path.join(repoRoot, 'scripts/coverage-floors.json');

/** Les deux métriques suivies. Le reste (functions, lines) suit l'une ou l'autre. */
export const METRICS = ['statements', 'branches'];

/**
 * Dossiers mesurés, par paquet. Un fichier compte pour le **préfixe le plus long** qui le
 * contient ; ceux qui ne tombent dans aucun dossier sont regroupés sous `autres`.
 */
export const BUCKETS = {
  backend: ['src/lib', 'src/middleware', 'src/services', 'src/routes', 'src/workers'],
  frontend: ['src/lib', 'src/stores', 'src/v2/lib', 'src/v2/hooks', 'src/v2/components', 'src/v2/pages'],
};

/** Dossier de repli des fichiers hors des seaux déclarés. */
export const OTHER_BUCKET = 'autres';

/** Chemin relatif au paquet, en séparateurs POSIX — la clé du rapport est absolue. */
export function relativeToPackage(absolutePath, packageRoot) {
  return path.relative(packageRoot, absolutePath).split(path.sep).join('/');
}

/** Seau d'un fichier : le préfixe déclaré le plus long qui le contient. */
export function bucketOf(relativePath, buckets) {
  let best = null;
  for (const bucket of buckets) {
    if (relativePath === bucket || relativePath.startsWith(`${bucket}/`)) {
      if (best === null || bucket.length > best.length) best = bucket;
    }
  }
  return best ?? OTHER_BUCKET;
}

/**
 * Agrège un `coverage-summary.json` par dossier.
 *
 * On additionne les compteurs bruts (couvert / total) plutôt que de moyenner des
 * pourcentages : un fichier de dix lignes ne doit pas peser autant qu'un service de mille.
 */
export function aggregate(summary, { packageRoot, buckets }) {
  const totals = {};
  for (const [file, data] of Object.entries(summary)) {
    if (file === 'total') continue;
    const bucket = bucketOf(relativeToPackage(file, packageRoot), buckets);
    totals[bucket] ??= Object.fromEntries(METRICS.map((m) => [m, { covered: 0, total: 0 }]));
    for (const metric of METRICS) {
      const entry = data[metric];
      if (!entry) continue;
      totals[bucket][metric].covered += entry.covered ?? 0;
      totals[bucket][metric].total += entry.total ?? 0;
    }
  }
  const out = {};
  for (const [bucket, metrics] of Object.entries(totals)) {
    out[bucket] = Object.fromEntries(
      METRICS.map((m) => [m, percentage(metrics[m].covered, metrics[m].total)]),
    );
  }
  return out;
}

/** Un dossier sans une seule instruction est couvert à 100 % : il n'y a rien à couvrir. */
export function percentage(covered, total) {
  if (total === 0) return 100;
  return Math.floor((covered / total) * 1000) / 10;
}

/**
 * Confronte le mesuré aux planchers.
 *
 * Trois issues par dossier : `below` (rouge), `unmeasured` (plancher jamais posé, on
 * l'annonce sans bloquer) et `raised` (le mesuré dépasse le plancher — de quoi le relever).
 */
export function compare(measured, floors, { slack = 2 } = {}) {
  const below = [];
  const unmeasured = [];
  const raised = [];
  for (const [bucket, metrics] of Object.entries(measured)) {
    for (const metric of METRICS) {
      const floor = floors?.[bucket]?.[metric];
      const value = metrics[metric];
      if (floor === undefined || floor === null) {
        unmeasured.push({ bucket, metric, value });
      } else if (value < floor) {
        below.push({ bucket, metric, value, floor });
      } else if (value >= floor + slack) {
        raised.push({ bucket, metric, value, floor });
      }
    }
  }
  return { below, unmeasured, raised };
}

/** Nouveaux planchers : le maximum du plancher connu et du mesuré. Jamais moins. */
export function ratchet(measured, floors) {
  const next = {};
  for (const [bucket, metrics] of Object.entries(measured)) {
    next[bucket] = {};
    for (const metric of METRICS) {
      const current = floors?.[bucket]?.[metric];
      next[bucket][metric] = current == null ? metrics[metric] : Math.max(current, metrics[metric]);
    }
  }
  // Un dossier disparu du rapport garde son plancher : il reviendra, ou sera retiré à la main.
  for (const [bucket, metrics] of Object.entries(floors ?? {})) {
    next[bucket] ??= metrics;
  }
  return next;
}

function readFloors() {
  if (!existsSync(FLOORS_FILE)) return {};
  return JSON.parse(readFileSync(FLOORS_FILE, 'utf8'));
}

function main() {
  const [pkg, ...flags] = process.argv.slice(2);
  const update = flags.includes('--update');
  if (!pkg || !BUCKETS[pkg]) {
    console.error(`Usage : node scripts/check-coverage.mjs <${Object.keys(BUCKETS).join('|')}> [--update]`);
    process.exit(1);
  }

  const packageRoot = path.join(repoRoot, pkg);
  const summaryFile = path.join(packageRoot, 'coverage/coverage-summary.json');
  if (!existsSync(summaryFile)) {
    console.error(
      `\x1b[0;31m✗ ${pkg} : rapport de couverture absent (${path.relative(repoRoot, summaryFile)})\x1b[0m`,
    );
    console.error(`  → lancer « npx vitest run --coverage » dans ${pkg}/ (provider @vitest/coverage-v8).`);
    process.exit(1);
  }

  const measured = aggregate(JSON.parse(readFileSync(summaryFile, 'utf8')), {
    packageRoot,
    buckets: BUCKETS[pkg],
  });
  const all = readFloors();
  const floors = all[pkg] ?? {};

  if (update) {
    all[pkg] = ratchet(measured, floors);
    writeFileSync(FLOORS_FILE, `${JSON.stringify(all, null, 2)}\n`, 'utf8');
    console.log(
      `\x1b[0;32m✓ ${pkg} : planchers de couverture relevés dans scripts/coverage-floors.json\x1b[0m`,
    );
    for (const [bucket, metrics] of Object.entries(all[pkg])) {
      console.log(`    ${bucket.padEnd(20)} ${METRICS.map((m) => `${m} ${metrics[m]}%`).join('  ')}`);
    }
    return;
  }

  const { below, unmeasured, raised } = compare(measured, floors);

  if (below.length > 0) {
    console.error(`\x1b[0;31m✗ ${pkg} : la couverture a baissé sous son plancher\x1b[0m`);
    for (const b of below) {
      console.error(`    ${b.bucket.padEnd(20)} ${b.metric} ${b.value}% < ${b.floor}%`);
    }
    console.error('  → couvrir le code ajouté. Le plancher ne se baisse pas pour faire passer la suite.');
    process.exit(1);
  }

  for (const u of unmeasured) {
    console.log(`\x1b[0;33m⏭  ${pkg}/${u.bucket} : ${u.metric} ${u.value}%, aucun plancher posé\x1b[0m`);
  }
  if (unmeasured.length > 0) {
    console.log('  → « node scripts/check-coverage.mjs ' + pkg + ' --update » arme le cliquet.');
  }
  for (const r of raised) {
    console.log(
      `\x1b[0;36m↑  ${pkg}/${r.bucket} : ${r.metric} ${r.value}% (plancher ${r.floor}%) — à relever\x1b[0m`,
    );
  }
  const measuredCount = Object.keys(measured).length - unmeasured.length / METRICS.length;
  console.log(`\x1b[0;32m✓ ${pkg} : couverture au-dessus des planchers (${measuredCount} dossier(s))\x1b[0m`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
