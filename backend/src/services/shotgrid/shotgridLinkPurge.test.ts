// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger', () => ({ logger: { warn: vi.fn() } }));

import { LOCAL_TYPES } from './shotgridLinks';

/**
 * Les liens ShotGrid ne survivent pas à ce qu'ils désignent.
 *
 * `ShotgridLink` est polymorphe : aucune clé étrangère, donc aucun `ON DELETE CASCADE`.
 * La garantie tient à douze déclencheurs PostgreSQL, un par type liable. Le risque est
 * qu'un treizième type apparaisse dans `LOCAL_TYPES` sans son déclencheur : le défaut
 * serait invisible — des liens orphelins s'accumuleraient en silence jusqu'à ce qu'une
 * synchronisation écrive sur un fantôme, ce qui était déjà arrivé pour les commentaires.
 *
 * Ce test lit les migrations et confronte les deux listes. Il ne remplace pas une
 * vérification en base (faite à la main sur la pile docker, cascade comprise) : il
 * empêche l'oubli.
 */

const MIGRATIONS = join(__dirname, '..', '..', '..', 'prisma', 'migrations');

/** Types locaux couverts par un déclencheur, et la table qui le porte. */
function triggeredTypes(): Map<string, string> {
  const found = new Map<string, string>();
  for (const dir of readdirSync(MIGRATIONS, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const sql = readFileSync(join(MIGRATIONS, dir.name, 'migration.sql'), 'utf8');
    const pattern =
      /CREATE TRIGGER\s+\S+\s+AFTER DELETE ON\s+"([A-Za-z]+)"\s+FOR EACH ROW\s+EXECUTE FUNCTION\s+shotgrid_link_purge\('([A-Za-z]+)'\)/g;
    for (const [, table, localType] of sql.matchAll(pattern)) found.set(localType!, table!);
  }
  return found;
}

describe('purge des correspondances ShotGrid (déclencheurs)', () => {
  it('couvre exactement les types que `LOCAL_TYPES` déclare', () => {
    expect([...triggeredTypes().keys()].sort()).toEqual([...LOCAL_TYPES].sort());
  });

  it('vise la table du modèle correspondant', () => {
    // Un déclencheur posé sur la mauvaise table effacerait les liens d'entités
    // homonymes par leur seul identifiant : plus destructeur que l'orphelin corrigé.
    expect(Object.fromEntries(triggeredTypes())).toEqual({
      episode: 'Episode',
      sequence: 'Sequence',
      shot: 'Shot',
      asset: 'Asset',
      task: 'Task',
      version: 'Version',
      media: 'MediaObject',
      pipelineStatus: 'PipelineStatus',
      reviewStatus: 'ReviewStatus',
      user: 'User',
      playlist: 'Playlist',
      comment: 'Comment',
    });
  });

  it('nettoie l’existant sur les mêmes types', () => {
    // La migration corrige aussi le passé : les liens déjà orphelins au moment du
    // constat (10 sur 14) ne se répareraient pas tout seuls.
    const sql = readFileSync(
      join(MIGRATIONS, '20260908090000_shotgrid_liens_fiables', 'migration.sql'),
      'utf8',
    );
    for (const localType of LOCAL_TYPES) {
      expect(sql).toContain(`l."localType" = '${localType}'`);
    }
  });
});
