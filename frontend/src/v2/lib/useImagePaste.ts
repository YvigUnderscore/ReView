// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback } from 'react';
import { t } from '../i18n';

/** Types image acceptés par le backend (data URL) — tout autre type est ré-encodé en PNG. */
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export const isAcceptedImageType = (type: string): boolean =>
  ACCEPTED_IMAGE_TYPES.includes(type.toLowerCase());

/** Lecture brute d'un fichier en data URL. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(t('file.readFailed')));
    r.readAsDataURL(file);
  });
}

/**
 * Fichier image → data URL **compatible backend**. Les types hors liste (bmp, avif,
 * tiff…, ou type vide de certains presse-papiers) sont décodés puis ré-encodés en PNG
 * via canvas — corrige le « Image invalide (data URL image attendue) » au Ctrl+V.
 */
export async function fileToImageDataUrl(file: File): Promise<string> {
  if (isAcceptedImageType(file.type)) return readAsDataUrl(file);
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas.toDataURL('image/png');
  } catch {
    // Décodage impossible : on tente la lecture brute (le backend tranchera).
    return readAsDataUrl(file);
  }
}

/** Extrait les fichiers image d'un presse-papiers (paste). Pur, testable. */
export function imageFilesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) out.push(file);
    }
  }
  // Repli : certains navigateurs n'exposent que `files`.
  if (out.length === 0) {
    for (const file of Array.from(data.files ?? [])) {
      if (file.type.startsWith('image/')) out.push(file);
    }
  }
  return out;
}

/**
 * Hook de collage d'images : renvoie un handler `onPaste` à poser sur un champ
 * (textarea, zone éditable…). Si des images sont présentes dans le presse-papiers,
 * appelle `onImages` et empêche le collage texte par défaut.
 */
export function useImagePaste(onImages: (files: File[]) => void) {
  return useCallback(
    (e: React.ClipboardEvent) => {
      const files = imageFilesFromClipboard(e.clipboardData);
      if (files.length > 0) {
        e.preventDefault();
        onImages(files);
      }
    },
    [onImages],
  );
}
