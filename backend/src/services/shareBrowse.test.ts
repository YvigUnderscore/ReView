// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { buildShareBrowse, type ShareTreeRow } from './shareBrowse';

/**
 * Tidying can only name what the scope let through: these tests give it exactly the rows a link would render, and check
 * that it invents none other.
 */

type Task = NonNullable<ShareTreeRow['version']['task']>;
type ShotSource = NonNullable<Task['shot']>;
type SequenceSource = ShotSource['sequence'];
type EpisodeSource = NonNullable<SequenceSource>['episode'];
type AssetSource = NonNullable<Task['asset']>;

const episode = (id: number, code: string, order: number): EpisodeSource => ({
  id,
  code,
  name: code,
  order,
});

const sequence = (id: number, code: string, order: number, ep: EpisodeSource = null): SequenceSource => ({
  id,
  code,
  name: code,
  order,
  episode: ep,
});

const shot = (id: number, code: string, order: number, seq: SequenceSource = null): ShotSource => ({
  id,
  code,
  name: code,
  order,
  sequence: seq,
});

/** A media carried by a shot. */
const onShot = (id: number, sh: ShotSource, thumbnailKey: string | null = 'thumb.jpg'): ShareTreeRow => ({
  id,
  thumbnailKey,
  version: { asset: null, task: { asset: null, shot: sh } },
});

/** A media carried by an asset: through its task, or through a version set directly. */
const onAsset = (id: number, asset: AssetSource, through: 'task' | 'version' = 'task'): ShareTreeRow => ({
  id,
  thumbnailKey: 'thumb.jpg',
  version: through === 'task' ? { asset: null, task: { asset, shot: null } } : { asset, task: null },
});

const FOX: AssetSource = { id: 90, name: 'Fox', type: 'CHARACTER', typeLabel: null };
const ZEBRA: AssetSource = { id: 91, name: 'Zebra', type: 'PROP', typeLabel: null };

describe('buildShareBrowse: what the client sees, tidied', () => {
  it('files a shot under its sequence, and the sequence under its episode', () => {
    const sq = sequence(10, 'SQ010', 1, episode(5, 'EP01', 1));
    const browse = buildShareBrowse([onShot(1, shot(20, 'SH020', 2, sq))]);

    expect(browse.shots.map((s) => s.code)).toEqual(['SH020']);
    expect(browse.sequences.map((s) => s.code)).toEqual(['SQ010']);
    expect(browse.episodes.map((e) => e.code)).toEqual(['EP01']);
    expect(browse.sequences[0]?.shotIds).toEqual([20]);
    expect(browse.episodes[0]?.sequenceIds).toEqual([10]);
  });

  /**
   * The heart of the scope: we tidy ONLY the rows received. A link that opens only one shot must not reveal the code of the
   * neighbouring shot, which the former flat list could not give away and the tree could.
   */
  it('names no entity that the received rows do not carry', () => {
    const browse = buildShareBrowse([onShot(1, shot(20, 'SH020', 2, sequence(10, 'SQ010', 1)))]);

    expect(JSON.stringify(browse)).not.toContain('SH030');
    expect(browse.shots).toHaveLength(1);
    expect(browse.sequences).toHaveLength(1);
    expect(browse.assets).toHaveLength(0);
  });

  it('does not invent a sequence for a shot that has none', () => {
    const browse = buildShareBrowse([onShot(1, shot(20, 'SH020', 2))]);
    expect(browse.sequences).toEqual([]);
    expect(browse.shots[0]?.sequenceId).toBeNull();
  });

  // A version hangs from an asset either through its task OR directly: two paths, one node.
  it('brings together on a single asset the two ways of being attached to it', () => {
    const browse = buildShareBrowse([onAsset(1, FOX, 'task'), onAsset(2, FOX, 'version')]);
    expect(browse.assets).toHaveLength(1);
    expect(browse.assets[0]?.mediaIds).toEqual([1, 2]);
  });

  it('picks as cover the first media that has a thumbnail', () => {
    const sh = shot(20, 'SH020', 2);
    const browse = buildShareBrowse([onShot(1, sh, null), onShot(2, sh, 'thumb.jpg')]);
    expect(browse.shots[0]?.coverMediaId).toBe(2);
  });

  it('leaves the cover null when no media has a thumbnail', () => {
    expect(buildShareBrowse([onShot(1, shot(20, 'SH020', 2), null)]).shots[0]?.coverMediaId).toBeNull();
  });

  // Degraded data: the media stays reachable, but no name is invented for it.
  it('keeps a media without a parent instead of losing it', () => {
    const orphan: ShareTreeRow = { id: 7, thumbnailKey: null, version: { asset: null, task: null } };
    const browse = buildShareBrowse([orphan]);
    expect(browse.looseMediaIds).toEqual([7]);
    expect(browse.shots).toEqual([]);
    expect(browse.assets).toEqual([]);
  });

  it('sorts shots and sequences in production order, assets by name', () => {
    const sqA = sequence(10, 'SQ010', 1);
    const sqB = sequence(11, 'SQ020', 2);
    const browse = buildShareBrowse([
      onShot(1, shot(21, 'SH030', 3, sqB)),
      onShot(2, shot(20, 'SH010', 1, sqA)),
      onAsset(3, ZEBRA),
      onAsset(4, FOX),
    ]);
    expect(browse.shots.map((s) => s.code)).toEqual(['SH010', 'SH030']);
    expect(browse.sequences.map((s) => s.code)).toEqual(['SQ010', 'SQ020']);
    expect(browse.assets.map((a) => a.name)).toEqual(['Fox', 'Zebra']);
  });

  it('brings up the media of a sequence, shots combined, in received order', () => {
    const sq = sequence(10, 'SQ010', 1);
    const browse = buildShareBrowse([
      onShot(1, shot(20, 'SH010', 1, sq)),
      onShot(2, shot(21, 'SH020', 2, sq)),
      onShot(3, shot(20, 'SH010', 1, sq)),
    ]);
    expect(browse.sequences[0]?.mediaIds).toEqual([1, 2, 3]);
    expect(browse.sequences[0]?.shotIds).toEqual([20, 21]);
  });
});
