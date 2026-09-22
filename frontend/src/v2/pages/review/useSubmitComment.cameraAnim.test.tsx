// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { mockApi } from '../../../test/apiMock';
import { splitAnnotationParts, type MediaResp } from './reviewTypes';
import type { SplatPaintState } from './splat/paint/useSplatPaint';
import { useAnnotations } from './useAnnotations';
import { useSubmitComment } from './useSubmitComment';
import type { CameraAnimV2 } from './camera/channels/model';
import { animPlayDuration } from './camera/channels/model';
import { sampleAnimV2 } from './camera/channels/hermite';

/**
 * L'animation caméra jointe à un commentaire doit ARRIVER au serveur et se REJOUER à
 * l'identique à la relecture.
 *
 * Ce que ces tests verrouillent : la part `camera-anim` part **entière**. Elle était
 * recopiée champ par champ à l'envoi (`version`, `loop`, `channels`), ce qui laissait
 * `durationMs` — la durée de lecture réglable, Phase 27 — sur le quai : l'animation arrivait,
 * mais bouclait sur le dernier temps de clé au lieu de la durée voulue. Un rejeu qui n'est pas
 * à l'identique est une présentation perdue, pas un détail d'affichage.
 */

const media = { media: { id: 7, kind: 'MODEL_3D' } } as unknown as MediaResp;

const paint = {
  serializePending: () => [],
  clearPending: () => undefined,
} as unknown as SplatPaintState;

const key = (t: number, v: number) => ({ t, v, mode: 'auto' as const });

/** Un travelling simple : la position s'éloigne, la cible reste, et la boucle dure 4 s. */
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

describe('useSubmitComment — animation caméra jointe au commentaire', () => {
  it('envoie la part camera-anim entière, durée de lecture comprise', async () => {
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
    // La durée de lecture réglable fait partie de l'animation : sans elle, le rejeu boucle ailleurs.
    expect(part?.durationMs).toBe(4_000);
    expect(Object.keys(part?.channels as object).sort()).toEqual(['px', 'py', 'pz', 'tx', 'ty', 'tz']);
  });

  it('se relit et se rejoue à l’identique depuis l’annotation reçue', async () => {
    current = harness();
    const { hook, body } = current;
    const source = anim();
    act(() => hook.result.current.ann.setCameraAnim(source));
    await act(async () => {
      await hook.result.current.submit('check PIP animation', []);
    });

    // Relecture par le chemin réel du fil de commentaires.
    const read = splitAnnotationParts(body().annotation).cameraAnim;
    expect(read).not.toBeNull();
    expect(animPlayDuration(read as CameraAnimV2)).toBe(animPlayDuration(source));
    const base = { position: { x: 0, y: 0, z: 0 }, target: { x: 0, y: 0, z: 0 } };
    for (const t of [0, 500, 1_000, 1_999, 2_000]) {
      expect(sampleAnimV2(read as CameraAnimV2, t, base)).toEqual(sampleAnimV2(source, t, base));
    }
  });

  it('n’envoie plus rien quand on l’a détachée', async () => {
    // Le bouton du transport est une bascule : détacher doit vraiment vider la part, sinon
    // l'utilisateur croirait avoir retiré ce qui part quand même.
    current = harness();
    const { hook, body } = current;
    act(() => hook.result.current.ann.setCameraAnim(anim()));
    act(() => hook.result.current.ann.setCameraAnim(null));
    await act(async () => {
      await hook.result.current.submit('sans animation', []);
    });
    const parts = (body().annotation ?? []) as Array<Record<string, unknown>>;
    expect(parts.some((p) => p.type === 'camera-anim')).toBe(false);
  });

  it('oublie l’animation une fois le commentaire parti', async () => {
    current = harness();
    const { hook } = current;
    act(() => hook.result.current.ann.setCameraAnim(anim()));
    await act(async () => {
      await hook.result.current.submit('check PIP animation', []);
    });
    expect(hook.result.current.ann.cameraAnim).toBeNull();
  });
});
