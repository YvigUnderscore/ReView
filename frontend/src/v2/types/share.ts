// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaKind } from './api';

// ── Partage client (35.C/35.D) — module séparé de api.ts pour le budget de lignes ─
export type SharePermission = 'VIEW' | 'COMMENT' | 'DECIDE';
/** Ce qu'un lien ouvre. Défini ici, réutilisé par l'écran d'administration des partages. */
export type ShareScope = 'PROJECT' | 'PLAYLIST' | 'VERSION' | 'MEDIA';
/** GET /api/share?projectId= — lien de partage (le hash du mot de passe n'est jamais exposé). */
export interface ShareLink {
  id: number;
  token: string;
  projectId: number;
  permission: SharePermission;
  label: string | null;
  hasPassword: boolean;
  maxViews: number | null;
  viewCount: number;
  lastViewedAt: string | null;
  expiresAt: string | null;
  revoked: boolean;
  createdAt: string;
  createdBy: { id: number; name: string | null } | null;
}
/**
 * Média tel qu'exposé sur la page client publique.
 *
 * `placement` ne porte que des **clés** : c'est ce qui permet à une tuile de n'exister
 * qu'une fois dans le payload, quelle que soit la richesse de l'arborescence — donc une
 * seule URL présignée par média, quel que soit le nombre de nœuds qui le citent.
 */
export interface ClientMedia {
  id: number;
  kind: MediaKind;
  originalName: string;
  thumbnailUrl: string | null;
  createdAt: string;
  version: { id: number; name: string; taskName: string | null };
  /** Ce lien s'est déjà prononcé sur cette version — la file d'accueil l'écarte. */
  decided: boolean;
  placement: {
    episodeId: number | null;
    sequenceId: number | null;
    shotId: number | null;
    assetId: number | null;
  };
}
export interface ShareEpisodeNode {
  id: number;
  code: string;
  name: string;
  order: number;
  sequenceIds: number[];
}
export interface ShareSequenceNode {
  id: number;
  code: string;
  name: string;
  order: number;
  episodeId: number | null;
  shotIds: number[];
  /** Tous les médias de la séquence, plans confondus. */
  mediaIds: number[];
  /** Pointeur vers une tuile de `media` — surtout pas une URL de plus à signer. */
  coverMediaId: number | null;
}
export interface ShareShotNode {
  id: number;
  code: string;
  name: string;
  order: number;
  sequenceId: number | null;
  mediaIds: number[];
  coverMediaId: number | null;
}
export interface ShareAssetNode {
  id: number;
  name: string;
  type: string;
  /** Libellé du studio quand il en a défini un. */
  typeLabel: string | null;
  mediaIds: number[];
  coverMediaId: number | null;
}
export interface SharePlaylistCard {
  id: number;
  name: string;
  updatedAt: string;
  /** Items en portée : peut dépasser `mediaIds.length` quand la page est bornée. */
  itemCount: number;
  /** Médias de la playlist présents dans `media`, dans l'ordre de la playlist. */
  mediaIds: number[];
  coverMediaIds: number[];
}
/**
 * L'arborescence de l'accueil. Nommée `browse` et non `home` : « home view » désigne déjà,
 * côté client, le retour caméra des viewers spatiaux (touche `H`).
 */
export interface ShareBrowse {
  playlists: SharePlaylistCard[];
  episodes: ShareEpisodeNode[];
  sequences: ShareSequenceNode[];
  shots: ShareShotNode[];
  assets: ShareAssetNode[];
  /** Médias qu'aucun parent ne réclame — jamais perdus, jamais nommés. */
  looseMediaIds: number[];
}
/** GET /api/client/:token — payload public (locked = mot de passe requis). */
export interface ClientSharePayload {
  locked: boolean;
  studio: { name: string; logoUrl: string | null };
  project?: {
    id: number;
    name: string;
    description: string | null;
    status: string;
    /** Sans lui, le niveau Episode s'inviterait sur un long-métrage. */
    episodesEnabled: boolean;
  };
  permission?: SharePermission;
  label?: string | null;
  scope?: ShareScope;
  media?: ClientMedia[];
  /** Total réel en portée : `browse` ne décrit que la page de `media`. */
  mediaTotal?: number;
  mediaHasMore?: boolean;
  browse?: ShareBrowse;
  /** Les deux réponses offertes — `null` dès que le lien n'a pas le droit de se prononcer. */
  decisionStatuses?: {
    approval: { id: number; name: string; color: string } | null;
    retake: { id: number; name: string; color: string } | null;
  } | null;
  watermark?: { enabled: boolean; opacity: number };
  shareAuth?: string;
}
/** Commentaire tel qu'exposé côté client public (liste blanche posée côté serveur). */
export interface ClientComment {
  id: number;
  content: string;
  timestamp: number | null;
  duration: number | null;
  guestName: string | null;
  author: { id: number; name: string | null } | null;
  createdAt: string;
  isEdited: boolean;
  /** Dessin joint — celui que le studio montre au client, et celui que le client pose. */
  annotation: unknown;
}
/** GET /api/admin/burnin — template studio des burn-ins/slates (35.A). */
export interface BurninConfig {
  enabled: boolean;
  showShot: boolean;
  showVersion: boolean;
  showTimecode: boolean;
  showLogo: boolean;
  customText: string;
  slate: boolean;
}
