// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { buildShareBrowse, type ShareTreeRow } from './shareBrowse';

/**
 * Le rangement ne peut nommer que ce que la portée a laissé passer : ces tests lui donnent
 * exactement les lignes qu'un lien rendrait, et vérifient qu'il n'en invente aucune autre.
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

/** Un média porté par un plan. */
const onShot = (id: number, sh: ShotSource, thumbnailKey: string | null = 'thumb.jpg'): ShareTreeRow => ({
  id,
  thumbnailKey,
  version: { asset: null, task: { asset: null, shot: sh } },
});

/** Un média porté par un asset — par sa tâche, ou par une version posée directement. */
const onAsset = (id: number, asset: AssetSource, through: 'task' | 'version' = 'task'): ShareTreeRow => ({
  id,
  thumbnailKey: 'thumb.jpg',
  version: through === 'task' ? { asset: null, task: { asset, shot: null } } : { asset, task: null },
});

const FOX: AssetSource = { id: 90, name: 'Fox', type: 'CHARACTER', typeLabel: null };
const ZEBRA: AssetSource = { id: 91, name: 'Zebra', type: 'PROP', typeLabel: null };

describe('buildShareBrowse — ce que le client voit rangé', () => {
  it('range un plan sous sa séquence, et la séquence sous son épisode', () => {
    const sq = sequence(10, 'SQ010', 1, episode(5, 'EP01', 1));
    const browse = buildShareBrowse([onShot(1, shot(20, 'SH020', 2, sq))]);

    expect(browse.shots.map((s) => s.code)).toEqual(['SH020']);
    expect(browse.sequences.map((s) => s.code)).toEqual(['SQ010']);
    expect(browse.episodes.map((e) => e.code)).toEqual(['EP01']);
    expect(browse.sequences[0]?.shotIds).toEqual([20]);
    expect(browse.episodes[0]?.sequenceIds).toEqual([10]);
  });

  /**
   * Le cœur de la portée : on ne range QUE les lignes reçues. Un lien qui n'ouvre qu'un plan
   * ne doit pas révéler le code du plan voisin — ce que l'ancienne liste plate ne pouvait pas
   * trahir, et que l'arborescence pourrait.
   */
  it('ne nomme aucune entité que les lignes reçues ne portent pas', () => {
    const browse = buildShareBrowse([onShot(1, shot(20, 'SH020', 2, sequence(10, 'SQ010', 1)))]);

    expect(JSON.stringify(browse)).not.toContain('SH030');
    expect(browse.shots).toHaveLength(1);
    expect(browse.sequences).toHaveLength(1);
    expect(browse.assets).toHaveLength(0);
  });

  it('n’invente pas de séquence pour un plan qui n’en a pas', () => {
    const browse = buildShareBrowse([onShot(1, shot(20, 'SH020', 2))]);
    expect(browse.sequences).toEqual([]);
    expect(browse.shots[0]?.sequenceId).toBeNull();
  });

  // Une version pend à un asset par sa tâche OU directement : deux chemins, un seul nœud.
  it('réunit sur un seul asset les deux façons d’y être rattaché', () => {
    const browse = buildShareBrowse([onAsset(1, FOX, 'task'), onAsset(2, FOX, 'version')]);
    expect(browse.assets).toHaveLength(1);
    expect(browse.assets[0]?.mediaIds).toEqual([1, 2]);
  });

  it('choisit pour couverture le premier média qui a une miniature', () => {
    const sh = shot(20, 'SH020', 2);
    const browse = buildShareBrowse([onShot(1, sh, null), onShot(2, sh, 'thumb.jpg')]);
    expect(browse.shots[0]?.coverMediaId).toBe(2);
  });

  it('laisse la couverture nulle quand aucun média n’a de miniature', () => {
    expect(buildShareBrowse([onShot(1, shot(20, 'SH020', 2), null)]).shots[0]?.coverMediaId).toBeNull();
  });

  // Donnée dégradée : le média reste atteignable, mais aucun nom n'est inventé pour lui.
  it('garde un média sans parent au lieu de le perdre', () => {
    const orphan: ShareTreeRow = { id: 7, thumbnailKey: null, version: { asset: null, task: null } };
    const browse = buildShareBrowse([orphan]);
    expect(browse.looseMediaIds).toEqual([7]);
    expect(browse.shots).toEqual([]);
    expect(browse.assets).toEqual([]);
  });

  it('trie les plans et les séquences dans l’ordre de production, les assets par nom', () => {
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

  it('remonte les médias d’une séquence, plans confondus, dans l’ordre reçu', () => {
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
