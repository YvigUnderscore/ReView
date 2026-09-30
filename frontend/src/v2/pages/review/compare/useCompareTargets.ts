// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import type { MediaKind, VersionDetail, VersionListItem } from '../../../types/api';

/** Un média comparable, nommé pour le sélecteur B. */
export interface CompareTargetMedia {
  id: number;
  name: string;
}

/** Une version voisine et ses médias du même type que le média ouvert. */
export interface CompareTarget {
  versionId: number;
  name: string;
  media: CompareTargetMedia[];
}

const fetchVersion = (id: number) =>
  api.get<{ version: VersionDetail }>(`/api/versions/${id}`).then((d) => d.version);

/**
 * Versions voisines (même tâche ou même asset) du média ouvert.
 *
 * Source unique de la décision « peut-on comparer » : le segment « Compare » de la bascule
 * s'y réfère au lieu de deviner, faute de quoi l'on offre un mode sans issue dès que la
 * tâche ne porte qu'une version. Mêmes clés de query que `VersionNavigator` : rien de plus
 * n'est demandé au serveur.
 */
export function useCompareTargets(versionId: number) {
  const versionQ = useQuery({ queryKey: qk.version(versionId), queryFn: () => fetchVersion(versionId) });
  const version = versionQ.data ?? null;
  const parent = version?.taskId
    ? `taskId=${version.taskId}`
    : version?.assetId
      ? `assetId=${version.assetId}`
      : null;
  const versionsQ = useQuery({
    queryKey: qk.versions(parent ?? ''),
    queryFn: () =>
      api.get<{ versions: VersionListItem[] }>(`/api/versions?${parent}`).then((d) => d.versions),
    enabled: parent !== null,
  });
  const versions = (versionsQ.data ?? []).filter((v) => v.id !== versionId);
  return { versions, hasTargets: versions.length > 0 };
}

/**
 * Médias comparables de chaque version voisine — le second temps du choix de B.
 *
 * B se choisissait par version : une version portant plusieurs images ne pouvait être
 * comparée que par la première. Les détails ne sont chargés qu'à l'entrée en comparaison
 * (`enabled`) — une requête par version voisine, inutile tant qu'on ne compare pas.
 */
export function useCompareMedia(
  versions: VersionListItem[],
  mediaId: number,
  kind: MediaKind,
  enabled: boolean,
) {
  const details = useQueries({
    queries: versions.map((v) => ({
      queryKey: qk.version(v.id),
      queryFn: () => fetchVersion(v.id),
      enabled,
    })),
  });
  const targets: CompareTarget[] = versions.map((v, i) => ({
    versionId: v.id,
    name: v.name,
    media: (details[i]?.data?.media ?? [])
      .filter((m) => m.kind === kind && m.id !== mediaId)
      .map((m) => ({ id: m.id, name: m.originalName })),
  }));
  return {
    targets,
    /** Premier média comparable connu — null tant que les détails ne sont pas arrivés. */
    firstMediaId: targets.find((v) => v.media.length > 0)?.media[0]?.id ?? null,
  };
}
