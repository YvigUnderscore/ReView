// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ShareLink, ShareScope } from '../../../types/api';

/**
 * Scope of a share link: the client-side part of the decision "what does this link open".
 * Everything computable without the DOM lives here, and is tested: the scope is the only thing
 * that separates "showing a shot" from "opening the whole film".
 */

export type { ShareScope };

/**
 * The link as the API now returns it. Composition (rather than re-declaration) of the shared type:
 * `types/share.ts` describes the original link, and the scope is added to it.
 */
export type ScopedShareLink = ShareLink & {
  scope: ShareScope;
  playlistId: number | null;
  versionId: number | null;
  mediaIds: number[];
  playlist: { name: string } | null;
  version: { name: string } | null;
};

/** One row of the media picker (GET /api/share/candidates). */
export interface ShareCandidate {
  id: number;
  originalName: string;
  kind: string;
  versionId: number;
  versionName: string;
  location: string;
  createdAt: string;
}

/** State of the picker, in the creation dialog. */
export interface ScopeState {
  scope: ShareScope;
  playlistId: number | null;
  versionId: number | null;
  mediaIds: number[];
}

export const emptyScope: ScopeState = { scope: 'PROJECT', playlistId: null, versionId: null, mediaIds: [] };

/**
 * True when the chosen scope actually designates something. Without this guard, a "playlist" link
 * without a playlist goes to the server, which refuses it: better to say so beforehand.
 */
export function isScopeReady(state: ScopeState): boolean {
  switch (state.scope) {
    case 'PLAYLIST':
      return state.playlistId != null;
    case 'VERSION':
      return state.versionId != null;
    case 'MEDIA':
      return state.mediaIds.length > 0;
    default:
      return true;
  }
}

/** Request body: we send ONLY the target of the chosen scope. */
export function scopePayload(state: ScopeState): Record<string, unknown> {
  switch (state.scope) {
    case 'PLAYLIST':
      return { scope: 'PLAYLIST', playlistId: state.playlistId };
    case 'VERSION':
      return { scope: 'VERSION', versionId: state.versionId };
    case 'MEDIA':
      return { scope: 'MEDIA', mediaIds: state.mediaIds };
    default:
      return { scope: 'PROJECT' };
  }
}

/** Checks or unchecks a media in the selection, without mutating the original state. */
export function toggleMedia(mediaIds: number[], id: number): number[] {
  return mediaIds.includes(id) ? mediaIds.filter((m) => m !== id) : [...mediaIds, id];
}

/** The distinct versions of the catalogue, in the order they are presented. */
export function versionsOf(candidates: ShareCandidate[]): { id: number; label: string }[] {
  const seen = new Map<number, string>();
  for (const c of candidates) {
    if (!seen.has(c.versionId)) seen.set(c.versionId, `${c.location} · ${c.versionName}`);
  }
  return [...seen].map(([id, label]) => ({ id, label }));
}

/**
 * Addresses typed into the "recipients" field: one per line, or separated by commas or semicolons.
 * The filter is deliberately coarse: the server validates for real. It only serves to avoid sending
 * an empty line or a lone ";".
 */
export function parseRecipients(raw: string): string[] {
  const parts = raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  return [...new Set(parts)];
}

/**
 * Label of the scope of an existing link, for the list. The name of the target comes from the
 * server: storing it client-side would freeze it at the day of creation.
 */
export function scopeBadge(
  link: Pick<ScopedShareLink, 'scope' | 'playlist' | 'version' | 'mediaIds'>,
  labels: {
    project: string;
    selection: (count: number) => string;
    /** Restricted scope whose target is missing: a state the database forbids, never "project". */
    restricted: string;
  },
): string {
  switch (link.scope) {
    case 'PLAYLIST':
      return link.playlist?.name ?? labels.restricted;
    case 'VERSION':
      return link.version?.name ?? labels.restricted;
    case 'MEDIA':
      return labels.selection(link.mediaIds.length);
    default:
      return labels.project;
  }
}
