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

describe('filterMedia — ce que cherche quelqu’un qui tape dans le champ', () => {
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

  it('rend tout quand la recherche est vide', () => {
    expect(filterMedia(all, tree, '   ')).toHaveLength(2);
  });

  /**
   * Le cas qui justifie le champ : « SH0240 » n'est nulle part dans le nom du fichier, mais
   * c'est ce qu'un client tape — c'est ainsi que le studio lui a parlé du plan.
   */
  it('trouve par le code du plan, absent du nom de fichier', () => {
    expect(filterMedia(all, tree, 'SH0240').map((m) => m.id)).toEqual([1]);
    expect(onShot.originalName).not.toContain('SH0240');
  });

  it('trouve aussi par séquence, par asset et par nom de fichier, sans tenir compte de la casse', () => {
    expect(filterMedia(all, tree, 'cold open').map((m) => m.id)).toEqual([1]);
    expect(filterMedia(all, tree, 'fox').map((m) => m.id)).toEqual([2]);
    expect(filterMedia(all, tree, 'M1.MP4').map((m) => m.id)).toEqual([1]);
  });

  it('ne rend rien plutôt que tout quand rien ne correspond', () => {
    expect(filterMedia(all, tree, 'SH9999')).toEqual([]);
  });
});

describe('sortMedia — les trois ordres de lecture', () => {
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
  // Servi du plus récent au plus ancien, donc dans l'ordre inverse de la production.
  const served = [at(3, 'c.mp4', 11, 21), at(2, 'b.mp4', 10, 20), at(1, 'a.mp4', null, null)];

  it('laisse l’ordre du serveur pour « plus récent »', () => {
    expect(sortMedia(served, tree, 'recent').map((m) => m.id)).toEqual([3, 2, 1]);
  });

  it('classe par nom', () => {
    expect(sortMedia(served, tree, 'name').map((m) => m.originalName)).toEqual(['a.mp4', 'b.mp4', 'c.mp4']);
  });

  // L'ordre dans lequel un film se regarde : séquence, puis plan.
  it('remonte l’ordre de production, et range à la fin ce qu’il ne situe pas', () => {
    expect(sortMedia(served, tree, 'production').map((m) => m.id)).toEqual([2, 3, 1]);
  });

  it('ne modifie pas le tableau reçu', () => {
    const before = served.map((m) => m.id);
    sortMedia(served, tree, 'name');
    expect(served.map((m) => m.id)).toEqual(before);
  });
});

describe('pendingMedia — la file « en attente de votre réponse »', () => {
  const answered = { ...media(1), decided: true };
  const waiting = { ...media(2), decided: false };

  it('ne retient que ce sur quoi le lien ne s’est pas prononcé', () => {
    expect(pendingMedia([answered, waiting], true).map((m) => m.id)).toEqual([2]);
  });

  /**
   * Un lien sans droit de décision n'a pas de file : lui annoncer « en attente de votre
   * réponse » serait lui demander ce qu'on ne lui permet pas de donner.
   */
  it('n’en propose aucune à un lien qui n’a pas le droit de se prononcer', () => {
    expect(pendingMedia([answered, waiting], false)).toEqual([]);
  });
});
