// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { storage } from './StorageService';
import { logger } from '../lib/logger';
import { imageTypeFromKey } from '../lib/uploadContentType';
import { t, type Locale } from '../i18n';
import type { SheetImage, SheetLabels } from '../lib/notesSheetHtml';
import type { ClipContext } from './CommentExportScope';

/**
 * Images et libellés de la planche imprimable des notes.
 *
 * La planche doit rester lisible une fois enregistrée : les images y sont donc encodées en
 * data URI plutôt que présignées (une URL signée expire en une heure, un PDF imprimé six
 * mois plus tard n'aurait plus que des cadres vides).
 *
 * La frame commentée sort de la **sprite de timeline** que le worker calcule déjà pour le
 * survol du lecteur : une vignette toutes les trois secondes, découpée en CSS. Extraire la
 * frame exacte demanderait un appel ffmpeg par note — quelques minutes pour un shot chargé,
 * ce qu'une requête HTTP ne peut pas tenir. À défaut de sprite (image, 3D, splat), c'est la
 * miniature du média.
 */

/** Au-delà, une seule image ferait à elle seule le poids du document. */
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** Budget total d'images d'une planche : passé ce point, les notes suivantes sortent sans frame. */
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

/** Largeur d'affichage d'une miniature de média, en pixels. */
const THUMB_WIDTH = 160;

/** Rapport d'image par défaut quand le média n'a pas relevé ses dimensions. */
const DEFAULT_ASPECT = 16 / 9;

/** Récupère les libellés traduits de la planche. */
export function sheetLabels(locale: Locale): SheetLabels {
  return {
    frame: t(locale, 'notesSheet.frame'),
    timecode: t(locale, 'notesSheet.timecode'),
    state: t(locale, 'notesSheet.state'),
    decision: t(locale, 'notesSheet.decision'),
    noFrame: t(locale, 'notesSheet.noFrame'),
    printHint: t(locale, 'notesSheet.printHint'),
    empty: t(locale, 'notesSheet.empty'),
    reply: t(locale, 'notesSheet.reply'),
  };
}

/** Index de la vignette de sprite la plus proche d'un instant. */
export function spriteTile(
  sprite: { intervalSec: number; count: number; cols: number },
  seconds: number,
): { col: number; row: number } {
  const index = Math.min(
    Math.max(0, sprite.count - 1),
    Math.max(0, Math.floor(seconds / sprite.intervalSec)),
  );
  return { col: index % sprite.cols, row: Math.floor(index / sprite.cols) };
}

/** Fabrique le chargeur d'images d'une planche : cache par média et budget d'octets partagés. */
export function createSheetImages(): (clip: ClipContext, at: number | null) => Promise<SheetImage | null> {
  const cache = new Map<string, string | null>();
  let spent = 0;

  const load = async (key: string, cacheKey: string): Promise<string | null> => {
    const known = cache.get(cacheKey);
    if (known !== undefined) return known;
    let uri: string | null = null;
    try {
      const buffer = await storage.getObjectBuffer(key);
      if (buffer.byteLength <= MAX_IMAGE_BYTES && spent + buffer.byteLength <= MAX_TOTAL_BYTES) {
        spent += buffer.byteLength;
        uri = `data:${imageTypeFromKey(key)};base64,${buffer.toString('base64')}`;
      }
    } catch (err) {
      // Une vignette absente ne doit pas emporter la planche : la note sort sans image.
      logger.warn({ err, key }, 'Image de planche de notes illisible');
    }
    cache.set(cacheKey, uri);
    return uri;
  };

  return async (clip, at) => {
    const sprite = clip.sprite;
    if (sprite && at !== null) {
      const src = await load(sprite.key, `sprite:${clip.mediaId}`);
      if (src) {
        const { col, row } = spriteTile(sprite, at);
        return {
          src,
          width: sprite.tileW,
          height: sprite.tileH,
          tile: {
            offsetX: col * sprite.tileW,
            offsetY: row * sprite.tileH,
            sheetWidth: sprite.cols * sprite.tileW,
            sheetHeight: sprite.rows * sprite.tileH,
          },
        };
      }
    }
    if (!clip.thumbnailKey) return null;
    const src = await load(clip.thumbnailKey, `thumb:${clip.mediaId}`);
    if (!src) return null;
    const aspect = clip.aspect && clip.aspect > 0 ? clip.aspect : DEFAULT_ASPECT;
    return { src, width: THUMB_WIDTH, height: Math.max(1, Math.round(THUMB_WIDTH / aspect)) };
  };
}
