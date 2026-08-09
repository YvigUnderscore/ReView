// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ReviewComment, TimelineClip } from '../../types/api';

/**
 * Retours posés sur un montage — analyse PURE, testée (Phase 46).
 *
 * Un retour de montage porte deux positions : sa frame DANS le plan (`timestamp`, ce qui
 * permettra de le renvoyer exactement là sur la review du plan) et sa position dans le
 * film entier (`timelineTime`, la seule échelle qu'une timeline unique puisse afficher).
 * Ce fichier tient la correspondance entre les deux.
 */

/**
 * Un retour de montage EST un commentaire de review : le fil, le clic droit et les
 * réponses sont les mêmes composants qu'ailleurs. Seules s'ajoutent sa position dans le
 * film et la trace de son renvoi.
 */
export interface MontageComment extends ReviewComment {
  timelineTime: number | null;
  sharedToShot: boolean;
}

/** Le plan sur lequel tombe un retour, en clair : « SQ020 · SH010 ». */
export function shotLabelOf(
  clips: readonly TimelineClip[],
  mediaObjectId: number | null | undefined,
): string {
  const clip = clips.find((c) => c.mediaId !== null && c.mediaId === mediaObjectId);
  if (!clip) return '—';
  return clip.sequenceCode ? `${clip.sequenceCode} · ${clip.shotCode}` : clip.shotCode;
}

/** Repère d'un retour sur la bande du montage. */
export interface CommentMarker {
  id: number;
  time: number;
  label: string;
  shared: boolean;
}

/**
 * Marqueurs à poser sur la timeline.
 *
 * Un retour dont la position dans le film est inconnue est replacé au début du plan qu'il
 * vise, plutôt qu'écarté : un retour invisible est un retour perdu.
 */
export function commentMarkers(
  comments: readonly MontageComment[],
  clips: readonly TimelineClip[],
): CommentMarker[] {
  return comments.map((c) => {
    const clip = clips.find((x) => x.mediaId !== null && x.mediaId === c.mediaObjectId);
    const fallback = clip ? clip.startTime + Math.min(c.timestamp ?? 0, clip.duration) : 0;
    return {
      id: c.id,
      time: c.timelineTime ?? fallback,
      label: `${shotLabelOf(clips, c.mediaObjectId)} — ${stripHtml(c.content).slice(0, 60)}`,
      shared: c.sharedToShot,
    };
  });
}

/** Texte nu d'un contenu déjà assaini : les balises n'ont rien à faire dans une infobulle. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
