import { useCallback } from 'react';

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
