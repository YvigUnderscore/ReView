// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { MediaSummary, VersionDetail } from '../../types/api';

/**
 * Media of the current version.
 *
 * Two readers: the assets drawer, which shows them, and the chrome, which only wants their count — the
 * drawer and its toggle disappear when the version carries only one asset, otherwise an empty band
 * would open. Same query key as `VersionNavigator`: nothing more is requested from the server.
 */
export function useVersionMedia(versionId: number): MediaSummary[] {
  const versionQ = useQuery({
    queryKey: qk.version(versionId),
    queryFn: () => api.get<{ version: VersionDetail }>(`/api/versions/${versionId}`).then((d) => d.version),
  });
  return versionQ.data?.media ?? [];
}
