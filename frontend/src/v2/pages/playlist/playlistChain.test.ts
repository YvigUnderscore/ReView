// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it } from 'vitest';
import type { PlaylistItemEntry } from '../../types/api';
import { itemIndexOfMedia, loadAutoAdvance, nextPlayableAfterMedia, saveAutoAdvance } from './playlistChain';

/** Playlist item: a version, with or without a visible media. */
const item = (id: number, mediaId: number | null): PlaylistItemEntry => ({
  id,
  order: id,
  version: { id: id * 10, name: `v00${id}`, location: `SQ · SH${id}`, mediaCount: 1, reviewStatus: null },
  media:
    mediaId === null ? null : { id: mediaId, kind: 'VIDEO', originalName: `sh${id}.mov`, thumbnailUrl: null },
});

const items = [item(1, 101), item(2, null), item(3, 103), item(4, 104)];

describe('itemIndexOfMedia', () => {
  it('finds the place of the displayed media', () => {
    expect(itemIndexOfMedia(items, 103)).toBe(2);
  });

  it('media outside the playlist: no place', () => {
    expect(itemIndexOfMedia(items, 999)).toBe(-1);
  });
});

describe('nextPlayableAfterMedia', () => {
  it('skips versions without a visible media', () => {
    expect(nextPlayableAfterMedia(items, 101)?.media?.id).toBe(103);
  });

  it('chains onto the immediate neighbour', () => {
    expect(nextPlayableAfterMedia(items, 103)?.media?.id).toBe(104);
  });

  it('last shot: playback stops there', () => {
    expect(nextPlayableAfterMedia(items, 104)).toBeNull();
  });

  it('media outside the playlist: nothing to chain', () => {
    expect(nextPlayableAfterMedia(items, 999)).toBeNull();
    expect(nextPlayableAfterMedia([], 101)).toBeNull();
  });
});

describe('chaining toggle', () => {
  beforeEach(() => localStorage.clear());

  it('armed by default', () => {
    expect(loadAutoAdvance()).toBe(true);
  });

  it('the choice survives a reload', () => {
    saveAutoAdvance(false);
    expect(loadAutoAdvance()).toBe(false);
    saveAutoAdvance(true);
    expect(loadAutoAdvance()).toBe(true);
  });
});
