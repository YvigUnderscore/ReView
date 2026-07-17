import { describe, it, expect } from 'vitest';
import { fileToImageDataUrl, imageFilesFromClipboard, isAcceptedImageType } from './useImagePaste';

/** Fabrique un DataTransfer-like minimal pour le test (items + files). */
function makeClipboard(files: { type: string }[]): DataTransfer {
  const asFiles = files.map((f) => new File(['x'], 'p', { type: f.type }));
  return {
    items: asFiles.map((file) => ({
      kind: 'file' as const,
      type: file.type,
      getAsFile: () => file,
    })),
    files: asFiles,
  } as unknown as DataTransfer;
}

describe('imageFilesFromClipboard (Phase 18)', () => {
  it('renvoie [] pour un presse-papiers nul', () => {
    expect(imageFilesFromClipboard(null)).toEqual([]);
  });

  it('extrait uniquement les fichiers image', () => {
    const out = imageFilesFromClipboard(makeClipboard([{ type: 'image/png' }, { type: 'text/plain' }]));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('image/png');
  });

  it('extrait plusieurs images', () => {
    const out = imageFilesFromClipboard(makeClipboard([{ type: 'image/jpeg' }, { type: 'image/webp' }]));
    expect(out.map((f) => f.type)).toEqual(['image/jpeg', 'image/webp']);
  });
});

describe('fileToImageDataUrl (fix Ctrl+V « Image invalide »)', () => {
  it('accepte les types backend tels quels', () => {
    for (const t of ['image/png', 'image/JPEG', 'image/webp', 'image/gif'])
      expect(isAcceptedImageType(t)).toBe(true);
    expect(isAcceptedImageType('image/bmp')).toBe(false);
    expect(isAcceptedImageType('')).toBe(false);
  });

  it('lit un type accepté en data URL sans ré-encodage', async () => {
    const file = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });
    const url = await fileToImageDataUrl(file);
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
  });
});
