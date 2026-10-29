// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/apiClient';
import { useSgConnection } from '../../lib/shotgridApi';

/**
 * ShotGrid matches for a project, used to build direct links.
 *
 * One request per project rather than one per card: a plan list shows hundreds, and the
 * address of a remote record can be derived from an identifier. Without a connection,
 * nothing is requested from the server and nothing is shown.
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
  /** `localType` → `localId` → ShotGrid identifier. */
  byType: Record<string, Record<number, number>>;
  /** Last re-read, by type then by local identifier. */
  syncedAt: Record<string, Record<number, string | null>>;
}

/**
 * State of an entity with respect to ShotGrid.
 * - `off`: the project is not linked, there is nothing to say;
 * - `linked`: the entity has its match on the site;
 * - `unlinked`: it only exists in ReView.
 */
export type SgEntityState = 'off' | 'linked' | 'unlinked';

export function useSgLinks(projectId: number) {
  const { data: connection } = useSgConnection(projectId);
  const enabled = Boolean(connection?.active);

  const { data } = useQuery({
    queryKey: ['shotgrid', 'links', projectId],
    queryFn: () =>
      api
        .get<{
          links: Array<{
            localType: string;
            localId: number;
            sgId: number;
            syncedAt: string | null;
          }>;
        }>(`/api/shotgrid/projects/${projectId}/links`)
        .then((r) => {
          const byType: LinkMap['byType'] = {};
          const syncedAt: LinkMap['syncedAt'] = {};
          for (const l of r.links) {
            (byType[l.localType] ??= {})[l.localId] = l.sgId;
            (syncedAt[l.localType] ??= {})[l.localId] = l.syncedAt ?? null;
          }
          return { baseUrl: connection!.site.baseUrl, byType, syncedAt } satisfies LinkMap;
        }),
    enabled,
    staleTime: 60_000,
  });

  /** Address of the ShotGrid record, or `null` if the entity is not linked to it. */
  const linkFor = (type: SgLinkType, localId: number | null | undefined): string | null => {
    if (!data || !localId) return null;
    const sgId = data.byType[type]?.[localId];
    if (!sgId) return null;
    return `${data.baseUrl.replace(/\/$/, '')}/detail/${SG_ENTITY[type]}/${sgId}`;
  };

  /**
   * Does the entity have its counterpart on the site?
   *
   * Answered from the table already loaded: showing the state on two hundred plans costs
   * no more requests than showing their links.
   */
  const stateFor = (type: SgLinkType, localId: number | null | undefined): SgEntityState => {
    if (!enabled || !data || !localId) return 'off';
    return data.byType[type]?.[localId] ? 'linked' : 'unlinked';
  };

  /** Date of the last re-read, for the tooltip. */
  const syncedAtFor = (type: SgLinkType, localId: number | null | undefined): string | null =>
    (localId && data?.syncedAt[type]?.[localId]) || null;

  return { connected: enabled, linkFor, stateFor, syncedAtFor };
}
