import { describe, it, expect } from 'vitest';
import { imageFilesFromClipboard } from './useImagePaste';

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
