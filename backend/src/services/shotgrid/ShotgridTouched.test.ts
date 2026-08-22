// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, vi, beforeEach } from 'vitest';

// `vi.mock` est remonté en tête de fichier : la doublure doit l'être aussi.
const { emitToProject } = vi.hoisted(() => ({ emitToProject: vi.fn() }));
vi.mock('../SocketService', () => ({ emitToProject: (...a: unknown[]) => emitToProject(...a) }));

import { DETAIL_LIMIT, flushTouched, TouchedEntities } from './ShotgridTouched';

beforeEach(() => vi.clearAllMocks());

/**
 * Une passe complète émettait un événement socket par entité — jusqu'à douze mille, que
 * le client multipliait ensuite par cinq invalidations. Le collecteur tranche en fin de
 * passe : détail tant que la passe reste petite, résumé au-delà.
 */
describe('TouchedEntities', () => {
  it('rejoue le détail d’une passe ciblée', () => {
    const touched = new TouchedEntities();
    touched.add('shot', 12);
    touched.add('task', 7, { shotId: 12, assetId: null });

    expect(touched.detailed).toBe(true);
    expect(touched.detail()).toEqual([
      { kind: 'shot', id: 12 },
      { kind: 'task', id: 7, extra: { shotId: 12, assetId: null } },
    ]);
    expect(touched.summary()).toEqual({ counts: { shot: 1, task: 1 }, total: 2, detailed: true });
  });

  it('ne compte qu’une fois une entité touchée deux fois', () => {
    const touched = new TouchedEntities();
    touched.add('shot', 12);
    touched.add('shot', 12, { ignored: true });

    expect(touched.total).toBe(1);
    expect(touched.detail()).toHaveLength(1);
  });

  it('distingue deux familles portant le même identifiant', () => {
    const touched = new TouchedEntities();
    touched.add('shot', 5);
    touched.add('task', 5);
    expect(touched.summary().counts).toEqual({ shot: 1, task: 1 });
  });

  it('abandonne le détail au-delà du seuil et ne garde que le décompte', () => {
    const touched = new TouchedEntities();
    for (let i = 0; i <= DETAIL_LIMIT; i += 1) touched.add('shot', i);

    expect(touched.total).toBe(DETAIL_LIMIT + 1);
    expect(touched.detailed).toBe(false);
    // Rien à rejouer : c'est précisément la rafale qu'on supprime.
    expect(touched.detail()).toEqual([]);
    expect(touched.summary().counts).toEqual({ shot: DETAIL_LIMIT + 1 });
  });

  it('compte notes et playlists sans leur inventer d’événement fin', () => {
    // Le client n'écoute rien pour ces deux familles : elles ne voyagent qu'en décompte,
    // et c'est ce décompte qui lui dit de recharger commentaires et séances.
    const touched = new TouchedEntities();
    touched.add('comment', 3);
    touched.add('playlist', 4);

    expect(touched.detail()).toEqual([]);
    expect(touched.summary()).toEqual({
      counts: { comment: 1, playlist: 1 },
      total: 2,
      detailed: true,
    });
  });

  it('rend un résumé vide quand la passe n’a rien touché', () => {
    const touched = new TouchedEntities();
    expect(touched.summary()).toEqual({ counts: {}, total: 0, detailed: true });
  });
});

/**
 * Contrat d'émission, sur lequel le pont socket du client s'appuie : `detailed` dit si
 * les événements fins ont déjà été envoyés, donc si le client doit recharger largement.
 */
describe('flushTouched', () => {
  it('rejoue le détail puis annonce un résumé « détaillé »', () => {
    const touched = new TouchedEntities();
    touched.add('shot', 12);
    touched.add('task', 7, { shotId: 12, assetId: null });
    touched.add('comment', 3);

    flushTouched(42, 900, 'ok', touched);

    expect(emitToProject).toHaveBeenNthCalledWith(1, 42, 'shot:update', { projectId: 42, id: 12 });
    expect(emitToProject).toHaveBeenNthCalledWith(2, 42, 'task:update', {
      projectId: 42,
      id: 7,
      shotId: 12,
      assetId: null,
    });
    expect(emitToProject).toHaveBeenNthCalledWith(3, 42, 'shotgrid:sync', {
      projectId: 42,
      runId: 900,
      status: 'ok',
      counts: { shot: 1, task: 1, comment: 1 },
      total: 3,
      detailed: true,
    });
  });

  it('n’émet qu’un résumé quand la passe a débordé', () => {
    // C'est le correctif : une passe complète n'envoie plus douze mille événements.
    const touched = new TouchedEntities();
    for (let i = 0; i <= DETAIL_LIMIT; i += 1) touched.add('shot', i);

    flushTouched(42, 900, 'ok', touched);

    expect(emitToProject).toHaveBeenCalledTimes(1);
    expect(emitToProject).toHaveBeenCalledWith(42, 'shotgrid:sync', {
      projectId: 42,
      runId: 900,
      status: 'ok',
      counts: { shot: DETAIL_LIMIT + 1 },
      total: DETAIL_LIMIT + 1,
      detailed: false,
    });
  });

  it('annonce même une passe qui n’a rien touché — le client suit l’état du run', () => {
    flushTouched(42, 901, 'error', new TouchedEntities());

    expect(emitToProject).toHaveBeenCalledTimes(1);
    expect(emitToProject).toHaveBeenCalledWith(42, 'shotgrid:sync', {
      projectId: 42,
      runId: 901,
      status: 'error',
      counts: {},
      total: 0,
      detailed: true,
    });
  });
});
