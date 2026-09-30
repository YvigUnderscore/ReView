// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isImageAttachment, type CommentAttachment } from '../../../../lib/commentAttachments';
import type { PoiPoint } from './poiPoints';

/**
 * Cartes du commentaire relu, telles qu'elles s'affichent **dans la scène** — modèle pur, donc
 * lisible et testable sans viewer ni WebGL.
 *
 * Le commentaire vivait dans la colonne de droite : pour le lire, il fallait quitter la scène des
 * yeux. Il vit maintenant à son point : une carte par point, ancrée à sa pastille. Ce fichier ne
 * décide que du CONTENU de chaque carte ; où elle se pose est l'affaire de `poiAnchor`.
 *
 * Deux règles de répartition, choisies pour qu'aucune information du commentaire ne se perde en
 * route : la remarque et les images d'un point vont sur SA carte (c'est la même lecture par clé
 * MinIO que la colonne des commentaires), et tout ce qui n'appartient à aucun point — le mot de
 * l'auteur, les images qu'aucun point ne réclame — va sur la carte du PREMIER point. C'est aussi
 * ce qui rend lisible un commentaire d'avant les points numérotés : son unique `hotspot` vaut le
 * point n° 1, et tout le commentaire s'y lit.
 */

/** Image d'une carte, dans la forme attendue par la Lightbox partagée. */
export interface PoiCardImage {
  src: string;
  alt: string;
}

/** Carte d'un point, prête à rendre — rien n'est recalculé au moment de l'affichage. */
export interface PoiSceneCard {
  /** Rang du point : son numéro à l'écran vaut `index + 1`, et c'est l'index de sa pastille. */
  index: number;
  /** Remarque propre à ce point (vide si le point n'en porte pas). */
  text: string;
  images: PoiCardImage[];
  /** Mot de l'auteur — porté par la carte du premier point seulement. */
  intro?: string;
  /** Qui a écrit — sur la première carte, avec le mot de l'auteur. */
  author?: string;
}

/** Pièces jointes reconnues par leur clé, réduites aux images affichables. */
function toCardImages(attachments: readonly CommentAttachment[]): PoiCardImage[] {
  return attachments
    .filter((a) => !!a.url && isImageAttachment(a.contentType))
    .map((a) => ({ src: a.url ?? '', alt: a.name ?? '' }));
}

/** Images d'un point, dans l'ordre de SES clés (une clé inconnue est simplement ignorée). */
function imagesOfPoint(
  keys: readonly string[] | undefined,
  attachments: readonly CommentAttachment[],
): PoiCardImage[] {
  return toCardImages(
    (keys ?? [])
      .map((key) => attachments.find((a) => a.key === key))
      .filter((a): a is CommentAttachment => !!a),
  );
}

export function buildPoiSceneCards(opts: {
  points: readonly PoiPoint[];
  attachments?: readonly CommentAttachment[];
  /** Texte du commentaire, bloc numéroté retiré (`stripPoiBlock`) — le mot de l'auteur. */
  intro?: string;
  author?: string;
}): PoiSceneCard[] {
  const attachments = opts.attachments ?? [];
  const claimed = new Set(opts.points.flatMap((p) => p.images ?? []));
  const loose = toCardImages(attachments.filter((a) => !claimed.has(a.key)));
  const intro = (opts.intro ?? '').trim();

  return (
    opts.points
      .map((point, index) => {
        const own = imagesOfPoint(point.images, attachments);
        return {
          index,
          text: (point.text ?? '').trim(),
          images: index === 0 ? [...own, ...loose] : own,
          ...(index === 0 && intro ? { intro } : {}),
          ...(index === 0 && opts.author ? { author: opts.author } : {}),
        };
      })
      // Une carte sans rien à lire ne se pose pas : la pastille numérotée dit déjà tout ce
      // qu'il y a à dire de ce point-là.
      .filter((card) => card.text !== '' || card.images.length > 0 || card.intro !== undefined)
  );
}

/** Côté d'ouverture d'une carte, vu depuis sa pastille. */
export type PoiCardSide = 'left' | 'center' | 'right';

/** Demi-largeur de la carte ouverte, en pixels — le pendant mesurable de sa largeur de classe. */
export const POI_CARD_HALF_PX = 120;

/**
 * Côté où la carte tient sans sortir du viewer, qui écrête ce qui dépasse (`overflow-hidden`) :
 * centrée sous la pastille par défaut, poussée à droite près du bord gauche, à gauche près du
 * bord droit. `anchorLeftPx` est la position de la pastille **dans** le viewer.
 */
export function poiCardSide(
  anchorLeftPx: number,
  viewerWidthPx: number,
  halfPx = POI_CARD_HALF_PX,
): PoiCardSide {
  if (anchorLeftPx < halfPx) return 'right';
  if (viewerWidthPx - anchorLeftPx < halfPx) return 'left';
  return 'center';
}

/** Hauteur maximale de la carte ouverte, en pixels (en-tête + texte qui défile + vignettes). */
export const POI_CARD_HEIGHT_PX = 200;

/**
 * La carte passe AU-DESSUS de sa pastille quand la hauteur d'une carte ne tient pas dessous : un
 * point posé au ras du bord bas serait sinon commenté hors du cadre. `anchorTopPx` est la position
 * de la pastille **dans** le viewer.
 */
export function poiCardAbove(
  anchorTopPx: number,
  viewerHeightPx: number,
  heightPx = POI_CARD_HEIGHT_PX,
): boolean {
  // Jamais au-dessus s'il n'y a pas davantage de place là-haut : deux bords écrêtent pareil.
  return viewerHeightPx - anchorTopPx < heightPx && anchorTopPx > viewerHeightPx - anchorTopPx;
}
