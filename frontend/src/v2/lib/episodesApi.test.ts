// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { groupSequencesByEpisode, moveInOrder, shotsOfSequence } from './episodesApi';

/**
 * Les trois règles pures du niveau Épisode. Ce sont celles qu'une erreur d'index rendrait
 * silencieusement fausses : la liste se réafficherait, dans le mauvais ordre ou amputée
 * d'une séquence, sans qu'aucune erreur ne remonte.
 */

const seq = (id: number, episodeId?: number | null) => ({ id, episodeId });

describe('moveInOrder', () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }];

  it('monte et descend d’un cran', () => {
    expect(moveInOrder(items, 3, -1)).toEqual([1, 3, 2]);
    expect(moveInOrder(items, 1, 1)).toEqual([2, 1, 3]);
  });

  it('laisse la liste intacte hors des bornes plutôt que de la tronquer', () => {
    expect(moveInOrder(items, 1, -1)).toEqual([1, 2, 3]);
    expect(moveInOrder(items, 3, 1)).toEqual([1, 2, 3]);
  });

  it('laisse la liste intacte pour un identifiant inconnu', () => {
    expect(moveInOrder(items, 99, 1)).toEqual([1, 2, 3]);
  });
});

describe('groupSequencesByEpisode', () => {
  it('rend un groupe « sans épisode », même vide de sens pour un long-métrage', () => {
    // « Sans » est une réponse, pas une absence : taire ce groupe ferait disparaître de
    // l'écran des séquences bien vivantes.
    const groups = groupSequencesByEpisode([], [seq(1), seq(2, null)]);
    expect(groups).toEqual([{ episodeId: null, sequences: [seq(1), seq(2, null)] }]);
  });

  it('range chaque séquence sous son épisode, dans l’ordre reçu', () => {
    const groups = groupSequencesByEpisode(
      [{ id: 10 }, { id: 11 }],
      [seq(1, 11), seq(2, 10), seq(3, 11), seq(4, null)],
    );
    expect(groups.map((g) => [g.episodeId, g.sequences.map((s) => s.id)])).toEqual([
      [10, [2]],
      [11, [1, 3]],
      [null, [4]],
    ]);
  });

  it('n’invente pas de groupe pour un épisode que rien ne réclame', () => {
    const groups = groupSequencesByEpisode([{ id: 10 }], []);
    expect(groups.every((g) => g.sequences.length === 0)).toBe(true);
  });
});

describe('shotsOfSequence', () => {
  it('ne garde que les plans de la séquence demandée, ordre serveur conservé', () => {
    const shots = [
      { id: 1, sequenceId: 5 },
      { id: 2, sequenceId: 6 },
      { id: 3, sequenceId: 5 },
      { id: 4, sequenceId: null },
    ];
    expect(shotsOfSequence(shots, { id: 5 }).map((s) => s.id)).toEqual([1, 3]);
  });
});
