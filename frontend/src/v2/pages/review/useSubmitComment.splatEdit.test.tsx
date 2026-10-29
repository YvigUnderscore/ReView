// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { mockApi } from '../../../test/apiMock';
import { splitAnnotationParts, type MediaResp, type SplatEdits } from './reviewTypes';
import type { SplatEditDraft } from './splat/splatEditPart';
import type { SplatPaintState } from './splat/paint/useSplatPaint';
import { useAnnotations } from './useAnnotations';
import { useSubmitComment } from './useSubmitComment';

/**
 * A point-cloud edit goes OUT WITH the comment and is replayed on reading — the mechanism requested,
 * the one of the 3D scene proposal. It is the only route once the version is published, so what is
 * checked here is the nominal path, not an edge case.
 *
 * The gesture leaves IN FULL: the transform and volumes in the part, the deletions and subset
 * transforms as attachments of the comment, cited by their key.
 */
const splat = { media: { id: 7, kind: 'SPLAT' } } as unknown as MediaResp;
const model = { media: { id: 8, kind: 'MODEL_3D' } } as unknown as MediaResp;

const paint = {
  serializePending: () => [],
  clearPending: () => undefined,
} as unknown as SplatPaintState;

const edits: SplatEdits = {
  transform: { position: [1, 0, -2], quaternion: [0, 0.7071, 0, 0.7071], scale: [1.5, 1.5, 1.5] },
  volumes: [
    {
      shape: 'box',
      mode: 'delete',
      position: [0, 1, 0],
      quaternion: [0, 0, 0, 1],
      scale: [2, 2, 2],
    },
  ],
  baseFlip: false,
};
const draft: SplatEditDraft = { edits, mask: { bytes: new Uint8Array([5]), count: 2 }, subset: null };

function harness(data: MediaResp) {
  const api = mockApi({
    'POST /api/comments': { comment: { id: 42 } },
    'POST /api/comments/attachments/presign': ({ body }) => ({
      url: 'https://minio/put',
      key: 'comments/attachments/7/' + (body as { filename: string }).filename,
    }),
    'PUT /put': {},
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(
    () => {
      const ann = useAnnotations();
      const submit = useSubmitComment({
        id: data.media.id,
        data,
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

/** The splat editor, seen from the composer: a provider, plus a callback when the note has left. */
function provide(hook: ReturnType<typeof harness>['hook'], value: SplatEditDraft | null) {
  const sent = vi.fn();
  act(() => hook.result.current.ann.provideSplatEdit({ build: () => value, sent }));
  return sent;
}

describe('useSubmitComment — point-cloud edit attached to the comment', () => {
  it('sends the splat-edit part, and it reads back identically', async () => {
    current = harness(splat);
    const { hook, body } = current;
    provide(hook, { edits, mask: null, subset: null });
    await act(async () => {
      expect(await hook.result.current.submit('reframe the cloud', [])).toBe(true);
    });
    const parts = body().annotation as Array<Record<string, unknown>>;
    expect(parts.find((p) => p.type === 'splat-edit')).toBeDefined();
    // Read-back through the real path of the comment thread: this is what the viewer will replay.
    expect(splitAnnotationParts(body().annotation).splatEdit).toEqual({
      ...edits,
      mask: null,
      subset: null,
    });
  });

  /** The wave-1 gap: the deletions stayed on the ground. They travel, by reference. */
  it('deposits the deletion mask as an attachment and cites it in the part', async () => {
    current = harness(splat);
    const { hook, body, api } = current;
    provide(hook, draft);
    await act(async () => {
      await hook.result.current.submit('clean up the cloud', []);
    });
    const key = 'comments/attachments/7/splat-mask.bin';
    expect(api.called('PUT /put')).toHaveLength(1);
    // The attachment is declared to the comment: it is THAT which the purge re-reads at edit as well as
    // at deletion, and it is through it that the read-back finds a URL.
    expect(body().attachments).toEqual([
      { key, name: 'splat-mask.bin', contentType: 'application/octet-stream' },
    ]);
    expect(splitAnnotationParts(body().annotation).splatEdit?.mask).toEqual({ key, count: 2 });
  });

  it('attaches nothing when the editor proposed nothing', async () => {
    current = harness(splat);
    const { hook, body, api } = current;
    provide(hook, null);
    await act(async () => {
      await hook.result.current.submit('just a word', []);
    });
    const parts = (body().annotation ?? []) as Array<Record<string, unknown>>;
    expect(parts.some((p) => p.type === 'splat-edit')).toBe(false);
    expect(body().attachments).toBeUndefined();
    expect(api.called('POST /api/comments/attachments/presign')).toHaveLength(0);
  });

  it('attaches nothing on a 3D model: there, scene-override carries the proposal', async () => {
    current = harness(model);
    const { hook, body } = current;
    provide(hook, draft);
    await act(async () => {
      await hook.result.current.submit('3D scene', []);
    });
    const parts = (body().annotation ?? []) as Array<Record<string, unknown>>;
    expect(parts.some((p) => p.type === 'splat-edit')).toBe(false);
  });

  it('hands control back to the editor once the comment has left', async () => {
    current = harness(splat);
    const { hook } = current;
    const sent = provide(hook, draft);
    await act(async () => {
      await hook.result.current.submit('reframe the cloud', []);
    });
    // The proposal must not re-attach itself to the next comment (46.T): it is the editor that takes
    // its state back, notified here.
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('releases the proposal read when leaving the comment', () => {
    current = harness(splat);
    const { hook } = current;
    const viewed = { ...edits, maskUrl: null, subsetUrl: null, maskCount: 0, subsetCount: 0 };
    act(() => hook.result.current.ann.setViewedSplatEdit(viewed));
    expect(hook.result.current.ann.viewedSplatEdit).toEqual(viewed);
    act(() => hook.result.current.ann.clearViewed());
    expect(hook.result.current.ann.viewedSplatEdit).toBeNull();
  });
});
