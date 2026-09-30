// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';
import type { PlaylistItemEntry } from '../../types/api';
import { itemIndexOfMedia, loadAutoAdvance, nextPlayableAfterMedia, saveAutoAdvance } from './playlistChain';

/** Item de playlist : une version, avec ou sans média visible. */
const item = (id: number, mediaId: number | null): PlaylistItemEntry => ({
  id,
  order: id,
  version: { id: id * 10, name: `v00${id}`, location: `SQ · SH${id}`, mediaCount: 1, reviewStatus: null },
  media:
    mediaId === null ? null : { id: mediaId, kind: 'VIDEO', originalName: `sh${id}.mov`, thumbnailUrl: null },
});

const items = [item(1, 101), item(2, null), item(3, 103), item(4, 104)];

describe('itemIndexOfMedia', () => {
  it('retrouve la place du média affiché', () => {
    expect(itemIndexOfMedia(items, 103)).toBe(2);
  });

  it('média étranger à la playlist : pas de place', () => {
    expect(itemIndexOfMedia(items, 999)).toBe(-1);
  });
});

describe('nextPlayableAfterMedia', () => {
  it('saute les versions sans média visible', () => {
    expect(nextPlayableAfterMedia(items, 101)?.media?.id).toBe(103);
  });

  it('enchaîne sur le voisin immédiat', () => {
    expect(nextPlayableAfterMedia(items, 103)?.media?.id).toBe(104);
  });

  it('dernier plan : la lecture s’arrête là', () => {
    expect(nextPlayableAfterMedia(items, 104)).toBeNull();
  });

  it('média hors playlist : rien à enchaîner', () => {
    expect(nextPlayableAfterMedia(items, 999)).toBeNull();
    expect(nextPlayableAfterMedia([], 101)).toBeNull();
  });
});

describe('bascule d’enchaînement', () => {
  beforeEach(() => localStorage.clear());

  it('armée par défaut', () => {
    expect(loadAutoAdvance()).toBe(true);
  });

  it('le choix survit au rechargement', () => {
    saveAutoAdvance(false);
    expect(loadAutoAdvance()).toBe(false);
    saveAutoAdvance(true);
    expect(loadAutoAdvance()).toBe(true);
  });
});
