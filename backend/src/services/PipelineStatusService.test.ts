// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    pipelineStatus: { findMany: vi.fn() },
    shotgridConnection: { findUnique: vi.fn() },
  },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));

import { listForProject } from './PipelineStatusService';

const local = [
  { id: 1, scope: 'task', code: 'todo', origin: 'local' },
  { id: 2, scope: 'task', code: 'approved', origin: 'local' },
];
const site = [
  { id: 10, scope: 'task', code: 'wtg', origin: 'shotgrid' },
  { id: 11, scope: 'task', code: 'rdy', origin: 'shotgrid' },
  { id: 12, scope: 'task', code: 'suprev', origin: 'shotgrid' },
];

beforeEach(() => {
  vi.clearAllMocks();
  db.pipelineStatus.findMany.mockResolvedValue([...local, ...site]);
});

/**
 * Le référentiel appartient au studio, la liste proposée appartient au projet. Mélanger
 * les deux vocabulaires invite à poser sur un projet ShotGrid un statut que le site
 * refusera — et à proposer ailleurs des statuts qui ne veulent rien dire.
 */
describe('listForProject', () => {
  it('ne propose que le vocabulaire du site sur un projet relié', async () => {
    db.shotgridConnection.findUnique.mockResolvedValue({ active: true });
    const r = await listForProject(461, 'task');
    expect(r.map((s) => s.code)).toEqual(['wtg', 'rdy', 'suprev']);
  });

  it('ne propose que les statuts locaux sur un projet non relié', async () => {
    db.shotgridConnection.findUnique.mockResolvedValue(null);
    const r = await listForProject(448, 'task');
    expect(r.map((s) => s.code)).toEqual(['todo', 'approved']);
  });

  it('traite une connexion désactivée comme une absence de connexion', async () => {
    // Délier un projet ne doit pas laisser son équipe avec le vocabulaire d'un site
    // auquel elle n'a plus accès.
    db.shotgridConnection.findUnique.mockResolvedValue({ active: false });
    const r = await listForProject(461, 'task');
    expect(r.map((s) => s.code)).toEqual(['todo', 'approved']);
  });

  it('ne laisse jamais la liste vide', async () => {
    // Un projet relié dont les statuts n'ont pas encore été lus : mieux vaut le
    // vocabulaire local qu'un sélecteur sans aucune option.
    db.pipelineStatus.findMany.mockResolvedValue(local);
    db.shotgridConnection.findUnique.mockResolvedValue({ active: true });
    const r = await listForProject(461, 'task');
    expect(r.map((s) => s.code)).toEqual(['todo', 'approved']);
  });

  it('trie de façon déterministe', async () => {
    db.shotgridConnection.findUnique.mockResolvedValue(null);
    await listForProject(448, 'task');
    // Deux statuts de même rang sortiraient dans un ordre variable sans départage :
    // le « premier » servant de repli changerait d'un appel à l'autre.
    expect(db.pipelineStatus.findMany.mock.calls[0]![0].orderBy).toEqual([
      { scope: 'asc' },
      { order: 'asc' },
      { code: 'asc' },
    ]);
  });
});
