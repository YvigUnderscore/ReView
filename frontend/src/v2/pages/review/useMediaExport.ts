// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback, type RefObject } from 'react';
import { toast } from 'sonner';
import { t } from '../../i18n';
import { buildContactSheet } from './contactSheet';
import { downloadImage } from './mediaCapture';
import type { MediaResp } from './reviewTypes';

/**
 * Exports of the dock's "Export" panel.
 *
 * The panel already knew how to draw the two buttons — "current frame as PNG" and "contact sheet" — but
 * only on condition of receiving the functions that run them, and nobody passed them: two dead
 * branches, and a panel that invariably answered "original only". The capture and the composition did
 * exist, however, written for the right-click menu. It was the wiring that was missing.
 */

/**
 * Current frame as PNG. The right click offers JPEG — good for the clipboard and thumbnails; an export
 * meant to go back into a composition or a sheet deserves a lossless format, which is also what the
 * button's label promises.
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
    // "Tainted" canvas: the media was served without a usable CORS header.
    throw new Error(t('capture.failed'));
  }
}

/** File name of an export, derived from the media's original name. */
export function exportFileName(originalName: string, suffix: string, extension: string): string {
  return `${originalName.replace(/\.[^.]+$/, '')}-${suffix}.${extension}`;
}

/**
 * Export actions of a video media. Each entry is `undefined` when the export has nothing to produce —
 * the panel then does not display the corresponding button rather than offering a gesture that would
 * fail.
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
    // The sheet is composed from the timeline sprite: without it, there is no grid.
    onContactSheet: isVideo && spriteUrl && sprite ? onContactSheet : undefined,
  };
}
