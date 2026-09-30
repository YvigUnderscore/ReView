// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Personne n'écrit dans ShotGrid en dehors de `ShotgridWriter`.
 *
 * Les gardes de cloisonnement existaient déjà avant ce test, et elles étaient correctes.
 * Ce qui manquait, c'est qu'elles soient **obligatoires** : rien n'empêchait un nouvel
 * appel de parler au client directement, et l'histoire du dossier montre que ça glisse —
 * `ShotgridPlaylistSync` avait recopié les trois vérifications à la main plutôt que de
 * réutiliser le chemin commun, et une copie finit toujours par diverger de l'original.
 *
 * Le contrôle est volontairement bête et textuel : il cherche les méthodes `unsafe*` du
 * client dans tout le backend. Une écriture ajoutée ailleurs qu'ici fait rougir la suite
 * avant d'atteindre un site de production. C'est le même idiome que
 * `shotgridLinkPurge.test.ts`, qui confronte la liste des types liés aux déclencheurs SQL.
 */

/** Méthodes d'écriture brutes du client — leur nom dit déjà qu'elles ne s'appellent pas. */
const UNSAFE_METHODS = ['unsafeCreate', 'unsafeUpdate', 'unsafeRemove', 'unsafeUploadFile'];

/**
 * Les seuls fichiers qui ont le droit de les nommer : le client qui les déclare, le
 * writer qui les appelle, et les deux suites qui les éprouvent. Un test n'atteint aucun
 * site de production — mais la liste reste nominative, pour qu'exempter un fichier soit
 * un geste visible dans le diff plutôt qu'un effet de bord d'une règle trop large.
 */
const ALLOWED = [
  'services/shotgrid/ShotgridClient.ts',
  'services/shotgrid/ShotgridWriter.ts',
  'services/shotgrid/ShotgridClient.test.ts',
  'services/shotgrid/ShotgridWriter.test.ts',
];

const SRC = join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

/** Chemin relatif à `src`, en séparateurs POSIX — lisible dans le message d'échec. */
const relative = (file: string) =>
  file
    .slice(SRC.length + 1)
    .split('\\')
    .join('/');

describe('écritures ShotGrid', () => {
  it('ne partent que de ShotgridWriter', () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      const rel = relative(file);
      if (ALLOWED.includes(rel)) continue;
      // Ce fichier-ci cite forcément les noms qu'il interdit.
      if (rel.endsWith('ShotgridWriteGuard.test.ts')) continue;

      const source = readFileSync(file, 'utf8');
      for (const method of UNSAFE_METHODS) {
        if (source.includes(method)) offenders.push(`${rel} → ${method}`);
      }
    }

    expect(
      offenders,
      `Écriture ShotGrid hors de ShotgridWriter :\n  ${offenders.join('\n  ')}\n` +
        'Passer par ctx.writer — il pose le projet lié, relit la cible et refuse les projets modèles.',
    ).toEqual([]);
  });

  it('garde la liste des méthodes brutes alignée sur le client', () => {
    // Si une méthode d'écriture est ajoutée au client sans être listée ici, elle
    // échapperait au contrôle ci-dessus sans que personne ne le remarque.
    const client = readFileSync(join(SRC, 'services/shotgrid/ShotgridClient.ts'), 'utf8');
    const declared = Array.from(client.matchAll(/async (unsafe[A-Za-z]+)\(/g), (m) => m[1]);

    expect(declared.sort()).toEqual([...UNSAFE_METHODS].sort());
  });
});
