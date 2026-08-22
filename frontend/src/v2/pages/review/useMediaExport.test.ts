// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MediaResp } from './reviewTypes';
import { captureVideoFramePng, exportFileName, useMediaExport } from './useMediaExport';

const downloads: { src: string; name: string }[] = [];

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('./mediaCapture', () => ({
  downloadImage: vi.fn((src: string, name: string) => {
    downloads.push({ src, name });
    return Promise.resolve();
  }),
}));
vi.mock('./contactSheet', () => ({
  buildContactSheet: vi.fn(() => Promise.resolve('data:image/png;base64,sheet')),
}));

const sprite = { key: 'k', intervalSec: 3, count: 4, cols: 2, rows: 2, tileW: 160, tileH: 90 };

const media = (over: Partial<MediaResp> = {}): MediaResp =>
  ({
    media: { id: 7, kind: 'VIDEO', originalName: 'sh010_comp_v003.mov' },
    timelineSprite: null,
    timelineSpriteUrl: null,
    ...over,
  }) as unknown as MediaResp;

const videoRef = (video: unknown) => {
  const ref = createRef<HTMLVideoElement>();
  (ref as { current: unknown }).current = video;
  return ref;
};

afterEach(() => {
  cleanup();
  downloads.length = 0;
  vi.clearAllMocks();
});

describe('exportFileName', () => {
  it('remplace l’extension d’origine par celle de l’export', () => {
    expect(exportFileName('sh010_comp_v003.mov', 'frame', 'png')).toBe('sh010_comp_v003-frame.png');
    expect(exportFileName('sans_extension', 'contact-sheet', 'png')).toBe('sans_extension-contact-sheet.png');
  });
});

describe('captureVideoFramePng', () => {
  it('refuse une image non décodée plutôt que d’écrire un PNG vide', () => {
    expect(() => captureVideoFramePng({ videoWidth: 0, videoHeight: 0 } as HTMLVideoElement)).toThrowError();
  });
});

describe('useMediaExport — les deux boutons du panneau Export', () => {
  it('n’expose rien pour un média non vidéo', () => {
    const { result } = renderHook(() =>
      useMediaExport(
        media({ media: { id: 7, kind: 'IMAGE', originalName: 'a.png' } } as Partial<MediaResp>),
        videoRef(null),
      ),
    );
    expect(result.current.onExportFrame).toBeUndefined();
    expect(result.current.onContactSheet).toBeUndefined();
  });

  it('n’expose la planche contact que si le sprite de timeline existe', () => {
    const sans = renderHook(() => useMediaExport(media(), videoRef(null)));
    expect(sans.result.current.onExportFrame).toBeDefined();
    expect(sans.result.current.onContactSheet).toBeUndefined();

    const avec = renderHook(() =>
      useMediaExport(
        media({ timelineSprite: sprite, timelineSpriteUrl: 'https://s3/sprite.jpg' }),
        videoRef(null),
      ),
    );
    expect(avec.result.current.onContactSheet).toBeDefined();
  });

  it('télécharge la planche contact composée depuis le sprite', async () => {
    const { result } = renderHook(() =>
      useMediaExport(
        media({ timelineSprite: sprite, timelineSpriteUrl: 'https://s3/sprite.jpg' }),
        videoRef(null),
      ),
    );
    result.current.onContactSheet!();
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0]).toEqual({
      src: 'data:image/png;base64,sheet',
      name: 'sh010_comp_v003-contact-sheet.png',
    });
  });

  it('sans lecteur monté, signale l’échec au lieu de planter', async () => {
    const { toast } = await import('sonner');
    const { result } = renderHook(() => useMediaExport(media(), videoRef(null)));
    result.current.onExportFrame!();
    expect(toast.error).toHaveBeenCalled();
    expect(downloads).toHaveLength(0);
  });
});
