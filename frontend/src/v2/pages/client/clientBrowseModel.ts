// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ClientMedia, ShareBrowse, SharePlaylistCard } from '../../types/api';

/**
 * What the public page displays, and where one is within it: **pure**, so testable.
 *
 * Two rules hold the whole module:
 *  - a media tile exists only once, in the `media` array of the share; the nodes (playlist,
 *    sequence, shot, asset) only carry identifiers, which are resolved here;
 *  - **an empty tab is not shown**. The page of a link sharing only an asset must not offer
 *    "Sequences" and "Shots" for nothing: what the link does not open must not even be named.
 */

export type ClientTab = 'review' | 'sequences' | 'shots' | 'assets';

/** Where the visitor is. Home is the resting state. */
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

/** Strictly positive integer from a URL parameter, otherwise `null` (a `?seq=abc` does not navigate). */
function idParam(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null) return null;
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Reads the view from the URL. Priority goes from most specific to most general: a copied
 * link carrying both `?tab=` and `?shot=` opens the shot, not the tab.
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

/** Media open in the viewer, independent of the underlying navigation view. */
export function parseClientMediaId(params: URLSearchParams): number | null {
  return idParam(params, 'm');
}

/**
 * URL parameters of a view. Home carries none: the bare link address is home, and that is
 * what the recipient copies.
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
 * Tabs actually populated. "Review" appears as soon as there is a media: it is the flat view,
 * the one that can never misrepresent what the link contains.
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
 * Resolves identifiers into tiles, in the requested order. An identifier absent from the
 * `media` array is ignored: it designates a media outside the served page, and an empty tile
 * is worth less than no tile.
 */
export function mediaByIds(media: readonly ClientMedia[], ids: readonly number[]): ClientMedia[] {
  const byId = new Map(media.map((m) => [m.id, m]));
  return ids.map((id) => byId.get(id)).filter((m): m is ClientMedia => m !== undefined);
}

/** Cover thumbnail of a node: that of an already-signed media, never one more URL. */
export function coverUrl(media: readonly ClientMedia[], coverMediaId: number | null): string | null {
  if (coverMediaId === null) return null;
  return media.find((m) => m.id === coverMediaId)?.thumbnailUrl ?? null;
}

/** The shots of a sequence, in production order. */
export function shotsOfSequence(browse: ShareBrowse | undefined, sequenceId: number) {
  const sequence = browse?.sequences.find((s) => s.id === sequenceId);
  if (!sequence) return [];
  return sequence.shotIds
    .map((id) => browse?.shots.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);
}

/** The media the current view shows, already resolved and ordered. */
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

/** Number of home media: enough to set the tone, not enough to drown the page. */
export const HOME_MEDIA_COUNT = 12;

/** Reading orders offered to the client. */
export type ClientSort = 'recent' | 'name' | 'production';

export const CLIENT_SORTS: readonly ClientSort[] = ['recent', 'name', 'production'];

export const isClientSort = (value: string | null): value is ClientSort =>
  value !== null && (CLIENT_SORTS as readonly string[]).includes(value);

/**
 * Free-text filter: file name, version name, task name and, most usefully, **code and name
 * of the shot or asset** carrying the media. Someone searching for "SH0240" types something
 * that appears nowhere in the file name.
 */
export function filterMedia(
  media: readonly ClientMedia[],
  browse: ShareBrowse | undefined,
  query: string,
): ClientMedia[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...media];
  const label = (m: ClientMedia): string => {
    const shot = browse?.shots.find((s) => s.id === m.placement.shotId);
    const asset = browse?.assets.find((a) => a.id === m.placement.assetId);
    const sequence = browse?.sequences.find((s) => s.id === m.placement.sequenceId);
    return [
      m.originalName,
      m.version.name,
      m.version.taskName,
      shot?.code,
      shot?.name,
      asset?.name,
      sequence?.code,
      sequence?.name,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  };
  return media.filter((m) => label(m).includes(needle));
}

/**
 * Production rank of a media: sequence, then shot, then date. This is the order in which a
 * film is watched, and the only one in which "the cut between two shots" means anything.
 * What the tree does not place (an asset, an orphan media) goes last, rather than being
 * interleaved at random.
 */
function productionRank(m: ClientMedia, browse: ShareBrowse | undefined): [number, number] {
  const sequence = browse?.sequences.findIndex((s) => s.id === m.placement.sequenceId) ?? -1;
  const shot = browse?.shots.findIndex((s) => s.id === m.placement.shotId) ?? -1;
  return [sequence < 0 ? Number.MAX_SAFE_INTEGER : sequence, shot < 0 ? Number.MAX_SAFE_INTEGER : shot];
}

/** Stable sort: at equal rank, most recent first, the order in which the link serves. */
export function sortMedia(
  media: readonly ClientMedia[],
  browse: ShareBrowse | undefined,
  sort: ClientSort,
): ClientMedia[] {
  const out = [...media];
  if (sort === 'name') return out.sort((a, b) => a.originalName.localeCompare(b.originalName));
  if (sort === 'production')
    return out.sort((a, b) => {
      const [as, ash] = productionRank(a, browse);
      const [bs, bsh] = productionRank(b, browse);
      return as - bs || ash - bsh || a.originalName.localeCompare(b.originalName);
    });
  return out; // `recent`: the server already serves newest first
}

/**
 * What is awaiting a client response: the home queue.
 *
 * A link without decision rights has no queue: showing it "awaiting your answer" would ask
 * it for something it is not allowed to give. It is then served the latest deliveries, as
 * before.
 */
export function pendingMedia(media: readonly ClientMedia[], canDecide: boolean): ClientMedia[] {
  return canDecide ? media.filter((m) => !m.decided) : [];
}
