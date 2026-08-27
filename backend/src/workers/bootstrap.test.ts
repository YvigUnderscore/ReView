// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * Contrôle statique : chaque consommateur de file déclaré est effectivement démarré.
 *
 * Deux files tournaient à vide en production — `spatial-thumb` et la cuisson OCIO : leur
 * `start…Worker()` existait, était exporté, et couvert par un test unitaire… mais n'était
 * appelé nulle part. Un test de fonction pure ne prouve pas le branchement ; celui-ci si.
 *
 * Il lit le source plutôt que d'importer les modules : importer un worker ouvrirait une
 * connexion Redis, ce qu'un test unitaire ne doit pas faire.
 */

const WORKERS_DIR = path.join(__dirname);
const BOOTSTRAP = path.join(WORKERS_DIR, 'ffmpeg.worker.ts');

/** Tous les `.ts` de `workers/`, sous-dossiers compris, hors tests. */
function workerSources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...workerSources(full));
    else if (name.endsWith('.ts') && !name.includes('.test.')) out.push(full);
  }
  return out;
}

describe('bootstrap du process worker', () => {
  const bootstrap = readFileSync(BOOTSTRAP, 'utf8');

  const declared = workerSources(WORKERS_DIR).flatMap((file) => {
    const src = readFileSync(file, 'utf8');
    return [...src.matchAll(/export function (start\w*Worker)\s*\(/g)].flatMap((m) =>
      m[1] ? [{ name: m[1], file: path.relative(WORKERS_DIR, file).replace(/\\/g, '/') }] : [],
    );
  });

  it('déclare au moins les sept consommateurs connus', () => {
    expect(declared.length).toBeGreaterThanOrEqual(7);
  });

  for (const { name, file } of declared) {
    it(`${name} (${file}) est appelé par ffmpeg.worker.ts`, () => {
      // Appel réel, pas une simple mention en commentaire.
      expect(bootstrap, `${name} est exporté mais jamais démarré`).toMatch(
        new RegExp(`^\\s*${name}\\(\\);`, 'm'),
      );
    });
  }
});
