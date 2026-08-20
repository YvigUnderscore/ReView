// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi } from 'vitest';

// Le module tire toute la chaîne de synchronisation : on ne teste ici que la règle de
// conflit, qui est pure. Les dépendances lourdes sont neutralisées.
vi.mock('../../lib/prisma', () => ({ prisma: {} }));
vi.mock('./ShotgridClient', () => ({ clientForSiteRecord: vi.fn() }));
vi.mock('../JobService', () => ({ shotgridQueue: { add: vi.fn() } }));
vi.mock('../StorageService', () => ({ storage: {}, StorageService: {} }));

import { arbitrate, isRealConflict, statusPatch } from './ShotgridPullService';

const T = (iso: string) => new Date(iso);
const SYNC = T('2026-08-20T10:00:00Z');
const APRES = T('2026-08-20T10:05:00Z');
const AVANT = T('2026-08-20T09:55:00Z');

describe('isRealConflict', () => {
  it('ne voit aucun conflit quand les deux côtés portent la même valeur', () => {
    // Le cas qui polluait le journal du studio : « review: ip, shotgrid: ip ».
    expect(
      isRealConflict({
        localUpdatedAt: APRES,
        linkSyncedAt: SYNC,
        reviewValue: 'ip',
        remoteValue: 'ip',
      }),
    ).toBe(false);
  });

  it('voit un conflit quand les valeurs divergent après une écriture locale', () => {
    expect(
      isRealConflict({
        localUpdatedAt: APRES,
        linkSyncedAt: SYNC,
        reviewValue: 'rdy',
        remoteValue: 'hld',
      }),
    ).toBe(true);
  });

  it('traite « absent des deux côtés » comme un accord', () => {
    expect(
      isRealConflict({ localUpdatedAt: APRES, linkSyncedAt: SYNC, reviewValue: null, remoteValue: null }),
    ).toBe(false);
  });

  it('voit un conflit quand un seul côté porte une valeur', () => {
    expect(
      isRealConflict({ localUpdatedAt: APRES, linkSyncedAt: SYNC, reviewValue: 'ip', remoteValue: null }),
    ).toBe(true);
    expect(
      isRealConflict({ localUpdatedAt: APRES, linkSyncedAt: SYNC, reviewValue: null, remoteValue: 'ip' }),
    ).toBe(true);
  });

  it('ne voit rien tant que le côté ReView n’a pas bougé depuis la synchronisation', () => {
    expect(
      isRealConflict({
        localUpdatedAt: AVANT,
        linkSyncedAt: SYNC,
        reviewValue: 'rdy',
        remoteValue: 'hld',
      }),
    ).toBe(false);
  });

  it('tolère une seconde d’écart : l’écriture et l’horodatage du lien ne sont pas simultanés', () => {
    expect(
      isRealConflict({
        localUpdatedAt: new Date(SYNC.getTime() + 900),
        linkSyncedAt: SYNC,
        reviewValue: 'rdy',
        remoteValue: 'hld',
      }),
    ).toBe(false);
    expect(
      isRealConflict({
        localUpdatedAt: new Date(SYNC.getTime() + 1500),
        linkSyncedAt: SYNC,
        reviewValue: 'rdy',
        remoteValue: 'hld',
      }),
    ).toBe(true);
  });

  it('ne conclut rien sans date : un lien jamais synchronisé n’est pas un conflit', () => {
    expect(isRealConflict({ localUpdatedAt: APRES, linkSyncedAt: null })).toBe(false);
    expect(isRealConflict({ localUpdatedAt: null, linkSyncedAt: SYNC })).toBe(false);
  });

  it('s’en tient à la date quand l’appelant ne fournit pas de valeurs', () => {
    // Le pull des plans n'en fournit pas : le comportement d'origine est conservé.
    expect(isRealConflict({ localUpdatedAt: APRES, linkSyncedAt: SYNC })).toBe(true);
  });
});

describe('statusPatch', () => {
  const map = new Map([
    ['ip', { id: 7, code: 'ip' } as never],
    ['fin', { id: 9, code: 'fin' } as never],
  ]);

  it('propage un statut vidé côté site', () => {
    // Le site a effacé le statut : c'est une décision, elle doit descendre.
    expect(statusPatch(null, map)).toEqual({ patch: { pipelineStatusId: null }, unknownCode: null });
    expect(statusPatch('', map)).toEqual({ patch: { pipelineStatusId: null }, unknownCode: null });
  });

  it('écrit le statut quand le code est connu', () => {
    expect(statusPatch('ip', map)).toEqual({ patch: { pipelineStatusId: 7 }, unknownCode: null });
  });

  it("n'écrit rien et signale quand le code est inconnu", () => {
    // Le cœur du défaut : l'ancien code écrivait `null` ici — statut effacé en silence.
    const { patch, unknownCode } = statusPatch('omg', map);
    expect(patch).toEqual({});
    expect('pipelineStatusId' in patch).toBe(false);
    expect(unknownCode).toBe('omg');
  });

  it('conserve le statut local quand la carte est vide', () => {
    // Carte vide = cas ordinaire (statuses.read fermé, schéma du site inaccessible).
    // Une passe de routine ne doit pas vider les statuts de tout un projet.
    expect(statusPatch('ip', new Map())).toEqual({ patch: {}, unknownCode: 'ip' });
  });
});

describe('arbitrate', () => {
  it('applique les trois politiques du studio', () => {
    // Le réglage en proposait trois et n'en appliquait qu'une : ShotGrid gagnait
    // toujours, y compris quand l'écran affichait « ReView gagne ».
    expect(arbitrate('sg_wins')).toBe('overwrite');
    expect(arbitrate('review_wins')).toBe('keep');
    expect(arbitrate('manual')).toBe('defer');
  });

  it('retombe sur ShotGrid quand la politique est absente ou inconnue', () => {
    expect(arbitrate(undefined)).toBe('overwrite');
    expect(arbitrate('nawak')).toBe('overwrite');
  });
});
