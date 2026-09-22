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
 * L'édition d'un nuage part DANS le commentaire et se rejoue à sa lecture — la mécanique
 * demandée, celle de la proposition de scène 3D. C'est la seule voie une fois la version
 * publiée, donc ce qui est vérifié ici est le chemin nominal, pas un cas limite.
 *
 * Le geste part ENTIER : la transformation et les volumes dans la part, les suppressions et les
 * transformations de sous-ensembles en pièces jointes du commentaire, citées par leur clé.
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

/** L'éditeur splat, vu du composeur : un fournisseur, plus un rappel quand la note est partie. */
function provide(hook: ReturnType<typeof harness>['hook'], value: SplatEditDraft | null) {
  const sent = vi.fn();
  act(() => hook.result.current.ann.provideSplatEdit({ build: () => value, sent }));
  return sent;
}

describe('useSubmitComment — édition de nuage jointe au commentaire', () => {
  it('envoie la part splat-edit, et elle se relit à l’identique', async () => {
    current = harness(splat);
    const { hook, body } = current;
    provide(hook, { edits, mask: null, subset: null });
    await act(async () => {
      expect(await hook.result.current.submit('recadrer le nuage', [])).toBe(true);
    });
    const parts = body().annotation as Array<Record<string, unknown>>;
    expect(parts.find((p) => p.type === 'splat-edit')).toBeDefined();
    // Relecture par le chemin réel du fil de commentaires : c'est ce que le viewer rejouera.
    expect(splitAnnotationParts(body().annotation).splatEdit).toEqual({
      ...edits,
      mask: null,
      subset: null,
    });
  });

  /** Le trou de la vague 1 : les suppressions restaient au sol. Elles voyagent, par référence. */
  it('dépose le masque de suppression en pièce jointe et le cite dans la part', async () => {
    current = harness(splat);
    const { hook, body, api } = current;
    provide(hook, draft);
    await act(async () => {
      await hook.result.current.submit('nettoyer le nuage', []);
    });
    const key = 'comments/attachments/7/splat-mask.bin';
    expect(api.called('PUT /put')).toHaveLength(1);
    // La pièce est déclarée au commentaire : c'est ELLE que la purge relit à l'édition comme à
    // la suppression, et c'est par elle que la lecture retrouvera une URL.
    expect(body().attachments).toEqual([
      { key, name: 'splat-mask.bin', contentType: 'application/octet-stream' },
    ]);
    expect(splitAnnotationParts(body().annotation).splatEdit?.mask).toEqual({ key, count: 2 });
  });

  it('ne joint rien quand l’éditeur n’a rien proposé', async () => {
    current = harness(splat);
    const { hook, body, api } = current;
    provide(hook, null);
    await act(async () => {
      await hook.result.current.submit('juste un mot', []);
    });
    const parts = (body().annotation ?? []) as Array<Record<string, unknown>>;
    expect(parts.some((p) => p.type === 'splat-edit')).toBe(false);
    expect(body().attachments).toBeUndefined();
    expect(api.called('POST /api/comments/attachments/presign')).toHaveLength(0);
  });

  it('ne joint rien sur un modèle 3D : là, c’est scene-override qui porte la proposition', async () => {
    current = harness(model);
    const { hook, body } = current;
    provide(hook, draft);
    await act(async () => {
      await hook.result.current.submit('scène 3D', []);
    });
    const parts = (body().annotation ?? []) as Array<Record<string, unknown>>;
    expect(parts.some((p) => p.type === 'splat-edit')).toBe(false);
  });

  it('rend la main à l’éditeur une fois le commentaire parti', async () => {
    current = harness(splat);
    const { hook } = current;
    const sent = provide(hook, draft);
    await act(async () => {
      await hook.result.current.submit('recadrer le nuage', []);
    });
    // La proposition ne doit pas se rejoindre d'elle-même au commentaire suivant (46.T) : c'est
    // l'éditeur qui reprend son état, prévenu ici.
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it('relâche la proposition lue quand on quitte le commentaire', () => {
    current = harness(splat);
    const { hook } = current;
    const viewed = { ...edits, maskUrl: null, subsetUrl: null, maskCount: 0, subsetCount: 0 };
    act(() => hook.result.current.ann.setViewedSplatEdit(viewed));
    expect(hook.result.current.ann.viewedSplatEdit).toEqual(viewed);
    act(() => hook.result.current.ann.clearViewed());
    expect(hook.result.current.ann.viewedSplatEdit).toBeNull();
  });
});
