// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import type { MediaSummary, VersionDetail } from '../../types/api';

/**
 * Médias de la version courante.
 *
 * Deux lecteurs : le tiroir des assets, qui les montre, et le chrome, qui n'en veut que le
 * nombre — le tiroir et sa bascule disparaissent quand la version ne porte qu'un asset, faute
 * de quoi l'on ouvrait une bande vide. Même clé de query que `VersionNavigator` : rien de plus
 * n'est demandé au serveur.
 */
export function useVersionMedia(versionId: number): MediaSummary[] {
  const versionQ = useQuery({
    queryKey: qk.version(versionId),
    queryFn: () => api.get<{ version: VersionDetail }>(`/api/versions/${versionId}`).then((d) => d.version),
  });
  return versionQ.data?.media ?? [];
}
