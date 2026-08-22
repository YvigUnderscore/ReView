// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ShareLink } from '../../../types/api';

/**
 * Portée d'un lien de partage — le côté client de la décision « qu'est-ce que ce lien
 * ouvre ». Tout ce qui est calculable sans le DOM vit ici, testé : la portée est la seule
 * chose qui sépare « montrer un plan » de « ouvrir le film entier ».
 */

export type ShareScope = 'PROJECT' | 'PLAYLIST' | 'VERSION' | 'MEDIA';

/**
 * Le lien tel que l'API le renvoie désormais. Composition (et non re-déclaration) du type
 * partagé : `types/share.ts` décrit le lien d'origine, la portée s'y ajoute.
 */
export type ScopedShareLink = ShareLink & {
  scope: ShareScope;
  playlistId: number | null;
  versionId: number | null;
  mediaIds: number[];
  playlist: { name: string } | null;
  version: { name: string } | null;
};

/** Une ligne du sélecteur de médias (GET /api/share/candidates). */
export interface ShareCandidate {
  id: number;
  originalName: string;
  kind: string;
  versionId: number;
  versionName: string;
  location: string;
  createdAt: string;
}

/** État du sélecteur, dans le dialogue de création. */
export interface ScopeState {
  scope: ShareScope;
  playlistId: number | null;
  versionId: number | null;
  mediaIds: number[];
}

export const emptyScope: ScopeState = { scope: 'PROJECT', playlistId: null, versionId: null, mediaIds: [] };

/**
 * Vrai quand la portée choisie désigne réellement quelque chose. Sans ce garde-fou, un
 * lien « playlist » sans playlist part au serveur, qui le refuse — autant le dire avant.
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

/** Corps de requête : on n'envoie QUE la cible de la portée choisie. */
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

/** Coche/décoche un média dans la sélection, sans muter l'état d'origine. */
export function toggleMedia(mediaIds: number[], id: number): number[] {
  return mediaIds.includes(id) ? mediaIds.filter((m) => m !== id) : [...mediaIds, id];
}

/** Les versions distinctes du catalogue, dans l'ordre où elles s'y présentent. */
export function versionsOf(candidates: ShareCandidate[]): { id: number; label: string }[] {
  const seen = new Map<number, string>();
  for (const c of candidates) {
    if (!seen.has(c.versionId)) seen.set(c.versionId, `${c.location} · ${c.versionName}`);
  }
  return [...seen].map(([id, label]) => ({ id, label }));
}

/**
 * Adresses saisies dans le champ « destinataires » : une par ligne, par virgule ou par
 * point-virgule. Le filtre est volontairement grossier — le serveur valide pour de bon ;
 * il sert à ne pas envoyer une ligne vide ni un « ; » esseulé.
 */
export function parseRecipients(raw: string): string[] {
  const parts = raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s));
  return [...new Set(parts)];
}

/**
 * Libellé de la portée d'un lien existant, pour la liste. Le nom de la cible vient du
 * serveur : le stocker côté client le figerait au jour de la création.
 */
export function scopeBadge(
  link: Pick<ScopedShareLink, 'scope' | 'playlist' | 'version' | 'mediaIds'>,
  labels: {
    project: string;
    selection: (count: number) => string;
    /** Portée restreinte dont la cible manque — état que la base interdit, jamais « projet ». */
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
