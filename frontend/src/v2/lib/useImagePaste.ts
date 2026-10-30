// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useCallback } from 'react';
import { t } from '../i18n';

/** Image types accepted by the backend (data URL) — any other type is re-encoded as PNG. */
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export const isAcceptedImageType = (type: string): boolean =>
  ACCEPTED_IMAGE_TYPES.includes(type.toLowerCase());

/** Raw read of a file as a data URL. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(t('file.readFailed')));
    r.readAsDataURL(file);
  });
}

/**
 * Image file → **backend-compatible** data URL. Types outside the list (bmp, avif,
 * tiff…, or the empty type of some clipboards) are decoded then re-encoded as PNG
 * via canvas — fixes the "Invalid image (image data URL expected)" on Ctrl+V.
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
    // Decoding impossible: we try the raw read (the backend will decide).
    return readAsDataUrl(file);
  }
}

/** Extracts the image files from a clipboard (paste). Pure, testable. */
export function imageFilesFromClipboard(data: DataTransfer | null): File[] {
  if (!data) return [];
  const out: File[] = [];
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) out.push(file);
    }
  }
  // Fallback: some browsers only expose `files`.
  if (out.length === 0) {
    for (const file of Array.from(data.files ?? [])) {
      if (file.type.startsWith('image/')) out.push(file);
    }
  }
  return out;
}

/**
 * Image paste hook: returns an `onPaste` handler to attach to a field
 * (textarea, editable area…). If images are present in the clipboard,
 * calls `onImages` and prevents the default text paste.
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
