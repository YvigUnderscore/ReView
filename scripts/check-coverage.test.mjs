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

/** An entry of `coverage-summary.json` as vitest writes it. */
const entry = (statements, branches) => ({
  statements: { covered: statements[0], total: statements[1] },
  branches: { covered: branches[0], total: branches[1] },
});

describe('check-coverage — attaching a file to its folder', () => {
  it('attaches to the longest declared prefix', () => {
    expect(bucketOf('src/v2/pages/Home.tsx', BUCKETS.frontend)).toBe('src/v2/pages');
    expect(bucketOf('src/lib/apiClient.ts', BUCKETS.frontend)).toBe('src/lib');
    // `src/v2/lib` is more precise than nothing: it must not fall into `src/lib`.
    expect(bucketOf('src/v2/lib/queries.ts', BUCKETS.frontend)).toBe('src/v2/lib');
  });

  it('puts out of bucket whatever falls in no declared folder', () => {
    expect(bucketOf('src/app.ts', BUCKETS.backend)).toBe(OTHER_BUCKET);
    // A prefix only holds on a folder boundary: `src/libraries` is not `src/lib`.
    expect(bucketOf('src/libraries/x.ts', BUCKETS.backend)).toBe(OTHER_BUCKET);
  });

  it('normalises absolute report paths to relative POSIX paths', () => {
    const abs = path.join(ROOT, 'src', 'lib', 'hls.ts');
    expect(relativeToPackage(abs, ROOT)).toBe('src/lib/hls.ts');
  });
});

describe('check-coverage — aggregation', () => {
  it('sums the raw counters: a large file weighs more than a small one', () => {
    const summary = {
      total: entry([0, 0], [0, 0]),
      [path.join(ROOT, 'src/lib/a.ts')]: entry([90, 100], [5, 10]),
      [path.join(ROOT, 'src/lib/b.ts')]: entry([0, 900], [0, 90]),
    };
    const out = aggregate(summary, { packageRoot: ROOT, buckets: BUCKETS.backend });
    // 90 / 1000 = 9 % — and not the average of the percentages (45 %).
    expect(out['src/lib'].statements).toBe(9);
    expect(out['src/lib'].branches).toBe(5);
  });

  it('a folder without statements is covered: there is nothing to cover', () => {
    expect(percentage(0, 0)).toBe(100);
    expect(percentage(1, 3)).toBe(33.3);
  });

  it('ignores the "total" line of the report', () => {
    const summary = { total: entry([1000, 1000], [1000, 1000]) };
    expect(aggregate(summary, { packageRoot: ROOT, buckets: BUCKETS.backend })).toEqual({});
  });
});

describe('check-coverage — ratchet', () => {
  const measured = { 'src/lib': { statements: 80, branches: 70 } };

  it('fails as soon as a metric drops below its floor', () => {
    const floors = { 'src/lib': { statements: 85, branches: 70 } };
    const { below } = compare(measured, floors);
    expect(below).toEqual([{ bucket: 'src/lib', metric: 'statements', value: 80, floor: 85 }]);
  });

  it('reports without blocking a folder whose floor was never set', () => {
    const { below, unmeasured } = compare(measured, {});
    expect(below).toEqual([]);
    expect(unmeasured.map((u) => u.metric)).toEqual(METRICS);
  });

  it('reports the folders far enough above for the floor to rise', () => {
    const { raised } = compare(measured, { 'src/lib': { statements: 60, branches: 70 } });
    expect(raised).toEqual([{ bucket: 'src/lib', metric: 'statements', value: 80, floor: 60 }]);
  });

  it('--update raises the floors and refuses to lower them', () => {
    const floors = { 'src/lib': { statements: 85, branches: 10 } };
    expect(ratchet(measured, floors)).toEqual({
      // 85 was already reached: the measured 80 does not bring it back down.
      'src/lib': { statements: 85, branches: 70 },
    });
  });

  it('--update keeps the floor of a folder absent from the report', () => {
    const floors = { 'src/workers': { statements: 40, branches: 30 } };
    expect(ratchet(measured, floors)['src/workers']).toEqual({ statements: 40, branches: 30 });
  });
});

describe('coverage-floors.json', () => {
  const file = JSON.parse(readFileSync(path.join(here, 'coverage-floors.json'), 'utf8'));

  it('declares one block per measured package', () => {
    for (const pkg of Object.keys(BUCKETS)) expect(file[pkg]).toBeDefined();
  });

  it('every floor set is a percentage', () => {
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
