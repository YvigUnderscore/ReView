// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Shape } from '../../components/AnnotationCanvas';
import type { Hotspot3D } from '../review/reviewTypes';

/**
 * Ce qu'un invité joint à son commentaire — **pur**, donc testable sans monter un viewer.
 *
 * Le format est celui de la review interne (`useSubmitComment`) : un tableau de « parts »
 * relu par `splitAnnotationParts`. Il n'y a pas de format « client » : le retour d'un client
 * se rouvre dans la review de l'artiste, et deux formats qui divergent, c'est un dessin qui
 * ne s'affiche plus six mois plus tard.
 *
 * Ce que l'invité ne joint PAS, et que le backend refuse de sa part : une proposition de
 * mise en scène 3D (`scene-override`), une animation caméra, les traits du painter. Ce sont
 * des gestes d'auteur rejoués pour tous les spectateurs — pas des remarques de client.
 */

/** Contenu de repli quand l'invité n'envoie qu'un dessin : le serveur exige un texte. */
const DRAWING_ONLY = '(annotation)';

export interface GuestAnnotationInput {
  shapes: readonly Shape[];
  /** Point de surface posé sur un modèle 3D ou un splat. */
  hotspot?: Hotspot3D | null;
}

/**
 * Assemble les parts. Le hotspot vient en tête, comme côté interne : `splitAnnotationParts`
 * n'en retient qu'un, et l'ordre décide lequel.
 */
export function buildGuestAnnotation({ shapes, hotspot }: GuestAnnotationInput): unknown[] | undefined {
  const parts: unknown[] = [];
  if (hotspot)
    parts.push({
      type: 'hotspot',
      position: hotspot.position,
      normal: hotspot.normal,
      ...(hotspot.space ? { space: hotspot.space } : {}),
    });
  parts.push(...shapes);
  return parts.length > 0 ? parts : undefined;
}

/** Un dessin seul vaut un retour : le texte devient facultatif dès qu'il y a une annotation. */
export function guestCommentContent(text: string, annotation: unknown[] | undefined): string | null {
  const trimmed = text.trim();
  if (trimmed) return trimmed;
  return annotation ? DRAWING_ONLY : null;
}

/**
 * Numéro de frame cité par l'invité, dans la numérotation du studio. Il est calculé sur le
 * temps **du média** (slate retiré) : l'invité et l'artiste doivent parler de la même image.
 */
export function frameOf(mediaSeconds: number, fps: number, startFrame: number): number {
  if (!Number.isFinite(fps) || fps <= 0) return startFrame;
  return startFrame + Math.round(Math.max(0, mediaSeconds) * fps);
}
