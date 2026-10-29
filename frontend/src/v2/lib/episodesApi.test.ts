// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { groupSequencesByEpisode, moveInOrder, shotsOfSequence } from './episodesApi';

/**
 * The three pure rules of the Episode level. These are the ones an index error would silently make
 * wrong: the list would redisplay, in the wrong order or missing a sequence, without any error being raised.
 */

const seq = (id: number, episodeId?: number | null) => ({ id, episodeId });

describe('moveInOrder', () => {
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }];

  it('moves up and down by one step', () => {
    expect(moveInOrder(items, 3, -1)).toEqual([1, 3, 2]);
    expect(moveInOrder(items, 1, 1)).toEqual([2, 1, 3]);
  });

  it('leaves the list intact outside the bounds rather than truncating it', () => {
    expect(moveInOrder(items, 1, -1)).toEqual([1, 2, 3]);
    expect(moveInOrder(items, 3, 1)).toEqual([1, 2, 3]);
  });

  it('leaves the list intact for an unknown identifier', () => {
    expect(moveInOrder(items, 99, 1)).toEqual([1, 2, 3]);
  });
});

describe('groupSequencesByEpisode', () => {
  it('returns a "no episode" group, even if it makes little sense for a feature film', () => {
    // "None" is an answer, not an absence: hiding this group would make live sequences disappear
    // from the screen.
    const groups = groupSequencesByEpisode([], [seq(1), seq(2, null)]);
    expect(groups).toEqual([{ episodeId: null, sequences: [seq(1), seq(2, null)] }]);
  });

  it('files each sequence under its episode, in the order received', () => {
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

  it('does not invent a group for an episode nothing claims', () => {
    const groups = groupSequencesByEpisode([{ id: 10 }], []);
    expect(groups.every((g) => g.sequences.length === 0)).toBe(true);
  });
});

describe('shotsOfSequence', () => {
  it('keeps only the shots of the requested sequence, server order preserved', () => {
    const shots = [
      { id: 1, sequenceId: 5 },
      { id: 2, sequenceId: 6 },
      { id: 3, sequenceId: 5 },
      { id: 4, sequenceId: null },
    ];
    expect(shotsOfSequence(shots, { id: 5 }).map((s) => s.id)).toEqual([1, 3]);
  });
});
