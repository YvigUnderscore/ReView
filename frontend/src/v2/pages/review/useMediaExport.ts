// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, type RefObject } from 'react';
import { toast } from 'sonner';
import { t } from '../../i18n';
import { buildContactSheet } from './contactSheet';
import { downloadImage } from './mediaCapture';
import type { MediaResp } from './reviewTypes';

/**
 * Exports du panneau « Export » du dock.
 *
 * Le panneau savait déjà dessiner les deux boutons — « frame courante en PNG » et « planche
 * contact » — mais sous condition de recevoir les fonctions qui les exécutent, et personne
 * ne les lui passait : deux branches mortes, et un panneau qui répondait invariablement
 * « seulement l'original ». La capture et la composition existaient pourtant, écrites pour
 * le menu clic droit. C'est le câblage qui manquait.
 */

/**
 * Frame courante en PNG. Le clic droit propose du JPEG — bon pour le presse-papiers et les
 * miniatures ; un export destiné à repartir dans une compo ou une planche mérite un format
 * sans perte, c'est d'ailleurs ce que le libellé du bouton annonce.
 */
export function captureVideoFramePng(video: HTMLVideoElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  if (!canvas.width || !canvas.height) throw new Error(t('capture.notDecoded'));
  canvas.getContext('2d')!.drawImage(video, 0, 0);
  try {
    return canvas.toDataURL('image/png');
  } catch {
    // Canvas « tainted » : le média a été servi sans en-tête CORS exploitable.
    throw new Error(t('capture.failed'));
  }
}

/** Nom de fichier d'un export, dérivé du nom d'origine du média. */
export function exportFileName(originalName: string, suffix: string, extension: string): string {
  return `${originalName.replace(/\.[^.]+$/, '')}-${suffix}.${extension}`;
}

/**
 * Actions d'export d'un média vidéo. Chaque entrée vaut `undefined` quand l'export n'a rien
 * à produire — le panneau n'affiche alors pas le bouton correspondant plutôt que d'offrir un
 * geste qui échouerait.
 */
export function useMediaExport(
  data: MediaResp | null,
  videoRef: RefObject<HTMLVideoElement | null>,
): { onExportFrame?: () => void; onContactSheet?: () => void } {
  const isVideo = data?.media.kind === 'VIDEO';
  const originalName = data?.media.originalName ?? '';
  const spriteUrl = data?.timelineSpriteUrl ?? null;
  const sprite = data?.timelineSprite ?? null;

  const onExportFrame = useCallback(() => {
    const video = videoRef.current;
    if (!video) {
      toast.error(t('video.playerUnavailable'));
      return;
    }
    void (async () => {
      try {
        await downloadImage(captureVideoFramePng(video), exportFileName(originalName, 'frame', 'png'));
        toast.success(t('ctx.frameDownloaded'));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('capture.failed'));
      }
    })();
  }, [videoRef, originalName]);

  const onContactSheet = useCallback(() => {
    if (!spriteUrl || !sprite) return;
    void (async () => {
      try {
        const png = await buildContactSheet(spriteUrl, sprite, originalName);
        await downloadImage(png, exportFileName(originalName, 'contact-sheet', 'png'));
        toast.success(t('ctx.contactSheetDownloaded'));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : t('capture.failed'));
      }
    })();
  }, [spriteUrl, sprite, originalName]);

  return {
    onExportFrame: isVideo ? onExportFrame : undefined,
    // La planche se compose à partir du sprite de timeline : sans lui, il n'y a pas de grille.
    onContactSheet: isVideo && spriteUrl && sprite ? onContactSheet : undefined,
  };
}
