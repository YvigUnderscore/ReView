// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` est remonté en tête de fichier : les doublures doivent l'être aussi.
const { findBySg } = vi.hoisted(() => ({ findBySg: vi.fn() }));

vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('./shotgridLinks', () => ({ findBySg: (...args: unknown[]) => findBySg(...args) }));

import { importableVersionIds } from './ShotgridSyncService';
import type { PullContext } from './ShotgridPullService';

function contextWith(statusFilter: string[], records: Record<number, unknown>) {
  const journal = { count: vi.fn(), log: vi.fn(async () => undefined) };
  const findById = vi.fn(async (_entity: string, id: number) => records[id] ?? null);
  const ctx = {
    connection: { id: 1, projectId: 42, sgProjectId: 77 },
    settings: { media: { statusFilter } },
    scope: { sgProjectId: 77, sgProjectName: 'ALPHA' },
    journal,
    client: { findById },
  } as unknown as PullContext;
  return { ctx, journal, findById };
}

const version = (id: number, status: string, projectId = 77) => ({
  type: 'Version',
  id,
  sg_status_list: status,
  project: { type: 'Project', id: projectId, name: 'ALPHA' },
});

beforeEach(() => {
  vi.clearAllMocks();
  findBySg.mockResolvedValue(null);
});

/**
 * Transmettre les identifiants ciblés à `pullVersions` fait sauter le filtre de statuts
 * du studio — le service y voit le signe d'une sélection manuelle. Sur un webhook, ce
 * serait rapatrier les médias de tous les WIP d'un site dont le studio ne suit que les
 * versions en review. Le filtre est donc rejoué ici, avec le cloisonnement projet.
 */
describe('importableVersionIds', () => {
  it('écarte une version neuve hors du filtre de statuts', async () => {
    const { ctx, journal } = contextWith(['rev'], { 9: version(9, 'wip') });

    expect(await importableVersionIds(ctx, [{ sgType: 'Version', sgId: 9 }])).toEqual([]);
    expect(journal.count).toHaveBeenCalledWith('versions', 'skipped');
  });

  it('retient une version neuve dans le filtre', async () => {
    const { ctx } = contextWith(['rev'], { 9: version(9, 'rev') });
    expect(await importableVersionIds(ctx, [{ sgType: 'Version', sgId: 9 }])).toEqual([9]);
  });

  it('retient une version déjà liée quel que soit son statut', async () => {
    // Le filtre décide de ce qu'on importe, pas de ce qu'on continue de suivre : une
    // version passée d'« en review » à « approuvé » doit voir son statut avancer.
    findBySg.mockResolvedValue({ localId: 3, sgId: 9 });
    const { ctx, findById } = contextWith(['rev'], {});

    expect(await importableVersionIds(ctx, [{ sgType: 'Version', sgId: 9 }])).toEqual([9]);
    // Déjà liée : inutile d'aller la relire pour décider.
    expect(findById).not.toHaveBeenCalled();
  });

  it('retient tout quand le studio n’a posé aucun filtre', async () => {
    const { ctx } = contextWith([], { 9: version(9, 'wip') });
    expect(await importableVersionIds(ctx, [{ sgType: 'Version', sgId: 9 }])).toEqual([9]);
  });

  it('refuse une version appartenant à un autre projet du site', async () => {
    // Un identifiant reçu par webhook ne prouve rien : écrire dans le mauvais projet ne
    // se rattrape pas.
    const { ctx, journal } = contextWith([], { 9: version(9, 'rev', 78) });

    expect(await importableVersionIds(ctx, [{ sgType: 'Version', sgId: 9 }])).toEqual([]);
    expect(journal.count).toHaveBeenCalledWith('guard', 'skipped');
    expect(journal.log).toHaveBeenCalledWith(
      'error',
      'shotgrid.log.wrongProject',
      expect.objectContaining({ sgType: 'Version', sgId: 9, expected: 77, found: 78 }),
      expect.objectContaining({ sgType: 'Version', sgId: 9 }),
    );
  });

  it('ignore une version disparue du site', async () => {
    const { ctx } = contextWith([], {});
    expect(await importableVersionIds(ctx, [{ sgType: 'Version', sgId: 9 }])).toEqual([]);
  });

  it('ne regarde que les identifiants de type Version', async () => {
    const { ctx, findById } = contextWith([], { 9: version(9, 'rev') });
    const kept = await importableVersionIds(ctx, [
      { sgType: 'Shot', sgId: 4 },
      { sgType: 'Version', sgId: 9 },
    ]);
    expect(kept).toEqual([9]);
    expect(findById).toHaveBeenCalledTimes(1);
  });
});
