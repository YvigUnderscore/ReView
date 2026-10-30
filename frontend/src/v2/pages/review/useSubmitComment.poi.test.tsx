// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { mockApi } from '@/test/apiMock';
import type { MediaResp } from './reviewTypes';
import type { SplatPaintState } from './splat/paint/useSplatPaint';
import { useAnnotations } from './useAnnotations';
import { useSubmitComment } from './useSubmitComment';

/**
 * The send contract: **a single comment is sent**, it carries all the numbered points, their text is
 * copied into its own, and their images are the comment's attachments — each point noting which ones
 * are its own.
 */

const img = (name: string) => new File(['x'], name, { type: 'image/png' });

const media = { media: { id: 7, kind: 'SPLAT' } } as unknown as MediaResp;

const paint = {
  serializePending: () => [],
  clearPending: () => undefined,
} as unknown as SplatPaintState;

function harness() {
  let keys = 0;
  const api = mockApi({
    'POST /api/comments/attachments/presign': () => ({ url: '/upload/put', key: `key-${keys++}` }),
    'PUT /upload/put': () => new Response(null, { status: 200 }),
    'POST /api/comments': { comment: { id: 42 } },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => {
      const ann = useAnnotations();
      const submit = useSubmitComment({
        id: 7,
        data: media,
        ann,
        paint,
        videoRef: { current: null },
        captureCamera: () => undefined,
        loadComments: () => Promise.resolve(undefined),
      });
      return { ann, submit };
    },
    { wrapper },
  );
  return { api, hook, body: () => api.called('POST /api/comments')[0]?.body as Record<string, unknown> };
}

let current: ReturnType<typeof harness> | null = null;
afterEach(() => current?.api.restore());

describe('useSubmitComment — one carrying comment, numbered points', () => {
  it('sends ONE comment carrying the three points, and their numbered text', async () => {
    current = harness();
    const { hook, body } = current;
    act(() => {
      hook.result.current.ann.poi.add({ position: '0 0 0', normal: '0 0 1', space: 'object' });
      hook.result.current.ann.poi.add({ position: '1 0 0', normal: '0 0 1', space: 'object' });
      hook.result.current.ann.poi.add({ position: '2 0 0', normal: '0 0 1', space: 'object' });
    });
    const keys = hook.result.current.ann.poi.points.map((p) => p.key);
    act(() => {
      hook.result.current.ann.poi.setText(keys[0], 'the solder');
      hook.result.current.ann.poi.setText(keys[1], 'the bolt');
    });
    await act(async () => {
      expect(await hook.result.current.submit('Two issues:', [])).toBe(true);
    });

    expect(current.api.called('POST /api/comments')).toHaveLength(1);
    const sent = body();
    expect(sent.content).toBe('Two issues:\n\n1. the solder\n2. the bolt\n3.');
    const parts = sent.annotation as { type: string; points?: unknown[] }[];
    const poi = parts.find((p) => p.type === 'poi');
    expect(poi?.points).toHaveLength(3);
    expect((poi?.points as { position: string }[])[2].position).toBe('2 0 0');
  });

  it('attaches the images of a point to the comment, and the point keeps their keys', async () => {
    current = harness();
    const { hook, body } = current;
    act(() => {
      hook.result.current.ann.poi.add({ position: '0 0 0', normal: '0 0 1', space: 'object' });
      hook.result.current.ann.poi.add({ position: '1 0 0', normal: '0 0 1', space: 'object' });
    });
    const keys = hook.result.current.ann.poi.points.map((p) => p.key);
    act(() => {
      hook.result.current.ann.poi.addFiles(keys[0], [img('un.png'), img('deux.png')]);
      hook.result.current.ann.poi.addFiles(keys[1], [img('trois.png')]);
    });
    await act(async () => {
      await hook.result.current.submit('', [img('libre.png')]);
    });

    const sent = body();
    expect(sent.attachments).toHaveLength(4);
    const poi = (sent.annotation as { type: string; points?: { images?: string[] }[] }[]).find(
      (p) => p.type === 'poi',
    );
    expect(poi?.points?.[0].images).toEqual(['key-0', 'key-1']);
    expect(poi?.points?.[1].images).toEqual(['key-2']);
    // The fourth attachment is the composer's: it belongs to no point.
    expect(poi?.points?.every((p) => !p.images?.includes('key-3'))).toBe(true);
  });

  it('empties the points once the comment has left', async () => {
    current = harness();
    const { hook } = current;
    act(() => {
      hook.result.current.ann.poi.add({ position: '0 0 0', normal: '0 0 1', space: 'object' });
    });
    await act(async () => {
      await hook.result.current.submit('', []);
    });
    expect(hook.result.current.ann.poi.points).toHaveLength(0);
  });
});
