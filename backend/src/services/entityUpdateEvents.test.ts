// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Un plan, une séquence ou un asset modifié doit prévenir les écrans ouverts.
 *
 * Le front écoute `shot:update`, `sequence:update` et `asset:update` depuis leur
 * introduction (`v2/lib/socketBridge`), mais seuls `PipelineEnsureService` (création
 * automatique à l'upload) et la synchronisation ShotGrid les émettaient : aucun des chemins
 * qu'emprunte un humain qui édite dans l'interface. Un statut changé au clic droit restait
 * donc invisible sur tout autre écran jusqu'au rechargement — au point de faire croire que
 * le changement n'était pas passé.
 *
 * Ces trois assertions ferment la boucle côté émetteur ; le test frontal `currentProject`
 * la ferme côté récepteur (la page doit d'abord rejoindre la room du projet).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { db, socket } = vi.hoisted(() => ({
  db: {
    shot: { update: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn() },
    sequence: { update: vi.fn() },
    asset: { update: vi.fn(), count: vi.fn() },
  },
  socket: { emitToProject: vi.fn() },
}));

vi.mock('../lib/prisma', () => ({ prisma: db }));
vi.mock('./SocketService', () => socket);
vi.mock('./shotgrid/ShotgridPushService', () => ({ enqueuePush: vi.fn() }));
vi.mock('./shotgrid/ShotgridGuardService', () => ({ assertDescriptionWritable: vi.fn() }));
vi.mock('../lib/projectGuard', () => ({ assertProjectWritable: vi.fn() }));
vi.mock('./PipelineStatusService', () => ({ assertBelongsToProject: vi.fn() }));

import * as ShotService from './ShotService';
import * as SequenceService from './SequenceService';
import * as AssetService from './AssetService';

const PROJECT = 7;

beforeEach(() => {
  vi.clearAllMocks();
  db.shot.update.mockResolvedValue({ id: 21 });
  db.sequence.update.mockResolvedValue({ id: 13 });
  db.asset.update.mockResolvedValue({ id: 58, shots: [], sequences: [] });
  db.asset.count.mockResolvedValue(0);
});

/** Les événements émis pour ce projet, par nom. */
function emitted(name: string) {
  return socket.emitToProject.mock.calls.filter((c) => c[1] === name);
}

describe('événements d’entité émis par les chemins d’édition ordinaires', () => {
  it('un plan modifié émet shot:update pour son projet', async () => {
    await ShotService.update(21, PROJECT, { pipelineStatusId: 8 });
    expect(emitted('shot:update')).toEqual([[PROJECT, 'shot:update', { projectId: PROJECT, id: 21 }]]);
  });

  it('un plan modifié continue d’émettre timeline:update (montages automatiques)', async () => {
    await ShotService.update(21, PROJECT, { omitted: true });
    expect(emitted('timeline:update')).toHaveLength(1);
  });

  it('une séquence modifiée émet sequence:update pour son projet', async () => {
    await SequenceService.update(13, PROJECT, { pipelineStatusId: 8 });
    expect(emitted('sequence:update')).toEqual([
      [PROJECT, 'sequence:update', { projectId: PROJECT, id: 13 }],
    ]);
  });

  it('un asset modifié émet asset:update pour son projet', async () => {
    await AssetService.update(PROJECT, 58, { pipelineStatusId: 8 });
    expect(emitted('asset:update')).toEqual([[PROJECT, 'asset:update', { projectId: PROJECT, id: 58 }]]);
  });

  it('émet même quand le changement ne touche pas le statut', async () => {
    await ShotService.update(21, PROJECT, { name: 'Snow field, wide' });
    await SequenceService.update(13, PROJECT, { name: 'Cold open' });
    await AssetService.update(PROJECT, 58, { name: 'Kitchen Set' });
    expect(emitted('shot:update')).toHaveLength(1);
    expect(emitted('sequence:update')).toHaveLength(1);
    expect(emitted('asset:update')).toHaveLength(1);
  });
});
