// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type { ClientMedia, ShareBrowse, SharePlaylistCard } from '../../types/api';
import {
  coverUrl,
  filterMedia,
  pendingMedia,
  sortMedia,
  mediaByIds,
  mediaOfView,
  parseClientMediaId,
  parseClientView,
  shotsOfSequence,
  viewParams,
  visibleTabs,
} from './clientBrowseModel';

const media = (id: number, thumbnailUrl: string | null = `t${id}`): ClientMedia => ({
  id,
  kind: 'VIDEO',
  originalName: `m${id}.mp4`,
  thumbnailUrl,
  createdAt: '2026-09-16T00:00:00.000Z',
  version: { id: id * 10, name: 'V01', taskName: null },
  decided: false,
  placement: { episodeId: null, sequenceId: null, shotId: null, assetId: null },
});

const browse = (over: Partial<ShareBrowse> = {}): ShareBrowse => ({
  playlists: [],
  episodes: [],
  sequences: [],
  shots: [],
  assets: [],
  looseMediaIds: [],
  ...over,
});

const params = (query: string) => new URLSearchParams(query);

describe('parseClientView — where the visitor is', () => {
  it('without a parameter it is home: the bare link address is what the client copies', () => {
    expect(parseClientView(params(''))).toEqual({ kind: 'home' });
  });

  it('reads a known tab and ignores an invented one', () => {
    expect(parseClientView(params('tab=shots'))).toEqual({ kind: 'tab', tab: 'shots' });
    expect(parseClientView(params('tab=kanban'))).toEqual({ kind: 'home' });
  });

  it('goes from most specific to most general: an entity wins over the tab', () => {
    expect(parseClientView(params('tab=shots&seq=4'))).toEqual({ kind: 'sequence', id: 4 });
    expect(parseClientView(params('shot=7'))).toEqual({ kind: 'shot', id: 7 });
    expect(parseClientView(params('asset=9'))).toEqual({ kind: 'asset', id: 9 });
    expect(parseClientView(params('pl=2'))).toEqual({ kind: 'playlist', id: 2 });
  });

  // A tampered identifier must not open an empty screen: fall back to home.
  it('rejects an identifier that is not a positive integer', () => {
    expect(parseClientView(params('seq=abc'))).toEqual({ kind: 'home' });
    expect(parseClientView(params('shot=0'))).toEqual({ kind: 'home' });
    expect(parseClientView(params('asset=-3'))).toEqual({ kind: 'home' });
    expect(parseClientView(params('pl=1.5'))).toEqual({ kind: 'home' });
  });

  it('reads the open media regardless of the view', () => {
    expect(parseClientMediaId(params('tab=review&m=12'))).toBe(12);
    expect(parseClientMediaId(params('tab=review'))).toBeNull();
    expect(parseClientMediaId(params('m=nope'))).toBeNull();
  });
});

describe('viewParams — what the URL carries', () => {
  it('writes nothing for home', () => {
    expect(viewParams({ kind: 'home' })).toEqual({});
  });

  it('writes the view, and the open media when there is one', () => {
    expect(viewParams({ kind: 'tab', tab: 'assets' })).toEqual({ tab: 'assets' });
    expect(viewParams({ kind: 'shot', id: 7 }, 12)).toEqual({ shot: '7', m: '12' });
    expect(viewParams({ kind: 'playlist', id: 2 }, null)).toEqual({ pl: '2' });
  });

  it('round-trips through reading', () => {
    const view = { kind: 'sequence', id: 4 } as const;
    expect(parseClientView(new URLSearchParams(viewParams(view)))).toEqual(view);
  });
});

describe('visibleTabs — an empty tab is not shown', () => {
  it('offers nothing when the link opens no media', () => {
    expect(visibleTabs([], browse({ shots: [] }))).toEqual([]);
  });

  it('offers Review as soon as there is a media, even without a tree', () => {
    expect(visibleTabs([media(1)], undefined)).toEqual(['review']);
  });

  // A link sharing only an asset must not name "Sequences" or "Shots".
  it('opens only the levels that are actually populated', () => {
    const only = browse({
      assets: [{ id: 90, name: 'Fox', type: 'CHARACTER', typeLabel: null, mediaIds: [1], coverMediaId: 1 }],
    });
    expect(visibleTabs([media(1)], only)).toEqual(['review', 'assets']);
  });
});

describe('resolving identifiers into tiles', () => {
  it('keeps the requested order', () => {
    expect(mediaByIds([media(1), media(2), media(3)], [3, 1]).map((m) => m.id)).toEqual([3, 1]);
  });

  // An identifier beyond the served page: better no tile than an empty one.
  it('ignores an identifier absent from the served page', () => {
    expect(mediaByIds([media(1)], [1, 999]).map((m) => m.id)).toEqual([1]);
  });

  it('takes the cover from the thumbnails already signed', () => {
    expect(coverUrl([media(1, 'thumb-1')], 1)).toBe('thumb-1');
    expect(coverUrl([media(1, null)], 1)).toBeNull();
    expect(coverUrl([media(1)], null)).toBeNull();
    expect(coverUrl([media(1)], 42)).toBeNull();
  });
});

describe('mediaOfView — what the current view shows', () => {
  const all = [media(1), media(2), media(3)];
  const tree = browse({
    sequences: [
      {
        id: 10,
        code: 'SQ010',
        name: 'SQ010',
        order: 1,
        episodeId: null,
        shotIds: [20],
        mediaIds: [1, 2],
        coverMediaId: 1,
      },
    ],
    shots: [
      { id: 20, code: 'SH020', name: 'SH020', order: 1, sequenceId: 10, mediaIds: [2], coverMediaId: 2 },
    ],
    assets: [{ id: 90, name: 'Fox', type: 'CHARACTER', typeLabel: null, mediaIds: [3], coverMediaId: 3 }],
  });
  const playlists: SharePlaylistCard[] = [
    {
      id: 5,
      name: 'Dailies',
      updatedAt: '2026-09-16T00:00:00.000Z',
      itemCount: 2,
      mediaIds: [2, 1],
      coverMediaIds: [2],
    },
  ];

  it('renders everything flat on Review, and nothing on the level tabs', () => {
    expect(mediaOfView({ kind: 'tab', tab: 'review' }, all, tree, playlists)).toHaveLength(3);
    expect(mediaOfView({ kind: 'tab', tab: 'sequences' }, all, tree, playlists)).toEqual([]);
    expect(mediaOfView({ kind: 'home' }, all, tree, playlists)).toEqual([]);
  });

  it('renders the media of the open node, playlist included, in order', () => {
    expect(mediaOfView({ kind: 'sequence', id: 10 }, all, tree, playlists).map((m) => m.id)).toEqual([1, 2]);
    expect(mediaOfView({ kind: 'shot', id: 20 }, all, tree, playlists).map((m) => m.id)).toEqual([2]);
    expect(mediaOfView({ kind: 'asset', id: 90 }, all, tree, playlists).map((m) => m.id)).toEqual([3]);
    expect(mediaOfView({ kind: 'playlist', id: 5 }, all, tree, playlists).map((m) => m.id)).toEqual([2, 1]);
  });

  // A copied link pointing to an out-of-scope entity: an empty screen, never "the whole project".
  it('falls back to nothing when the requested node does not exist', () => {
    expect(mediaOfView({ kind: 'shot', id: 999 }, all, tree, playlists)).toEqual([]);
    expect(mediaOfView({ kind: 'sequence', id: 999 }, all, undefined, playlists)).toEqual([]);
  });

  it('lists the shots of a sequence, and nothing for an unknown sequence', () => {
    expect(shotsOfSequence(tree, 10).map((s) => s.code)).toEqual(['SH020']);
    expect(shotsOfSequence(tree, 999)).toEqual([]);
    expect(shotsOfSequence(undefined, 10)).toEqual([]);
  });
});

describe('filterMedia — what someone typing in the field is looking for', () => {
  const tree = browse({
    shots: [
      {
        id: 20,
        code: 'SH0240',
        name: 'Rooftop run',
        order: 1,
        sequenceId: 10,
        mediaIds: [1],
        coverMediaId: 1,
      },
    ],
    sequences: [
      {
        id: 10,
        code: 'SQ010',
        name: 'Cold open',
        order: 1,
        episodeId: null,
        shotIds: [20],
        mediaIds: [1],
        coverMediaId: 1,
      },
    ],
    assets: [{ id: 90, name: 'Fox', type: 'CHARACTER', typeLabel: null, mediaIds: [2], coverMediaId: 2 }],
  });
  const onShot = { ...media(1), placement: { episodeId: null, sequenceId: 10, shotId: 20, assetId: null } };
  const onAsset = {
    ...media(2),
    placement: { episodeId: null, sequenceId: null, shotId: null, assetId: 90 },
  };
  const all = [onShot, onAsset];

  it('returns everything when the search is empty', () => {
    expect(filterMedia(all, tree, '   ')).toHaveLength(2);
  });

  /**
   * The case that justifies the field: "SH0240" appears nowhere in the file name, yet it is
   * what a client types, since that is how the studio named the shot to them.
   */
  it('finds a shot by its code, which is absent from the file name', () => {
    expect(filterMedia(all, tree, 'SH0240').map((m) => m.id)).toEqual([1]);
    expect(onShot.originalName).not.toContain('SH0240');
  });

  it('also finds by sequence, asset and file name, case-insensitively', () => {
    expect(filterMedia(all, tree, 'cold open').map((m) => m.id)).toEqual([1]);
    expect(filterMedia(all, tree, 'fox').map((m) => m.id)).toEqual([2]);
    expect(filterMedia(all, tree, 'M1.MP4').map((m) => m.id)).toEqual([1]);
  });

  it('returns nothing rather than everything when nothing matches', () => {
    expect(filterMedia(all, tree, 'SH9999')).toEqual([]);
  });
});

describe('sortMedia — the three reading orders', () => {
  const tree = browse({
    sequences: [
      {
        id: 10,
        code: 'SQ010',
        name: 'A',
        order: 1,
        episodeId: null,
        shotIds: [20],
        mediaIds: [],
        coverMediaId: null,
      },
      {
        id: 11,
        code: 'SQ020',
        name: 'B',
        order: 2,
        episodeId: null,
        shotIds: [21],
        mediaIds: [],
        coverMediaId: null,
      },
    ],
    shots: [
      { id: 20, code: 'SH010', name: 'A', order: 1, sequenceId: 10, mediaIds: [], coverMediaId: null },
      { id: 21, code: 'SH020', name: 'B', order: 2, sequenceId: 11, mediaIds: [], coverMediaId: null },
    ],
  });
  const at = (id: number, name: string, sequenceId: number | null, shotId: number | null) => ({
    ...media(id),
    originalName: name,
    placement: { episodeId: null, sequenceId, shotId, assetId: null },
  });
  // Served newest first, so in the reverse order of production.
  const served = [at(3, 'c.mp4', 11, 21), at(2, 'b.mp4', 10, 20), at(1, 'a.mp4', null, null)];

  it('keeps the server order for "most recent"', () => {
    expect(sortMedia(served, tree, 'recent').map((m) => m.id)).toEqual([3, 2, 1]);
  });

  it('sorts by name', () => {
    expect(sortMedia(served, tree, 'name').map((m) => m.originalName)).toEqual(['a.mp4', 'b.mp4', 'c.mp4']);
  });

  // The order in which a film is watched: sequence, then shot.
  it('follows production order, and puts at the end what it cannot place', () => {
    expect(sortMedia(served, tree, 'production').map((m) => m.id)).toEqual([2, 3, 1]);
  });

  it('does not mutate the array it receives', () => {
    const before = served.map((m) => m.id);
    sortMedia(served, tree, 'name');
    expect(served.map((m) => m.id)).toEqual(before);
  });
});

describe('pendingMedia — the "awaiting your answer" queue', () => {
  const answered = { ...media(1), decided: true };
  const waiting = { ...media(2), decided: false };

  it('keeps only what the link has not yet given a verdict on', () => {
    expect(pendingMedia([answered, waiting], true).map((m) => m.id)).toEqual([2]);
  });

  /**
   * A link without decision rights has no queue: announcing "awaiting your answer" would ask
   * it for something it is not allowed to give.
   */
  it('offers none to a link that is not allowed to give a verdict', () => {
    expect(pendingMedia([answered, waiting], false)).toEqual([]);
  });
});
