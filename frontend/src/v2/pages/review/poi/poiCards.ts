// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { isImageAttachment, type CommentAttachment } from '../../../../lib/commentAttachments';
import type { PoiPoint } from './poiPoints';

/**
 * Cards of the reviewed comment, as they are displayed **in the scene**: a pure model, hence readable and
 * testable without a viewer or WebGL.
 *
 * The comment used to live in the right-hand column: to read it, one had to take one's eyes off the scene.
 * It now lives at its point: one card per point, anchored to its hotspot. This file only decides the CONTENT
 * of each card; where it is placed is the business of `poiAnchor`.
 *
 * Two distribution rules, chosen so that no information of the comment is lost on the way: the remark and
 * the images of a point go onto ITS card (it is the same reading by MinIO key as the comments column), and
 * everything that belongs to no point (the author's word, the images no point claims) goes onto the card of
 * the FIRST point. This is also what makes a comment predating the numbered points readable: its single
 * `hotspot` is worth point no. 1, and the whole comment reads there.
 */

/** Image of a card, in the form expected by the shared Lightbox. */
export interface PoiCardImage {
  src: string;
  alt: string;
}

/** Card of a point, ready to render: nothing is recomputed at display time. */
export interface PoiSceneCard {
  /** Rank of the point: its number on screen is `index + 1`, and it is the index of its hotspot. */
  index: number;
  /** Remark specific to this point (empty if the point carries none). */
  text: string;
  images: PoiCardImage[];
  /** Author's word: carried by the first point's card only. */
  intro?: string;
  /** Who wrote it: on the first card, with the author's word. */
  author?: string;
}

/** Attachments recognised by their key, reduced to the displayable images. */
function toCardImages(attachments: readonly CommentAttachment[]): PoiCardImage[] {
  return attachments
    .filter((a) => !!a.url && isImageAttachment(a.contentType))
    .map((a) => ({ src: a.url ?? '', alt: a.name ?? '' }));
}

/** Images of a point, in the order of ITS keys (an unknown key is simply ignored). */
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
  /** Text of the comment, numbered block removed (`stripPoiBlock`): the author's word. */
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
      // A card with nothing to read is not placed: the numbered hotspot already says all there is to say
      // about that point.
      .filter((card) => card.text !== '' || card.images.length > 0 || card.intro !== undefined)
  );
}

/** Opening side of a card, seen from its hotspot. */
export type PoiCardSide = 'left' | 'center' | 'right';

/** Half-width of the open card, in pixels: the measurable counterpart of its class width. */
export const POI_CARD_HALF_PX = 120;

/**
 * Side on which the card fits without leaving the viewer, which clips what overflows (`overflow-hidden`):
 * centred under the hotspot by default, pushed right near the left edge, left near the right edge.
 * `anchorLeftPx` is the position of the hotspot **within** the viewer.
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

/** Maximum height of the open card, in pixels (header + scrolling text + thumbnails). */
export const POI_CARD_HEIGHT_PX = 200;

/**
 * The card goes ABOVE its hotspot when a card's height does not fit beneath: a point placed at the bottom
 * edge would otherwise be commented outside the frame. `anchorTopPx` is the position of the hotspot
 * **within** the viewer.
 */
export function poiCardAbove(
  anchorTopPx: number,
  viewerHeightPx: number,
  heightPx = POI_CARD_HEIGHT_PX,
): boolean {
  // Never above if there is no more room up there: both edges clip the same way.
  return viewerHeightPx - anchorTopPx < heightPx && anchorTopPx > viewerHeightPx - anchorTopPx;
}
