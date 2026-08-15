// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { useSgConnection } from '../../lib/shotgridApi';

/**
 * Correspondances ShotGrid d'un projet, pour construire les liens directs.
 *
 * Une seule requête par projet plutôt qu'une par carte : une liste de plans en affiche
 * des centaines, et l'adresse d'une fiche distante se déduit d'un identifiant. Sans
 * connexion, rien n'est demandé au serveur et rien ne s'affiche.
 */
export type SgLinkType = 'sequence' | 'shot' | 'asset' | 'task' | 'version';

const SG_ENTITY: Record<SgLinkType, string> = {
  sequence: 'Sequence',
  shot: 'Shot',
  asset: 'Asset',
  task: 'Task',
  version: 'Version',
};

interface LinkMap {
  baseUrl: string;
  /** `localType` → `localId` → identifiant ShotGrid. */
  byType: Record<string, Record<number, number>>;
}

export function useSgLinks(projectId: number) {
  const { data: connection } = useSgConnection(projectId);
  const enabled = Boolean(connection?.active);

  const { data } = useQuery({
    queryKey: ['shotgrid', 'links', projectId],
    queryFn: () =>
      api
        .get<{ links: Array<{ localType: string; localId: number; sgId: number }> }>(
          `/api/shotgrid/projects/${projectId}/links`,
        )
        .then((r) => {
          const byType: LinkMap['byType'] = {};
          for (const l of r.links) {
            (byType[l.localType] ??= {})[l.localId] = l.sgId;
          }
          return { baseUrl: connection!.site.baseUrl, byType } satisfies LinkMap;
        }),
    enabled,
    staleTime: 60_000,
  });

  /** Adresse de la fiche ShotGrid, ou `null` si l'entité n'y est pas liée. */
  const linkFor = (type: SgLinkType, localId: number | null | undefined): string | null => {
    if (!data || !localId) return null;
    const sgId = data.byType[type]?.[localId];
    if (!sgId) return null;
    return `${data.baseUrl.replace(/\/$/, '')}/detail/${SG_ENTITY[type]}/${sgId}`;
  };

  return { connected: enabled, linkFor };
}
