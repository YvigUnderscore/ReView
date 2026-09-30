// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { mockApi } from '../../../test/apiMock';
import type { MediaResp } from './reviewTypes';
import type { SplatPaintState } from './splat/paint/useSplatPaint';
import { useAnnotations } from './useAnnotations';
import { useSubmitComment } from './useSubmitComment';

/**
 * Le contrat d'envoi : **un seul commentaire part**, il porte tous les points numérotés, leur
 * texte est recopié dans le sien, et leurs images sont les pièces jointes du commentaire — chaque
 * point notant lesquelles sont les siennes.
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

describe('useSubmitComment — un commentaire porteur, des points numérotés', () => {
  it('envoie UN commentaire portant les trois points, et leur texte numéroté', async () => {
    current = harness();
    const { hook, body } = current;
    act(() => {
      hook.result.current.ann.poi.add({ position: '0 0 0', normal: '0 0 1', space: 'object' });
      hook.result.current.ann.poi.add({ position: '1 0 0', normal: '0 0 1', space: 'object' });
      hook.result.current.ann.poi.add({ position: '2 0 0', normal: '0 0 1', space: 'object' });
    });
    const keys = hook.result.current.ann.poi.points.map((p) => p.key);
    act(() => {
      hook.result.current.ann.poi.setText(keys[0], 'la soudure');
      hook.result.current.ann.poi.setText(keys[1], 'le boulon');
    });
    await act(async () => {
      expect(await hook.result.current.submit('Deux soucis :', [])).toBe(true);
    });

    expect(current.api.called('POST /api/comments')).toHaveLength(1);
    const sent = body();
    expect(sent.content).toBe('Deux soucis :\n\n1. la soudure\n2. le boulon\n3.');
    const parts = sent.annotation as { type: string; points?: unknown[] }[];
    const poi = parts.find((p) => p.type === 'poi');
    expect(poi?.points).toHaveLength(3);
    expect((poi?.points as { position: string }[])[2].position).toBe('2 0 0');
  });

  it('joint les images d’un point au commentaire, et le point garde leurs clés', async () => {
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
    // La quatrième pièce est celle du composeur : elle n'appartient à aucun point.
    expect(poi?.points?.every((p) => !p.images?.includes('key-3'))).toBe(true);
  });

  it('vide les points une fois le commentaire parti', async () => {
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
