// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ClientMedia, ShareBrowse, SharePlaylistCard } from '../../types/api';

/**
 * Ce que la page publique affiche, et où l'on se trouve dedans — **pur**, donc testable.
 *
 * Deux règles tiennent tout le module :
 *  - une tuile de média n'existe qu'une fois, dans le tableau `media` du partage ; les nœuds
 *    (playlist, séquence, plan, asset) ne portent que des identifiants, qu'on résout ici ;
 *  - **un onglet vide ne s'affiche pas**. La page d'un lien qui ne partage qu'un asset ne
 *    doit pas proposer « Sequences » et « Shots » pour rien : ce que le lien n'ouvre pas ne
 *    doit même pas être nommé.
 */

export type ClientTab = 'review' | 'sequences' | 'shots' | 'assets';

/** L'endroit où se trouve le visiteur. L'accueil est l'état de repos. */
export type ClientView =
  | { kind: 'home' }
  | { kind: 'tab'; tab: ClientTab }
  | { kind: 'sequence'; id: number }
  | { kind: 'shot'; id: number }
  | { kind: 'asset'; id: number }
  | { kind: 'playlist'; id: number };

export const HOME: ClientView = { kind: 'home' };

const TABS: readonly ClientTab[] = ['review', 'sequences', 'shots', 'assets'];

const isTab = (value: string | null): value is ClientTab =>
  value !== null && (TABS as readonly string[]).includes(value);

/** Entier strictement positif d'un paramètre d'URL, sinon `null` (un `?seq=abc` ne navigue pas). */
function idParam(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Lit la vue dans l'URL. L'ordre de priorité va du plus précis au plus général : un lien
 * recopié qui porte à la fois `?tab=` et `?shot=` ouvre le plan, pas l'onglet.
 */
export function parseClientView(params: URLSearchParams): ClientView {
  const sequence = idParam(params, 'seq');
  if (sequence !== null) return { kind: 'sequence', id: sequence };
  const shot = idParam(params, 'shot');
  if (shot !== null) return { kind: 'shot', id: shot };
  const asset = idParam(params, 'asset');
  if (asset !== null) return { kind: 'asset', id: asset };
  const playlist = idParam(params, 'pl');
  if (playlist !== null) return { kind: 'playlist', id: playlist };
  const tab = params.get('tab');
  return isTab(tab) ? { kind: 'tab', tab } : HOME;
}

/** Média ouvert dans le viewer, indépendant de la vue de navigation sous-jacente. */
export function parseClientMediaId(params: URLSearchParams): number | null {
  return idParam(params, 'm');
}

/**
 * Paramètres d'URL d'une vue. L'accueil n'en porte aucun : l'adresse nue du lien est
 * l'accueil, et c'est ce que le destinataire recopie.
 */
export function viewParams(view: ClientView, mediaId?: number | null): Record<string, string> {
  const params: Record<string, string> = {};
  switch (view.kind) {
    case 'tab':
      params.tab = view.tab;
      break;
    case 'sequence':
      params.seq = String(view.id);
      break;
    case 'shot':
      params.shot = String(view.id);
      break;
    case 'asset':
      params.asset = String(view.id);
      break;
    case 'playlist':
      params.pl = String(view.id);
      break;
    case 'home':
      break;
  }
  if (mediaId != null) params.m = String(mediaId);
  return params;
}

/**
 * Onglets réellement peuplés. « Review » apparaît dès qu'il y a un média — c'est la vue à
 * plat, celle qui ne peut jamais mentir sur ce que le lien contient.
 */
export function visibleTabs(media: readonly ClientMedia[], browse: ShareBrowse | undefined): ClientTab[] {
  if (media.length === 0) return [];
  const tabs: ClientTab[] = ['review'];
  if (browse?.sequences.length) tabs.push('sequences');
  if (browse?.shots.length) tabs.push('shots');
  if (browse?.assets.length) tabs.push('assets');
  return tabs;
}

/**
 * Résout des identifiants en tuiles, dans l'ordre demandé. Un identifiant absent du tableau
 * `media` est ignoré : il désigne un média hors de la page servie, et une tuile vide vaut
 * moins que pas de tuile.
 */
export function mediaByIds(media: readonly ClientMedia[], ids: readonly number[]): ClientMedia[] {
  const byId = new Map(media.map((m) => [m.id, m]));
  return ids.map((id) => byId.get(id)).filter((m): m is ClientMedia => m !== undefined);
}

/** Vignette de couverture d'un nœud : celle d'un média déjà signé, jamais une URL de plus. */
export function coverUrl(media: readonly ClientMedia[], coverMediaId: number | null): string | null {
  if (coverMediaId === null) return null;
  return media.find((m) => m.id === coverMediaId)?.thumbnailUrl ?? null;
}

/** Les plans d'une séquence, dans l'ordre de production. */
export function shotsOfSequence(browse: ShareBrowse | undefined, sequenceId: number) {
  const sequence = browse?.sequences.find((s) => s.id === sequenceId);
  if (!sequence) return [];
  return sequence.shotIds
    .map((id) => browse?.shots.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);
}

/** Les médias que la vue courante montre, déjà résolus et ordonnés. */
export function mediaOfView(
  view: ClientView,
  media: readonly ClientMedia[],
  browse: ShareBrowse | undefined,
  playlists: readonly SharePlaylistCard[],
): ClientMedia[] {
  switch (view.kind) {
    case 'tab':
      return view.tab === 'review' ? [...media] : [];
    case 'sequence':
      return mediaByIds(media, browse?.sequences.find((s) => s.id === view.id)?.mediaIds ?? []);
    case 'shot':
      return mediaByIds(media, browse?.shots.find((s) => s.id === view.id)?.mediaIds ?? []);
    case 'asset':
      return mediaByIds(media, browse?.assets.find((a) => a.id === view.id)?.mediaIds ?? []);
    case 'playlist':
      return mediaByIds(media, playlists.find((p) => p.id === view.id)?.mediaIds ?? []);
    case 'home':
      return [];
  }
}

/** Nombre de médias de l'accueil : assez pour donner le ton, pas assez pour noyer. */
export const HOME_MEDIA_COUNT = 12;
