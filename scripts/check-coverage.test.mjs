// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  aggregate,
  bucketOf,
  BUCKETS,
  compare,
  METRICS,
  OTHER_BUCKET,
  percentage,
  ratchet,
  relativeToPackage,
} from './check-coverage.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', 'backend');

/** Une entrée de `coverage-summary.json` telle que vitest l'écrit. */
const entry = (statements, branches) => ({
  statements: { covered: statements[0], total: statements[1] },
  branches: { covered: branches[0], total: branches[1] },
});

describe('check-coverage — rattachement d’un fichier à son dossier', () => {
  it('rattache au préfixe déclaré le plus long', () => {
    expect(bucketOf('src/v2/pages/Home.tsx', BUCKETS.frontend)).toBe('src/v2/pages');
    expect(bucketOf('src/lib/apiClient.ts', BUCKETS.frontend)).toBe('src/lib');
    // `src/v2/lib` est plus précis que rien : il ne doit pas tomber dans `src/lib`.
    expect(bucketOf('src/v2/lib/queries.ts', BUCKETS.frontend)).toBe('src/v2/lib');
  });

  it('range hors seau ce qui ne tombe dans aucun dossier déclaré', () => {
    expect(bucketOf('src/app.ts', BUCKETS.backend)).toBe(OTHER_BUCKET);
    // Un préfixe ne vaut que sur une frontière de dossier : `src/libraries` n'est pas `src/lib`.
    expect(bucketOf('src/libraries/x.ts', BUCKETS.backend)).toBe(OTHER_BUCKET);
  });

  it('normalise les chemins absolus du rapport en chemins relatifs POSIX', () => {
    const abs = path.join(ROOT, 'src', 'lib', 'hls.ts');
    expect(relativeToPackage(abs, ROOT)).toBe('src/lib/hls.ts');
  });
});

describe('check-coverage — agrégation', () => {
  it('additionne les compteurs bruts : un gros fichier pèse plus qu’un petit', () => {
    const summary = {
      total: entry([0, 0], [0, 0]),
      [path.join(ROOT, 'src/lib/a.ts')]: entry([90, 100], [5, 10]),
      [path.join(ROOT, 'src/lib/b.ts')]: entry([0, 900], [0, 90]),
    };
    const out = aggregate(summary, { packageRoot: ROOT, buckets: BUCKETS.backend });
    // 90 / 1000 = 9 % — et non la moyenne des pourcentages (45 %).
    expect(out['src/lib'].statements).toBe(9);
    expect(out['src/lib'].branches).toBe(5);
  });

  it('un dossier sans instruction est couvert : il n’y a rien à couvrir', () => {
    expect(percentage(0, 0)).toBe(100);
    expect(percentage(1, 3)).toBe(33.3);
  });

  it('ignore la ligne « total » du rapport', () => {
    const summary = { total: entry([1000, 1000], [1000, 1000]) };
    expect(aggregate(summary, { packageRoot: ROOT, buckets: BUCKETS.backend })).toEqual({});
  });
});

describe('check-coverage — cliquet', () => {
  const measured = { 'src/lib': { statements: 80, branches: 70 } };

  it('échoue dès qu’une métrique passe sous son plancher', () => {
    const floors = { 'src/lib': { statements: 85, branches: 70 } };
    const { below } = compare(measured, floors);
    expect(below).toEqual([{ bucket: 'src/lib', metric: 'statements', value: 80, floor: 85 }]);
  });

  it('signale sans bloquer un dossier dont le plancher n’a jamais été posé', () => {
    const { below, unmeasured } = compare(measured, {});
    expect(below).toEqual([]);
    expect(unmeasured.map((u) => u.metric)).toEqual(METRICS);
  });

  it('signale les dossiers assez au-dessus pour que le plancher monte', () => {
    const { raised } = compare(measured, { 'src/lib': { statements: 60, branches: 70 } });
    expect(raised).toEqual([{ bucket: 'src/lib', metric: 'statements', value: 80, floor: 60 }]);
  });

  it('--update relève les planchers et refuse de les baisser', () => {
    const floors = { 'src/lib': { statements: 85, branches: 10 } };
    expect(ratchet(measured, floors)).toEqual({
      // 85 était acquis : le mesuré à 80 ne le fait pas redescendre.
      'src/lib': { statements: 85, branches: 70 },
    });
  });

  it('--update conserve le plancher d’un dossier absent du rapport', () => {
    const floors = { 'src/workers': { statements: 40, branches: 30 } };
    expect(ratchet(measured, floors)['src/workers']).toEqual({ statements: 40, branches: 30 });
  });
});

describe('coverage-floors.json', () => {
  const file = JSON.parse(readFileSync(path.join(here, 'coverage-floors.json'), 'utf8'));

  it('déclare un bloc par paquet mesuré', () => {
    for (const pkg of Object.keys(BUCKETS)) expect(file[pkg]).toBeDefined();
  });

  it('tout plancher posé est un pourcentage', () => {
    for (const pkg of Object.keys(BUCKETS)) {
      for (const metrics of Object.values(file[pkg])) {
        for (const metric of METRICS) {
          const value = metrics[metric];
          expect(typeof value).toBe('number');
          expect(value).toBeGreaterThanOrEqual(0);
          expect(value).toBeLessThanOrEqual(100);
        }
      }
    }
  });
});
