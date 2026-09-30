// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createRef } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));
vi.mock('../../../lib/apiClient', () => ({ api }));

import VideoComparePane from './VideoComparePane';
import { t } from '../../i18n';

/** happy-dom ne met rien en page : la zone média du pane mesure 800 × 600. */
const ZONE = { w: 800, h: 600 };

/**
 * Monte le pane B, attend son média, puis annonce la résolution comme le ferait
 * `loadedmetadata`. Rend la taille d'affichage retenue pour la vidéo.
 */
const displayed = async (resolution: [number, number]) => {
  api.get.mockResolvedValue({
    media: { id: 2, originalName: 'sintel_trailer.mp4' },
    url: 'https://example.invalid/sintel.mp4',
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { container } = render(
    <QueryClientProvider client={qc}>
      <VideoComparePane compareId={2} masterRef={createRef<HTMLVideoElement>()} onClose={() => {}} />
    </QueryClientProvider>,
  );
  // Le média arrive : son nom paraît dans l'en-tête du pane.
  await screen.findByText('sintel_trailer.mp4');
  const video = container.querySelector('video')!;
  Object.defineProperty(video, 'videoWidth', { configurable: true, value: resolution[0] });
  Object.defineProperty(video, 'videoHeight', { configurable: true, value: resolution[1] });
  fireEvent.loadedMetadata(video);
  return { width: video.style.width, height: video.style.height };
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: ZONE.w });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: ZONE.h });
});

afterEach(() => {
  // Rendu au prototype : les autres suites mesurent zéro, comme avant.
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
});

/**
 * Reproche de départ : en côte-à-côte, le proxy 480p s'affichait beaucoup plus petit que le
 * 1080p d'en face, perdu au centre de sa moitié entre deux larges bandes noires. La vidéo B
 * était rendue à sa **taille source** (`max-h-full max-w-full` ne rapetissant que ce qui
 * dépasse) là où le maître, lui, s'ajuste à sa boîte.
 */
describe('VideoComparePane — le pane B s’ajuste à sa boîte', () => {
  it('ajuste un proxy plus petit que son pane au lieu de le laisser à sa taille source', async () => {
    expect(await displayed([640, 360])).toEqual({ width: '800px', height: '450px' });
  });

  it('donne la même taille d’affichage au proxy et au master', async () => {
    const proxy = await displayed([640, 360]);
    cleanup();
    const master = await displayed([1920, 1080]);
    expect(proxy).toEqual(master);
  });

  it('respecte l’aspect du média : un portrait ne remplit pas toute la largeur', async () => {
    // 3:4 dans une zone de 800 × 600 : la hauteur commande, la largeur suit l'aspect —
    // l'ajustement est un « contain », il ne déforme jamais le média.
    expect(await displayed([1080, 1440])).toEqual({ width: '450px', height: '600px' });
  });

  it('propose la bascule vers le wipe, qui reste l’affaire de la barre d’options', async () => {
    api.get.mockResolvedValue({
      media: { id: 2, originalName: 'sintel_trailer.mp4' },
      url: 'https://example.invalid/sintel.mp4',
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <VideoComparePane
          compareId={2}
          masterRef={createRef<HTMLVideoElement>()}
          onClose={() => {}}
          onWipe={() => {}}
        />
      </QueryClientProvider>,
    );
    expect(await screen.findByTitle(t('review.compare.toWipe'))).toBeTruthy();
  });
});
