// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MediaKind } from './api';
import type { DisplayAttachment } from '../lib/commentAttachments';

// ── Client sharing (35.C/35.D) — module separate from api.ts for the line budget ─
export type SharePermission = 'VIEW' | 'COMMENT' | 'DECIDE';
/** What a link opens. Defined here, reused by the sharing administration screen. */
export type ShareScope = 'PROJECT' | 'PLAYLIST' | 'VERSION' | 'MEDIA';
/** GET /api/share?projectId= — share link (the password hash is never exposed). */
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
 * Media as exposed on the public client page.
 *
 * `placement` only carries **keys**: this is what allows a tile to exist only once in the payload,
 * whatever the richness of the tree — hence a single presigned URL per media, however many nodes
 * cite it.
 */
export interface ClientMedia {
  id: number;
  kind: MediaKind;
  originalName: string;
  thumbnailUrl: string | null;
  createdAt: string;
  version: { id: number; name: string; taskName: string | null };
  /** This link has already given its verdict on this version — the home queue leaves it out. */
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
  /** All media of the sequence, across its shots. */
  mediaIds: number[];
  /** Pointer to a tile of `media` — certainly not one more URL to sign. */
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
  /** Studio label when it has defined one. */
  typeLabel: string | null;
  mediaIds: number[];
  coverMediaId: number | null;
}
export interface SharePlaylistCard {
  id: number;
  name: string;
  updatedAt: string;
  /** Items in scope: may exceed `mediaIds.length` when the page is bounded. */
  itemCount: number;
  /** Playlist media present in `media`, in playlist order. */
  mediaIds: number[];
  coverMediaIds: number[];
}
/**
 * The home tree. Named `browse` and not `home`: "home view" already designates, on the client
 * side, the camera return of the spatial viewers (`H` key).
 */
export interface ShareBrowse {
  playlists: SharePlaylistCard[];
  episodes: ShareEpisodeNode[];
  sequences: ShareSequenceNode[];
  shots: ShareShotNode[];
  assets: ShareAssetNode[];
  /** Media no parent claims — never lost, never named. */
  looseMediaIds: number[];
}
/** GET /api/client/:token — public payload (locked = password required). */
export interface ClientSharePayload {
  locked: boolean;
  studio: { name: string; logoUrl: string | null };
  project?: {
    id: number;
    name: string;
    description: string | null;
    status: string;
    /** Without it, the Episode level would impose itself on a feature film. */
    episodesEnabled: boolean;
  };
  permission?: SharePermission;
  label?: string | null;
  scope?: ShareScope;
  media?: ClientMedia[];
  /** Real total in scope: `browse` only describes the page of `media`. */
  mediaTotal?: number;
  mediaHasMore?: boolean;
  browse?: ShareBrowse;
  /** The two offered answers — `null` as soon as the link is not allowed to give a verdict. */
  decisionStatuses?: {
    approval: { id: number; name: string; color: string } | null;
    retake: { id: number; name: string; color: string } | null;
  } | null;
  watermark?: { enabled: boolean; opacity: number };
  shareAuth?: string;
}
/** Comment as exposed to the public client (allowlist set server-side). */
export interface ClientComment {
  id: number;
  content: string;
  timestamp: number | null;
  duration: number | null;
  guestName: string | null;
  author: { id: number; name: string | null } | null;
  createdAt: string;
  isEdited: boolean;
  /** Attached drawing — the one the studio shows the client, and the one the client places. */
  annotation: unknown;
  /**
   * Images attached by the studio, as presigned URLs: the portal displayed NONE of them, so an
   * illustrated note arrived empty for its recipient. The MinIO key does not come down — only the
   * name, the type and the URL do.
   */
  attachments?: DisplayAttachment[];
}
/** GET /api/admin/burnin — studio template of burn-ins/slates (35.A). */
export interface BurninConfig {
  enabled: boolean;
  showShot: boolean;
  showVersion: boolean;
  showTimecode: boolean;
  showLogo: boolean;
  customText: string;
  slate: boolean;
}
