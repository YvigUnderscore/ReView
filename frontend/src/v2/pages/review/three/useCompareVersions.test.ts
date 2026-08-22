// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { MediaSummary } from '../../../types/api';
import { mergeCompareMedia, useCompareVersions } from './useCompareVersions';

afterEach(cleanup);

const media = (id: number, originalName = `m${id}.glb`): MediaSummary => ({
  id,
  kind: 'MODEL_3D',
  status: 'READY',
  originalName,
  published: true,
});

describe('useCompareVersions', () => {
  it('mémorise le média résolu par le sélecteur, sans doublon', () => {
    const { result } = renderHook(() => useCompareVersions());
    act(() => result.current.add(7, media(7)));
    act(() => result.current.add(7, media(7)));
    expect(result.current.ids).toEqual([7]);
    act(() => result.current.add(9, media(9)));
    expect(result.current.extras.map((m) => m.originalName)).toEqual(['m7.glb', 'm9.glb']);
  });

  it('ignore un ajout sans résumé de média (rien à nommer dans la barre)', () => {
    const { result } = renderHook(() => useCompareVersions());
    act(() => result.current.add(7));
    expect(result.current.ids).toEqual([]);
  });

  it('retire une version et remplace toute la sélection en mode exclusif', () => {
    const { result } = renderHook(() => useCompareVersions());
    act(() => result.current.add(7, media(7)));
    act(() => result.current.add(9, media(9)));
    act(() => result.current.remove(7));
    expect(result.current.ids).toEqual([9]);
    act(() => result.current.set(11, media(11)));
    expect(result.current.ids).toEqual([11]);
    act(() => result.current.set(null));
    expect(result.current.ids).toEqual([]);
  });
});

describe('mergeCompareMedia', () => {
  it('place les frères en tête, puis les autres versions, sans doublon', () => {
    const merged = mergeCompareMedia([media(1), media(2)], [media(2), media(5)]);
    expect(merged.map((m) => m.id)).toEqual([1, 2, 5]);
  });

  it('supporte des listes vides des deux côtés', () => {
    expect(mergeCompareMedia([], [])).toEqual([]);
    expect(mergeCompareMedia([], [media(3)]).map((m) => m.id)).toEqual([3]);
  });
});
