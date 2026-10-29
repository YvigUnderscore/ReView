// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { mockApi } from '@/test/apiMock';
import { splitAnnotationParts, type MediaResp } from './reviewTypes';
import type { SplatPaintState } from './splat/paint/useSplatPaint';
import { useAnnotations } from './useAnnotations';
import { useSubmitComment } from './useSubmitComment';
import type { CameraAnimV2 } from './camera/channels/model';
import { animPlayDuration } from './camera/channels/model';
import { sampleAnimV2 } from './camera/channels/hermite';

/**
 * The camera animation attached to a comment must ARRIVE at the server and REPLAY identically on
 * read-back.
 *
 * What these tests lock down: the `camera-anim` part is sent **in full**. It used to be copied field by
 * field on send (`version`, `loop`, `channels`), which left `durationMs` — the adjustable playback
 * duration, Phase 27 — on the dock: the animation arrived, but looped on its last key time instead of
 * the wanted duration. A replay that is not identical is a lost presentation, not a display detail.
 */

const media = { media: { id: 7, kind: 'MODEL_3D' } } as unknown as MediaResp;

const paint = {
  serializePending: () => [],
  clearPending: () => undefined,
} as unknown as SplatPaintState;

const key = (t: number, v: number) => ({ t, v, mode: 'auto' as const });

/** A simple dolly shot: the position moves away, the target stays, and the loop lasts 4 s. */
const anim = (): CameraAnimV2 => ({
  version: 2,
  loop: true,
  durationMs: 4_000,
  channels: {
    px: { keys: [key(0, 0), key(2_000, 10)] },
    py: { keys: [key(0, 1), key(2_000, 3)] },
    pz: { keys: [key(0, 5), key(2_000, 5)] },
    tx: { keys: [key(0, 0), key(2_000, 0)] },
    ty: { keys: [key(0, 0), key(2_000, 0)] },
    tz: { keys: [key(0, 0), key(2_000, 0)] },
  },
});

function harness() {
  const api = mockApi({ 'POST /api/comments': { comment: { id: 42 } } });
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

describe('useSubmitComment — camera animation attached to the comment', () => {
  it('sends the camera-anim part in full, playback duration included', async () => {
    current = harness();
    const { hook, body } = current;
    act(() => hook.result.current.ann.setCameraAnim(anim()));
    await act(async () => {
      expect(await hook.result.current.submit('check PIP animation', [])).toBe(true);
    });

    const parts = body().annotation as Array<Record<string, unknown>>;
    const part = parts.find((p) => p.type === 'camera-anim');
    expect(part).toBeDefined();
    expect(part?.version).toBe(2);
    expect(part?.loop).toBe(true);
    // The adjustable playback duration is part of the animation: without it, the replay loops elsewhere.
    expect(part?.durationMs).toBe(4_000);
    expect(Object.keys(part?.channels as object).sort()).toEqual(['px', 'py', 'pz', 'tx', 'ty', 'tz']);
  });

  it('reads back and replays identically from the received annotation', async () => {
    current = harness();
    const { hook, body } = current;
    const source = anim();
    act(() => hook.result.current.ann.setCameraAnim(source));
    await act(async () => {
      await hook.result.current.submit('check PIP animation', []);
    });

    // Read-back through the real path of the comment thread.
    const read = splitAnnotationParts(body().annotation).cameraAnim;
    expect(read).not.toBeNull();
    expect(animPlayDuration(read as CameraAnimV2)).toBe(animPlayDuration(source));
    const base = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
    for (const t of [0, 500, 1_000, 1_999, 2_000]) {
      expect(sampleAnimV2(read as CameraAnimV2, t, base)).toEqual(sampleAnimV2(source, t, base));
    }
  });

  it('no longer sends anything once it has been detached', async () => {
    // The transport button is a toggle: detaching must really empty the part, otherwise the user
    // would believe they removed what is still sent.
    current = harness();
    const { hook, body } = current;
    act(() => hook.result.current.ann.setCameraAnim(anim()));
    act(() => hook.result.current.ann.setCameraAnim(null));
    await act(async () => {
      await hook.result.current.submit('no animation', []);
    });
    const parts = (body().annotation ?? []) as Array<Record<string, unknown>>;
    expect(parts.some((p) => p.type === 'camera-anim')).toBe(false);
  });

  it('forgets the animation once the comment has left', async () => {
    current = harness();
    const { hook } = current;
    act(() => hook.result.current.ann.setCameraAnim(anim()));
    await act(async () => {
      await hook.result.current.submit('check PIP animation', []);
    });
    expect(hook.result.current.ann.cameraAnim).toBeNull();
  });
});
