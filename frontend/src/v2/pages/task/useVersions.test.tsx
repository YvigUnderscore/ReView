// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { mockApi, httpError, noContent, type ApiMock } from '@/test/apiMock';
import { createTestQueryClient } from '@/test/renderWithProviders';
import { useVersions } from './useVersions';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

let api: ApiMock;
afterEach(() => {
  api.restore();
  toast.success.mockReset();
  toast.error.mockReset();
});

const mount = (scope: Parameters<typeof useVersions>[0]) => {
  const qc = createTestQueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return renderHook(() => useVersions(scope), { wrapper });
};

describe('useVersions', () => {
  beforeEach(() => {
    api = mockApi({
      'GET /api/versions': ({ url }) => ({
        versions: [{ id: 1, name: `v001 ${url.searchParams.toString()}` }],
      }),
    });
  });

  it('lists the versions of the task or of the asset', async () => {
    const task = mount({ taskId: 4 });
    await waitFor(() => expect(task.result.current.versions).toHaveLength(1));
    expect(task.result.current.versions[0].name).toContain('taskId=4');
    const asset = mount({ assetId: 9 });
    await waitFor(() => expect(asset.result.current.versions[0]?.name).toContain('assetId=9'));
  });

  it('creates the next version, under the parent or under a chosen task', async () => {
    api.on('POST /api/versions', ({ body }) => ({ version: { id: 2, name: 'v002', ...(body as object) } }));
    const { result } = mount({ assetId: 9 });
    let created: unknown;
    await act(async () => {
      created = await result.current.createVersion();
    });
    expect(created).toMatchObject({ name: 'v002', assetId: 9 });
    await act(async () => {
      await result.current.createVersion({ taskId: 5 });
    });
    expect(api.called('POST /api/versions').map((c) => c.body)).toEqual([{ assetId: 9 }, { taskId: 5 }]);
    expect(toast.success).toHaveBeenCalledTimes(2);
  });

  it('returns null and says why when creation fails', async () => {
    api.on('POST /api/versions', httpError(403, 'No rights'));
    const { result } = mount({ taskId: 4 });
    let created: unknown = 'unset';
    await act(async () => {
      created = await result.current.createVersion();
    });
    expect(created).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('No rights');
  });

  it('publishes, trashes, and reports each failure', async () => {
    api
      .on('POST /api/versions/:id/publish', {})
      .on('POST /api/media/:id/publish', {})
      .on('DELETE /api/versions/:id', noContent())
      .on('DELETE /api/media/:id', httpError(409, 'Media in use'));
    const { result } = mount({ taskId: 4 });
    await act(async () => {
      await result.current.publishVersion(1);
      await result.current.publishMedia(1, 7);
      await result.current.removeVersion(1);
      await result.current.removeMedia(1, 7);
    });
    expect(api.called('POST /api/versions/:id/publish')).toHaveLength(1);
    expect(api.called('POST /api/media/:id/publish')).toHaveLength(1);
    expect(api.called('DELETE /api/versions/:id')).toHaveLength(1);
    expect(toast.success).toHaveBeenCalledTimes(3);
    expect(toast.error).toHaveBeenCalledWith('Media in use');
  });

  it('reports publish and trash failures', async () => {
    api
      .on('POST /api/versions/:id/publish', httpError(500, 'Down'))
      .on('POST /api/media/:id/publish', httpError(500, 'Down'))
      .on('DELETE /api/versions/:id', httpError(500, 'Down'));
    const { result } = mount({ taskId: 4 });
    await act(async () => {
      await result.current.publishVersion(1);
      await result.current.publishMedia(1, 7);
      await result.current.removeVersion(1);
    });
    expect(toast.error).toHaveBeenCalledTimes(3);
  });
});
