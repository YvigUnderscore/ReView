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
  it('memorizes the media resolved by the selector, without duplicates', () => {
    const { result } = renderHook(() => useCompareVersions());
    act(() => result.current.add(7, media(7)));
    act(() => result.current.add(7, media(7)));
    expect(result.current.ids).toEqual([7]);
    act(() => result.current.add(9, media(9)));
    expect(result.current.extras.map((m) => m.originalName)).toEqual(['m7.glb', 'm9.glb']);
  });

  it('ignores an addition without a media summary (nothing to name in the bar)', () => {
    const { result } = renderHook(() => useCompareVersions());
    act(() => result.current.add(7));
    expect(result.current.ids).toEqual([]);
  });

  it('removes a version and replaces the whole selection in exclusive mode', () => {
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
  it('places the siblings first, then the other versions, without duplicates', () => {
    const merged = mergeCompareMedia([media(1), media(2)], [media(2), media(5)]);
    expect(merged.map((m) => m.id)).toEqual([1, 2, 5]);
  });

  it('supports empty lists on both sides', () => {
    expect(mergeCompareMedia([], [])).toEqual([]);
    expect(mergeCompareMedia([], [media(3)]).map((m) => m.id)).toEqual([3]);
  });
});
