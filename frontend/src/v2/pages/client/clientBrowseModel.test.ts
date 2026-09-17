// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type { ClientMedia, ShareBrowse, SharePlaylistCard } from '../../types/api';
import {
  coverUrl,
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

describe('parseClientView — où se trouve le visiteur', () => {
  it('sans paramètre, c’est l’accueil : l’adresse nue du lien est ce que le client recopie', () => {
    expect(parseClientView(params(''))).toEqual({ kind: 'home' });
  });

  it('lit un onglet connu, ignore un onglet inventé', () => {
    expect(parseClientView(params('tab=shots'))).toEqual({ kind: 'tab', tab: 'shots' });
    expect(parseClientView(params('tab=kanban'))).toEqual({ kind: 'home' });
  });

  it('va du plus précis au plus général : une entité l’emporte sur l’onglet', () => {
    expect(parseClientView(params('tab=shots&seq=4'))).toEqual({ kind: 'sequence', id: 4 });
    expect(parseClientView(params('shot=7'))).toEqual({ kind: 'shot', id: 7 });
    expect(parseClientView(params('asset=9'))).toEqual({ kind: 'asset', id: 9 });
    expect(parseClientView(params('pl=2'))).toEqual({ kind: 'playlist', id: 2 });
  });

  // Un identifiant bricolé ne doit pas ouvrir un écran vide : on retombe sur l'accueil.
  it('refuse un identifiant qui n’est pas un entier positif', () => {
    expect(parseClientView(params('seq=abc'))).toEqual({ kind: 'home' });
    expect(parseClientView(params('shot=0'))).toEqual({ kind: 'home' });
    expect(parseClientView(params('asset=-3'))).toEqual({ kind: 'home' });
    expect(parseClientView(params('pl=1.5'))).toEqual({ kind: 'home' });
  });

  it('lit le média ouvert indépendamment de la vue', () => {
    expect(parseClientMediaId(params('tab=review&m=12'))).toBe(12);
    expect(parseClientMediaId(params('tab=review'))).toBeNull();
    expect(parseClientMediaId(params('m=nope'))).toBeNull();
  });
});

describe('viewParams — ce que l’URL porte', () => {
  it('n’écrit rien pour l’accueil', () => {
    expect(viewParams({ kind: 'home' })).toEqual({});
  });

  it('écrit la vue, et le média ouvert quand il y en a un', () => {
    expect(viewParams({ kind: 'tab', tab: 'assets' })).toEqual({ tab: 'assets' });
    expect(viewParams({ kind: 'shot', id: 7 }, 12)).toEqual({ shot: '7', m: '12' });
    expect(viewParams({ kind: 'playlist', id: 2 }, null)).toEqual({ pl: '2' });
  });

  it('fait l’aller-retour avec la lecture', () => {
    const view = { kind: 'sequence', id: 4 } as const;
    expect(parseClientView(new URLSearchParams(viewParams(view)))).toEqual(view);
  });
});

describe('visibleTabs — un onglet vide ne s’affiche pas', () => {
  it('ne propose rien quand le lien n’ouvre aucun média', () => {
    expect(visibleTabs([], browse({ shots: [] }))).toEqual([]);
  });

  it('propose Review dès qu’il y a un média, même sans arborescence', () => {
    expect(visibleTabs([media(1)], undefined)).toEqual(['review']);
  });

  // Un lien qui ne partage qu'un asset ne doit pas nommer « Sequences » ni « Shots ».
  it('n’ouvre que les niveaux réellement peuplés', () => {
    const only = browse({
      assets: [{ id: 90, name: 'Fox', type: 'CHARACTER', typeLabel: null, mediaIds: [1], coverMediaId: 1 }],
    });
    expect(visibleTabs([media(1)], only)).toEqual(['review', 'assets']);
  });
});

describe('résolution des identifiants en tuiles', () => {
  it('garde l’ordre demandé', () => {
    expect(mediaByIds([media(1), media(2), media(3)], [3, 1]).map((m) => m.id)).toEqual([3, 1]);
  });

  // Un identifiant au-delà de la page servie : mieux vaut aucune tuile qu'une tuile vide.
  it('ignore un identifiant absent de la page servie', () => {
    expect(mediaByIds([media(1)], [1, 999]).map((m) => m.id)).toEqual([1]);
  });

  it('prend la couverture dans les vignettes déjà signées', () => {
    expect(coverUrl([media(1, 'thumb-1')], 1)).toBe('thumb-1');
    expect(coverUrl([media(1, null)], 1)).toBeNull();
    expect(coverUrl([media(1)], null)).toBeNull();
    expect(coverUrl([media(1)], 42)).toBeNull();
  });
});

describe('mediaOfView — ce que la vue courante montre', () => {
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

  it('rend tout à plat sur Review, et rien sur les onglets de niveau', () => {
    expect(mediaOfView({ kind: 'tab', tab: 'review' }, all, tree, playlists)).toHaveLength(3);
    expect(mediaOfView({ kind: 'tab', tab: 'sequences' }, all, tree, playlists)).toEqual([]);
    expect(mediaOfView({ kind: 'home' }, all, tree, playlists)).toEqual([]);
  });

  it('rend les médias du nœud ouvert, playlist comprise, dans son ordre', () => {
    expect(mediaOfView({ kind: 'sequence', id: 10 }, all, tree, playlists).map((m) => m.id)).toEqual([1, 2]);
    expect(mediaOfView({ kind: 'shot', id: 20 }, all, tree, playlists).map((m) => m.id)).toEqual([2]);
    expect(mediaOfView({ kind: 'asset', id: 90 }, all, tree, playlists).map((m) => m.id)).toEqual([3]);
    expect(mediaOfView({ kind: 'playlist', id: 5 }, all, tree, playlists).map((m) => m.id)).toEqual([2, 1]);
  });

  // Un lien recopié qui pointe une entité hors portée : écran vide, jamais « tout le projet ».
  it('ne retombe sur rien quand le nœud demandé n’existe pas', () => {
    expect(mediaOfView({ kind: 'shot', id: 999 }, all, tree, playlists)).toEqual([]);
    expect(mediaOfView({ kind: 'sequence', id: 999 }, all, undefined, playlists)).toEqual([]);
  });

  it('remonte les plans d’une séquence, et rien pour une séquence inconnue', () => {
    expect(shotsOfSequence(tree, 10).map((s) => s.code)).toEqual(['SH020']);
    expect(shotsOfSequence(tree, 999)).toEqual([]);
    expect(shotsOfSequence(undefined, 10)).toEqual([]);
  });
});
