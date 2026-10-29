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

/** happy-dom lays nothing out: the pane's media area measures 800 × 600. */
const ZONE = { w: 800, h: 600 };

/**
 * Mounts pane B, waits for its media, then announces the resolution as `loadedmetadata`
 * would. Returns the display size chosen for the video.
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
  // The media arrives: its name appears in the pane header.
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
  // Rendered on the prototype: the other suites measure zero, as before.
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
});

/**
 * Original complaint: side by side, the 480p proxy showed much smaller than the 1080p
 * opposite it, lost in the middle of its half between two wide black bands. Video B was
 * rendered at its **source size** (`max-h-full max-w-full` only shrinks what overflows),
 * whereas the master fits its box.
 */
describe('VideoComparePane — pane B fits its box', () => {
  it('fits a proxy smaller than its pane instead of leaving it at its source size', async () => {
    expect(await displayed([640, 360])).toEqual({ width: '800px', height: '450px' });
  });

  it('gives the proxy and the master the same display size', async () => {
    const proxy = await displayed([640, 360]);
    cleanup();
    const master = await displayed([1920, 1080]);
    expect(proxy).toEqual(master);
  });

  it('respects the media aspect: a portrait does not fill the whole width', async () => {
    // 3:4 in an 800 × 600 area: the height drives, the width follows the aspect —
    // the fit is a "contain", it never distorts the media.
    expect(await displayed([1080, 1440])).toEqual({ width: '450px', height: '600px' });
  });

  it('offers the switch to wipe, which remains the job of the options bar', async () => {
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
