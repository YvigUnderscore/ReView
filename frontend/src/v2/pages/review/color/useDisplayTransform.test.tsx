// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { createTestQueryClient } from '../../../../test/renderWithProviders';
import { mockApi } from '../../../../test/apiMock';
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
 * Le hook ne lit plus aucun réglage de review : le panneau Color est retiré (Phase 50) et la
 * transformée est celle du projet. Le test « la bascule coupée n'interroge pas la LUT » n'a donc
 * plus d'objet et disparaît avec la bascule ; ce qui compte reste vrai — sans config de projet
 * on ne demande rien, et sans LUT cuite on ne superpose rien.
 */
describe('useDisplayTransform', () => {
  it('sans configuration couleur de projet, rien n’est superposé et rien n’est demandé au serveur', () => {
    const api = mockApi({});
    const { result } = renderHook(() => useDisplayTransform(SRC, null), { wrapper: wrapper() });
    expect(result.current.url).toBeNull();
    expect(api.calls).toHaveLength(0);
    api.restore();
  });

  it('un couple display/view absent de la config chargée ne superpose rien', async () => {
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
    // La config est demandée ; le couple du projet n'y est pas, donc plus rien à appliquer.
    // (La LUT, elle, a pu être demandée au premier rendu : tant que la liste n'est pas
    // arrivée, on fait confiance au projet — c'est le repli assumé de `resolveDisplayView`.)
    await waitFor(() =>
      expect(api.called(`GET /api/studio/ocio/configs/${CONFIG}/displays`)).toHaveLength(1),
    );
    expect(result.current.url).toBeNull();
    api.restore();
  });

  it('sans LUT cuite, rien n’est superposé à l’image', async () => {
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
