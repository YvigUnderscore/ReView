// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { parseCubeLut, type CubeLut } from './cubeLut';

/**
 * Reads the studio color data for the viewer: displays/views of the project's config, then the
 * baked LUT of the chosen pair.
 *
 * A baked LUT is **immutable** (a new config = a new identifier): it is cached for an hour and is
 * never replayed on mount.
 */

/** An OCIO config exposes displays, each with its views. */
export interface OcioDisplay {
  name: string;
  views: string[];
}

const LUT_STALE_MS = 60 * 60 * 1000;

/**
 * LUT key. It would live better in `v2/lib/query.ts` (`qk.ocioLut`): this batch does not own that
 * file, and the hierarchical `['ocio', …]` shape is already the one used for configs.
 */
export const ocioLutKey = (configId: string, display: string, view: string) =>
  ['ocio', 'lut', configId, display, view] as const;

/** Displays/views of the project's color config (empty until a config is set). */
export function useOcioDisplays(configId: string | null | undefined) {
  return useQuery({
    queryKey: qk.ocioDisplays(configId ?? 'none'),
    queryFn: () => api.get<{ displays: OcioDisplay[] }>(`/api/studio/ocio/configs/${configId}/displays`),
    enabled: !!configId,
    staleTime: LUT_STALE_MS,
    select: (d) => d.displays,
  });
}

/** Server response: either a LUT to download, or the reason it is absent. */
interface LutInfoResp {
  lut: { url: string | null; size: number; reason: 'OCIO_TOOLING_REQUIRED' | null };
}

export interface DisplayLut {
  lut: CubeLut | null;
  reason: 'OCIO_TOOLING_REQUIRED' | null;
}

/**
 * 3D LUT of a display/view pair: requests its presigned URL from the backend (which bakes it if it
 * is missing and it knows how to), then downloads and parses the `.cube`.
 */
export function useDisplayLut(target: { configId: string; display: string; view: string } | null) {
  return useQuery({
    queryKey: target
      ? ocioLutKey(target.configId, target.display, target.view)
      : (['ocio', 'lut', 'none'] as const),
    enabled: !!target,
    staleTime: LUT_STALE_MS,
    gcTime: LUT_STALE_MS,
    retry: 0,
    queryFn: async (): Promise<DisplayLut> => {
      const { configId, display, view } = target!;
      const params = new URLSearchParams({ display, view });
      const { lut } = await api.get<LutInfoResp>(
        `/api/studio/ocio/configs/${configId}/lut?${params.toString()}`,
      );
      if (!lut.url) return { lut: null, reason: lut.reason ?? 'OCIO_TOOLING_REQUIRED' };
      const res = await fetch(lut.url);
      if (!res.ok) throw new Error('lut.download.failed');
      return { lut: parseCubeLut(await res.text()), reason: null };
    },
  });
}

/** Decoded source image, ready to become a texture (CORS enabled: the canvas stays readable). */
export function useSourceImage(src: string, enabled: boolean) {
  return useQuery({
    queryKey: ['image-source', src] as const,
    enabled: enabled && !!src,
    staleTime: LUT_STALE_MS,
    retry: 0,
    queryFn: () =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        if (!src.startsWith('data:')) img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('image load failed'));
        img.src = src;
      }),
  });
}
