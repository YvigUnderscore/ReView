// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` est remonté en tête de fichier : les doublures doivent l'être aussi.
const { connection, runSync } = vi.hoisted(() => ({
  connection: { findUnique: vi.fn(), update: vi.fn() },
  runSync: vi.fn(),
}));

vi.mock('../../lib/prisma', () => ({ prisma: { shotgridConnection: connection } }));
vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../JobService', () => ({ shotgridQueue: { add: vi.fn() } }));
vi.mock('./ShotgridSyncService', () => ({ runSync: (...args: unknown[]) => runSync(...args) }));

import { handleEvent, parseEventType } from './ShotgridEventService';

const LINKED = {
  id: 1,
  projectId: 42,
  active: true,
  sgProjectId: 77,
  sgProjectName: 'ALPHA',
  settings: {},
};

function event(type: string, entityId: number) {
  return {
    event_type: type,
    entity: { type: type.split('_')[1], id: entityId },
    project: { type: 'Project', id: 77, name: 'ALPHA' },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  connection.findUnique.mockResolvedValue(LINKED);
  runSync.mockResolvedValue({ runId: 1, status: 'ok', stats: {} });
});

describe('parseEventType', () => {
  it('lit le type d’entité et l’action', () => {
    expect(parseEventType('Shotgun_Note_New')).toEqual({ entity: 'Note', action: 'New' });
    expect(parseEventType('Shotgun_Version_Change')).toEqual({ entity: 'Version', action: 'Change' });
    expect(parseEventType('bruit')).toBeNull();
    expect(parseEventType(undefined)).toBeNull();
  });
});

/**
 * Le sens entrant des notes et des playlists était mort : l'événement était accepté puis
 * traité par une passe qui ne savait pas les lire. Ces vérifications tiennent la
 * correspondance « événement reçu → passe exécutée ».
 */
describe('handleEvent', () => {
  it('importe enfin la note désignée par l’événement', async () => {
    await handleEvent(1, event('Shotgun_Note_New', 501));

    expect(runSync).toHaveBeenCalledWith(42, {
      kind: 'webhook',
      passes: ['notes'],
      onlySgIds: [{ sgType: 'Note', sgId: 501 }],
    });
  });

  it('importe la playlist désignée par l’événement', async () => {
    await handleEvent(1, event('Shotgun_Playlist_Change', 88));

    expect(runSync).toHaveBeenCalledWith(42, {
      kind: 'webhook',
      passes: ['playlists'],
      onlySgIds: [{ sgType: 'Playlist', sgId: 88 }],
    });
  });

  it('ne rejoue pas tout le projet pour une version', async () => {
    await handleEvent(1, event('Shotgun_Version_Change', 9001));

    const options = runSync.mock.calls[0]![1] as { passes: string[]; onlySgIds: unknown };
    expect(options.passes).toEqual(['versions']);
    expect(options.onlySgIds).toEqual([{ sgType: 'Version', sgId: 9001 }]);
  });

  it('relit toute la hiérarchie pour un statut, sans cibler d’entité', async () => {
    await handleEvent(1, {
      event_type: 'Shotgun_Status_Change',
      entity: { type: 'Status', id: 3 },
      project: { type: 'Project', id: 77, name: 'ALPHA' },
    });

    const options = runSync.mock.calls[0]![1] as { passes: string[]; onlySgIds?: unknown };
    expect(options.passes).toEqual(['statuses', 'episodes', 'sequences', 'shots', 'assets', 'tasks']);
    expect(options.onlySgIds).toBeUndefined();
  });

  it('refuse un événement venu d’un autre projet du site', async () => {
    // Un site héberge tous les projets du studio : un webhook mal configuré livre les
    // événements du voisin, et écrire dans le mauvais projet ne se rattrape pas.
    await handleEvent(1, {
      event_type: 'Shotgun_Shot_Change',
      entity: { type: 'Shot', id: 5 },
      project: { type: 'Project', id: 78, name: 'BRAVO' },
    });

    expect(runSync).not.toHaveBeenCalled();
  });

  it('ne fait rien quand le studio a choisi le mode manuel', async () => {
    connection.findUnique.mockResolvedValue({ ...LINKED, settings: { eventMode: 'manual' } });
    await handleEvent(1, event('Shotgun_Note_New', 501));
    expect(runSync).not.toHaveBeenCalled();
  });

  it('ne fait rien sur une connexion désactivée', async () => {
    connection.findUnique.mockResolvedValue({ ...LINKED, active: false });
    await handleEvent(1, event('Shotgun_Note_New', 501));
    expect(runSync).not.toHaveBeenCalled();
  });
});
