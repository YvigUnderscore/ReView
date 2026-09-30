// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Événements temps réel d'un lot de plans.
 *
 * Une action de production sur trente plans émettait trente `shot:update` et trente
 * `timeline:update` ; chacun rechargeait le kanban ENTIER chez chaque personne connectée.
 * Elle en émet désormais un seul couple, qui porte les trente identifiants — et la forme
 * du singulier reste inchangée, sans quoi tout consommateur existant serait à reprendre.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { socket, db } = vi.hoisted(() => ({
  socket: { emitToProject: vi.fn() },
  db: { shot: { update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() } },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./SocketService', () => socket);
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('./shotgrid/ShotgridGuardService', () => ({ assertDescriptionWritable: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('./PipelineStatusService', () => ({ assertBelongsToProject: vi.fn() }));

import { emitShotsUpdated, update } from './ShotService';

const PROJECT = 7;

beforeEach(() => {
  vi.clearAllMocks();
  db.shot.update.mockResolvedValue({ id: 21 });
});

describe('emitShotsUpdated', () => {
  it('un seul plan : exactement le payload d’avant, sans champ de lot', () => {
    emitShotsUpdated(PROJECT, [21]);

    expect(socket.emitToProject.mock.calls).toEqual([
      [PROJECT, 'shot:update', { projectId: PROJECT, id: 21 }],
      [PROJECT, 'timeline:update', { projectId: PROJECT, shotId: 21 }],
    ]);
  });

  it('trente plans : deux événements en tout, et non soixante', () => {
    const ids = Array.from({ length: 30 }, (_, i) => i + 1);

    emitShotsUpdated(PROJECT, ids);

    expect(socket.emitToProject).toHaveBeenCalledTimes(2);
    expect(socket.emitToProject.mock.calls).toEqual([
      [PROJECT, 'shot:update', { projectId: PROJECT, id: 1, ids }],
      [PROJECT, 'timeline:update', { projectId: PROJECT, shotId: 1, ids }],
    ]);
  });

  it('un lot vide n’émet rien — un lot entièrement refusé ne réveille personne', () => {
    emitShotsUpdated(PROJECT, []);

    expect(socket.emitToProject).not.toHaveBeenCalled();
  });

  it('le lot est recopié : le tableau de l’appelant peut vivre sa vie', () => {
    const ids = [4, 5];
    emitShotsUpdated(PROJECT, ids);
    ids.push(6);

    expect(socket.emitToProject.mock.calls[0]?.[2]).toEqual({
      projectId: PROJECT,
      id: 4,
      ids: [4, 5],
    });
  });

  /**
   * Le contrat que `BulkService` exploite : la boucle n'émet rien, l'appelant émet une
   * fois. Sans `deferEvents`, trente passages donnaient soixante événements.
   */
  it('deferEvents retient les émissions du chemin unitaire', async () => {
    await update(21, PROJECT, { pipelineStatusId: 8 }, 5, { deferEvents: true });

    expect(socket.emitToProject).not.toHaveBeenCalled();
  });

  it('sans deferEvents, le chemin unitaire émet ses deux événements comme avant', async () => {
    await update(21, PROJECT, { pipelineStatusId: 8 }, 5);

    expect(socket.emitToProject).toHaveBeenCalledTimes(2);
  });
});
