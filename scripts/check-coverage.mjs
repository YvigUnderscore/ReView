// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Test coverage — per-folder floors, with a ratchet.
 *
 * The suite knew everything about the *shape* of the code and nothing about what it did not run: no
 * coverage provider was installed, so there was no figure. The gap was not the measurement itself but
 * its lack of consequence — a service could land without a test and nothing would stop it.
 *
 * The mechanism is the one that already brought `check-untranslated` down to zero: a floor written in
 * a git-tracked file, a comparison on every validation, and only one direction allowed. `--update`
 * raises the floors reached; it **refuses** to lower them. Going down therefore requires a manual
 * change, visible in review.
 *
 * The floors are per folder because a global figure can be inflated by the easy files: `lib/` is pure
 * computation and must be very well covered, `routes/` goes through the database and is much less so.
 * A single threshold would average them out until it meant nothing.
 *
 * Usage:
 *   node scripts/check-coverage.mjs backend            # check
 *   node scripts/check-coverage.mjs backend --update   # raises the floors reached
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FLOORS_FILE = path.join(repoRoot, 'scripts/coverage-floors.json');

/** The two tracked metrics. The rest (functions, lines) follows one or the other. */
export const METRICS = ['statements', 'branches'];

/**
 * Measured folders, per package. A file counts for the **longest prefix** that contains it; those
 * that fall in no folder are grouped under `autres`.
 */
export const BUCKETS = {
  backend: ['src/lib', 'src/middleware', 'src/services', 'src/routes', 'src/workers'],
  frontend: ['src/lib', 'src/v2/lib', 'src/v2/stores', 'src/v2/hooks', 'src/v2/components', 'src/v2/pages'],
};

/** Fallback folder for files outside the declared buckets. */
export const OTHER_BUCKET = 'autres';

/** Path relative to the package, with POSIX separators — the report key is absolute. */
export function relativeToPackage(absolutePath, packageRoot) {
  return path.relative(packageRoot, absolutePath).split(path.sep).join('/');
}

/** Bucket of a file: the longest declared prefix that contains it. */
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
 * Aggregates a `coverage-summary.json` per folder.
 *
 * Raw counters (covered / total) are summed rather than averaging percentages: a ten-line file must
 * not weigh as much as a thousand-line service.
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

/** A folder without a single statement is 100% covered: there is nothing to cover. */
export function percentage(covered, total) {
  if (total === 0) return 100;
  return Math.floor((covered / total) * 1000) / 10;
}

/**
 * Compares the measured figures against the floors.
 *
 * Three outcomes per folder: `below` (red), `unmeasured` (floor never set, announced without
 * blocking) and `raised` (the measured figure exceeds the floor — enough to raise it).
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

/** New floors: the maximum of the known floor and the measured figure. Never less. */
export function ratchet(measured, floors) {
  const next = {};
  for (const [bucket, metrics] of Object.entries(measured)) {
    next[bucket] = {};
    for (const metric of METRICS) {
      const current = floors?.[bucket]?.[metric];
      next[bucket][metric] = current == null ? metrics[metric] : Math.max(current, metrics[metric]);
    }
  }
  // A folder that disappeared from the report keeps its floor: it will come back, or be removed by hand.
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
