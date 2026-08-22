// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createTestQueryClient } from '../../../../test/renderWithProviders';
import { mockApi } from '../../../../test/apiMock';
import { useDisplayTransform } from './useDisplayTransform';
import { useColorGrade } from './useColorGrade';

const CONFIG = 'cfg-1';
const SRC = 'https://minio.test/media/plate.jpg';

const wrapper = () => {
  const client = createTestQueryClient();
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
};

describe('useDisplayTransform', () => {
  beforeEach(() => {
    localStorage.clear();
    useColorGrade.getState().reset();
  });

  it('sans configuration couleur, rien n’est superposé et rien n’est demandé au serveur', () => {
    const api = mockApi({});
    const { result } = renderHook(() => useDisplayTransform(SRC, null), { wrapper: wrapper() });
    expect(result.current.url).toBeNull();
    expect(api.calls).toHaveLength(0);
    api.restore();
  });

  it('la bascule coupée n’interroge ni la config ni la LUT', () => {
    useColorGrade.getState().set({ enabled: false });
    const api = mockApi({});
    const { result } = renderHook(
      () => useDisplayTransform(SRC, { configId: CONFIG, display: 'sRGB - Display', view: 'Raw' }),
      { wrapper: wrapper() },
    );
    expect(result.current.url).toBeNull();
    expect(api.called(`GET /api/studio/ocio/configs/${CONFIG}/lut`)).toHaveLength(0);
    api.restore();
  });

  it('sans LUT cuite et sans réglage, rien n’est superposé à l’image', async () => {
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
