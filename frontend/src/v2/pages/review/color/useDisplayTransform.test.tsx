// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { mockApi } from '@/test/apiMock';
import { useDisplayTransform } from './useDisplayTransform';

const CONFIG = 'cfg-1';
const SRC = 'https://minio.test/media/plate.jpg';

const wrapper = () => {
  const client = createTestQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};

/**
 * The hook no longer reads any review setting: the Color panel is removed (Phase 50) and
 * the transform is the project's. The "toggle off does not query the LUT" test therefore
 * has no purpose left and disappears with the toggle. What still holds: without a project
 * config nothing is requested, and without a baked LUT nothing is overlaid.
 */
describe('useDisplayTransform', () => {
  it('without a project colour configuration, nothing is overlaid and nothing is requested from the server', () => {
    const api = mockApi({});
    const { result } = renderHook(() => useDisplayTransform(SRC, null), { wrapper: wrapper() });
    expect(result.current.url).toBeNull();
    expect(api.calls).toHaveLength(0);
    api.restore();
  });

  it('a display/view pair absent from the loaded config overlays nothing', async () => {
    const api = mockApi({
      [`GET /api/studio/ocio/configs/${CONFIG}/displays`]: {
        displays: [{ name: 'sRGB - Display', views: ['ACES 1.0 - SDR Video'] }],
      },
      [`GET /api/studio/ocio/configs/${CONFIG}/lut`]: {
        lut: { url: null, size: 33, reason: 'OCIO_TOOLING_REQUIRED' },
      },
    });
    const { result } = renderHook(
      () => useDisplayTransform(SRC, { configId: CONFIG, display: 'Gone - Display', view: 'Raw' }),
      { wrapper: wrapper() },
    );
    // The config is requested; the project pair is not in it, so there is nothing to apply.
    // (The LUT itself may have been requested at the first render: until the list arrives,
    // we trust the project. This is the deliberate fallback of `resolveDisplayView`.)
    await waitFor(() =>
      expect(api.called(`GET /api/studio/ocio/configs/${CONFIG}/displays`)).toHaveLength(1),
    );
    expect(result.current.url).toBeNull();
    api.restore();
  });

  it('without a baked LUT, nothing is overlaid on the image', async () => {
    const api = mockApi({
      [`GET /api/studio/ocio/configs/${CONFIG}/displays`]: {
        displays: [{ name: 'sRGB - Display', views: ['ACES 1.0 - SDR Video'] }],
      },
      [`GET /api/studio/ocio/configs/${CONFIG}/lut`]: {
        lut: { url: null, size: 33, reason: 'OCIO_TOOLING_REQUIRED' },
      },
    });
    const { result } = renderHook(
      () =>
        useDisplayTransform(SRC, {
          configId: CONFIG,
          display: 'sRGB - Display',
          view: 'ACES 1.0 - SDR Video',
        }),
      { wrapper: wrapper() },
    );
    await waitFor(() => expect(api.called(`GET /api/studio/ocio/configs/${CONFIG}/lut`)).toHaveLength(1));
    expect(result.current.url).toBeNull();
    api.restore();
  });
});
