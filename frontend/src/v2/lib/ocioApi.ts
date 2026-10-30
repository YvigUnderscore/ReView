// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { qk } from './query';

/** An OCIO config installed on the studio. */
export interface OcioConfig {
  id: string;
  name: string;
  kind: 'studio' | 'cg';
  acesVersion: string;
  releaseTag: string;
  isDefault: boolean;
}

export interface OcioAsset {
  assetName: string;
  sizeBytes: number;
  label: string;
  installed: boolean;
  recommendedDefault: boolean;
  info: { acesVersion: string };
}

/** An ASWF GitHub release and the configs it ships. */
export interface OcioRelease {
  tag: string;
  name: string;
  publishedAt: string | null;
  assets: OcioAsset[];
}

/**
 * The studio's installed configs. One cache for the admin tab and the project colour settings:
 * they used two keys, so a config installed in one stayed invisible in the other until it expired.
 */
export function useOcioConfigsQuery() {
  return useQuery({
    queryKey: qk.ocioConfigs,
    queryFn: () => api.get<{ configs: OcioConfig[] }>('/api/studio/ocio/configs').then((d) => d.configs),
  });
}

/** Official releases available for install (GitHub, through the API): fetched only on demand. */
export function useOcioReleasesQuery(enabled: boolean) {
  return useQuery({
    queryKey: qk.admin('ocio-releases'),
    queryFn: () => api.get<{ releases: OcioRelease[] }>('/api/studio/ocio/releases').then((d) => d.releases),
    enabled,
  });
}

export const ocioApi = {
  install: (tag: string, assetName: string) => api.post('/api/studio/ocio/install', { tag, assetName }),
  setDefault: (id: string) => api.put(`/api/studio/ocio/configs/${id}/default`, {}),
  remove: (id: string) => api.del(`/api/studio/ocio/configs/${id}`),
};
