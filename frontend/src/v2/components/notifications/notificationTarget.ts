// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { api } from '../../../lib/apiClient';
import { itemPath } from '../../pages/review/playlistNav';
import type { Notification, PlaylistDetail } from '../../types/api';

/**
 * Où mène une notification. Extrait de la cloche pour être testable seul : c'est la partie
 * qui se trompait, et elle se trompait en silence — un clic qui atterrit sur la page projet
 * ressemble à un clic qui a marché.
 *
 * `referenceId` n'a de sens qu'avec le type : id de tâche, de média, ou de playlist. Le type
 * `REVIEW_DECISION` manquait purement et simplement à cette table, si bien que la
 * notification la plus attendue d'une review — le verdict — retombait sur la page du projet.
 */

/** Les types dont la référence est un média : le clic ouvre sa review. */
const MEDIA_TYPES = new Set([
  'REPLY',
  'COMMENT_ASSIGNED',
  // Review confiée (Phase 49) : la référence est le premier média de la version, donc
  // le clic ouvre l'écran où le travail demandé se fait.
  'REVIEW_ASSIGNED',
  // Décision de review : même référence (premier média de la version) depuis le lot 9.
  //
  // La comparaison est SENSIBLE À LA CASSE, et c'est délibéré : les lignes écrites avant ce
  // lot portent `review_decision` en minuscules et, pour l'auteur de la version, un id de
  // VERSION dans `referenceId`. Les inclure ici ouvrirait un média pris au hasard. Elles
  // gardent donc le repli « page du projet » — ce qu'elles faisaient déjà.
  'REVIEW_DECISION',
  'MENTION',
  'WATCH',
]);

/** Cible navigable immédiate, ou `null` s'il n'y a rien à ouvrir. */
export function linkFor(n: Pick<Notification, 'type' | 'referenceId' | 'projectId'>): string | null {
  if (n.type === 'TASK_ASSIGNED' && n.referenceId) return `/tasks/${n.referenceId}`;
  if (MEDIA_TYPES.has(n.type) && n.referenceId) return `/review/${n.referenceId}`;
  if (n.projectId) return `/projects/${n.projectId}`;
  return null;
}

/**
 * Notification LIVE (review live sur une playlist, retours 33) : mène directement à la
 * session — premier média lisible de la playlist avec `?playlist=&live=1`. Repli : projet.
 */
export async function liveLinkFor(
  n: Pick<Notification, 'referenceId' | 'projectId'>,
): Promise<string | null> {
  if (!n.referenceId) return n.projectId ? `/projects/${n.projectId}` : null;
  try {
    const { playlist } = await api.get<{ playlist: PlaylistDetail }>(`/api/playlists/${n.referenceId}`);
    const first = playlist.items.find((it) => it.media);
    const path = first ? itemPath(first, playlist.id) : null;
    if (path) return `${path}&live=1`;
  } catch {
    // Playlist supprimée ou inaccessible : repli sur la page projet.
  }
  return n.projectId ? `/projects/${n.projectId}` : null;
}

/** Cible d'une notification, LIVE comprise — un seul point d'entrée pour l'appelant. */
export function targetFor(
  n: Pick<Notification, 'type' | 'referenceId' | 'projectId'>,
): Promise<string | null> {
  return n.type === 'LIVE' ? liveLinkFor(n) : Promise.resolve(linkFor(n));
}
