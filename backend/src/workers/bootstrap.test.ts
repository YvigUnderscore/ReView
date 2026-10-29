// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Static check: every starter declared in `workers/` is actually called at the bootstrap of the worker process.
 *
 * Two queues ran empty in production — `spatial-thumb` and the OCIO baking: their `start…Worker()` existed, was exported, and covered by a unit test... but was called nowhere.
 * A pure-function test does not prove the wiring; this one does.
 *
 * It reads the source rather than importing the modules: importing a worker would open a Redis connection, which a unit test must not do.
 */

const WORKERS_DIR = path.join(__dirname);
const BOOTSTRAP = path.join(WORKERS_DIR, 'ffmpeg.worker.ts');

/**
 * Pattern of a starter declaration.
 *
 * It required "Worker" right before the parenthesis. `startWorkerMetricsServer` — the collection point that Prometheus scrapes on `worker:9101` — carries the word in the
 * middle of its name: it therefore passed through the check, exported, documented, covered by its own unit test... and called nowhere, so the three Grafana panels of the worker
 * have been empty since their creation. A check that misses the very case it exists to catch is worse than no check: "Server" now counts as much as "Worker".
 */
const STARTER_DECLARATION = /export function (start\w*(?:Worker|Server))\s*\(/g;

/** All the `.ts` files of `workers/`, subfolders included, excluding tests. */
function workerSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...workerSources(full));
    else if (name.endsWith('.ts') && !name.includes('.test.')) out.push(full);
  }
  return out;
}

describe('worker process bootstrap', () => {
  const bootstrap = readFileSync(BOOTSTRAP, 'utf8');

  const declared = workerSources(WORKERS_DIR).flatMap((file) => {
    const src = readFileSync(file, 'utf8');
    return [...src.matchAll(STARTER_DECLARATION)].flatMap((m) =>
      m[1] ? [{ name: m[1], file: path.relative(WORKERS_DIR, file).replace(/\\/g, '/') }] : [],
    );
  });

  it('declares at least the seven known consumers and the collection point', () => {
    expect(declared.length).toBeGreaterThanOrEqual(8);
  });

  for (const { name, file } of declared) {
    it(`${name} (${file}) is called by ffmpeg.worker.ts`, () => {
      // A real call, not a mere mention in a comment.
      expect(
        bootstrap,
        `${name} est exporté mais jamais démarré — ajouter un appel \`${name}(…);\` dans le bloc \`require.main === module\` de ffmpeg.worker.ts`,
      ).toMatch(new RegExp(`^\\s*${name}\\(`, 'm'));
    });
  }
});
