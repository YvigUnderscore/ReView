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

import { listForProject, resolveByLegacy } from './PipelineStatusService';
import { TaskStatus } from '@prisma/client';

const local = [
  { id: 1, scope: 'task', code: 'todo', origin: 'local', legacyStatus: TaskStatus.TODO },
  { id: 2, scope: 'task', code: 'approved', origin: 'local', legacyStatus: TaskStatus.APPROVED },
];
const site = [
  { id: 10, scope: 'task', code: 'wtg', origin: 'shotgrid', legacyStatus: TaskStatus.TODO },
  { id: 11, scope: 'task', code: 'hld', origin: 'shotgrid', legacyStatus: TaskStatus.TODO },
  { id: 12, scope: 'task', code: 'suprev', origin: 'shotgrid', legacyStatus: TaskStatus.PENDING_REVIEW },
];
const own = [{ id: 20, scope: 'task', code: 'brief', origin: 'local', legacyStatus: TaskStatus.TODO }];

/** Enchaîne les retours de `findMany` dans l'ordre où le service les demande. */
const answers = (...lists: unknown[][]) => {
  for (const list of lists) db.pipelineStatus.findMany.mockResolvedValueOnce(list);
};
const whereOf = (call: number) =>
  (db.pipelineStatus.findMany.mock.calls[call]![0] as { where: Record<string, unknown> }).where;

beforeEach(() => vi.clearAllMocks());

/**
 * Le référentiel appartient au studio, la liste proposée appartient au projet. Mélanger
 * les deux vocabulaires invite à poser sur un projet ShotGrid un statut que le site
 * refusera — et à proposer ailleurs des statuts qui ne veulent rien dire.
 */
describe('listForProject', () => {
  it('sert d’abord le vocabulaire propre au projet', async () => {
    answers(own);
    const r = await listForProject(461, 'task');
    expect(r.map((s) => s.code)).toEqual(['brief']);
    // Le studio n'est pas consulté, ni la connexion : le projet a le dernier mot.
    expect(db.shotgridConnection.findUnique).not.toHaveBeenCalled();
  });

  it('ne propose que le vocabulaire du site sur un projet relié', async () => {
    answers([], site);
    db.shotgridConnection.findUnique.mockResolvedValue({ active: true });
    const r = await listForProject(461, 'task');
    expect(r.map((s) => s.code)).toEqual(['wtg', 'hld', 'suprev']);
    expect(whereOf(1)).toMatchObject({ projectId: null, origin: 'shotgrid' });
  });

  it('ne propose que les statuts locaux sur un projet non relié', async () => {
    answers([], local);
    db.shotgridConnection.findUnique.mockResolvedValue(null);
    const r = await listForProject(448, 'task');
    expect(r.map((s) => s.code)).toEqual(['todo', 'approved']);
    expect(whereOf(1)).toMatchObject({ projectId: null, origin: 'local' });
  });

  it('traite une connexion désactivée comme une absence de connexion', async () => {
    // Délier un projet ne doit pas laisser son équipe avec le vocabulaire d'un site
    // auquel elle n'a plus accès.
    answers([], local);
    db.shotgridConnection.findUnique.mockResolvedValue({ active: false });
    const r = await listForProject(461, 'task');
    expect(r.map((s) => s.code)).toEqual(['todo', 'approved']);
  });

  it('retombe sur le vocabulaire local quand le site n’a pas encore été lu', async () => {
    // Un projet relié dont les statuts n'ont pas encore été importés : mieux vaut le
    // vocabulaire local qu'un sélecteur sans aucune option.
    answers([], [], local);
    db.shotgridConnection.findUnique.mockResolvedValue({ active: true });
    const r = await listForProject(461, 'task');
    expect(r.map((s) => s.code)).toEqual(['todo', 'approved']);
  });

  it('ne sert JAMAIS le vocabulaire d’un site à un projet non relié', async () => {
    // Le défaut corrigé en B2 : le repli rendait « tout le référentiel », site compris,
    // à un projet qui n'y est pas relié.
    answers([], []);
    db.shotgridConnection.findUnique.mockResolvedValue(null);
    expect(await listForProject(448, 'shot')).toEqual([]);
    // Trois appels auraient signifié qu'on est allé chercher un repli de plus.
    expect(db.pipelineStatus.findMany).toHaveBeenCalledTimes(2);
  });

  it('trie de façon déterministe', async () => {
    answers(own);
    await listForProject(448, 'task');
    // Deux statuts de même rang sortiraient dans un ordre variable sans départage :
    // le « premier » servant de repli changerait d'un appel à l'autre.
    expect((db.pipelineStatus.findMany.mock.calls[0]![0] as { orderBy: unknown }).orderBy).toEqual([
      { scope: 'asc' },
      { order: 'asc' },
      { code: 'asc' },
    ]);
  });
});

describe('resolveByLegacy', () => {
  it('cherche la correspondance dans le vocabulaire du projet, pas dans le référentiel entier', async () => {
    answers([], site);
    db.shotgridConnection.findUnique.mockResolvedValue({ active: true });
    const match = await resolveByLegacy(461, 'task', TaskStatus.PENDING_REVIEW);
    expect(match?.code).toBe('suprev');
  });

  it('rend le premier statut du projet qui porte cette valeur', async () => {
    // « wtg » et « hld » retombent tous deux sur TODO : c'est l'ordre du projet qui tranche,
    // et non l'ordre global du référentiel.
    answers([], site);
    db.shotgridConnection.findUnique.mockResolvedValue({ active: true });
    const match = await resolveByLegacy(461, 'task', TaskStatus.TODO);
    expect(match?.code).toBe('wtg');
  });

  it('rend null quand aucun statut du projet ne porte cette valeur', async () => {
    answers([], local);
    db.shotgridConnection.findUnique.mockResolvedValue(null);
    expect(await resolveByLegacy(448, 'task', TaskStatus.RETAKE)).toBeNull();
  });
});
