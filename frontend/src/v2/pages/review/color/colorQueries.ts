// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { parseCubeLut, type CubeLut } from './cubeLut';

/**
 * Lecture des données couleur du studio pour le viewer : displays/views de la config du
 * projet, puis la LUT cuite du couple choisi.
 *
 * Une LUT cuite est **immuable** (une nouvelle config = un nouvel identifiant) : elle est
 * gardée une heure en cache et n'est jamais rejouée au montage.
 */

/** Une config OCIO expose des displays, chacun avec ses views. */
export interface OcioDisplay {
  name: string;
  views: string[];
}

const LUT_STALE_MS = 60 * 60 * 1000;

/**
 * Clé de la LUT. Elle vivra mieux dans `v2/lib/query.ts` (`qk.ocioLut`) : ce lot n'a pas la
 * main sur ce fichier, la forme hiérarchique `['ocio', …]` y est déjà celle des configs.
 */
export const ocioLutKey = (configId: string, display: string, view: string) =>
  ['ocio', 'lut', configId, display, view] as const;

/** Displays/views de la config couleur du projet (vide tant qu'aucune config n'est posée). */
export function useOcioDisplays(configId: string | null | undefined) {
  return useQuery({
    queryKey: qk.ocioDisplays(configId ?? 'none'),
    queryFn: () => api.get<{ displays: OcioDisplay[] }>(`/api/studio/ocio/configs/${configId}/displays`),
    enabled: !!configId,
    staleTime: LUT_STALE_MS,
    select: (d) => d.displays,
  });
}

/** Réponse du serveur : soit une LUT à télécharger, soit la raison de son absence. */
interface LutInfoResp {
  lut: { url: string | null; size: number; reason: 'OCIO_TOOLING_REQUIRED' | null };
}

export interface DisplayLut {
  lut: CubeLut | null;
  reason: 'OCIO_TOOLING_REQUIRED' | null;
}

/**
 * LUT 3D d'un couple display/view : demande son URL présignée au backend (qui la cuit si
 * elle manque et qu'il sait le faire), puis télécharge et parse le `.cube`.
 */
export function useDisplayLut(
  target: { configId: string; display: string; view: string } | null,
  enabled = true,
) {
  return useQuery({
    queryKey: target
      ? ocioLutKey(target.configId, target.display, target.view)
      : (['ocio', 'lut', 'none'] as const),
    enabled: !!target && enabled,
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

/** Image source décodée, prête à devenir une texture (CORS armé : le canvas reste lisible). */
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
