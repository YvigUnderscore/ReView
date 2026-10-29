// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQueries, useQuery } from '@tanstack/react-query';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import type { MediaKind, VersionDetail, VersionListItem } from '../../../types/api';

/** A comparable media, named for the B selector. */
export interface CompareTargetMedia {
  id: number;
  name: string;
}

/** A neighbouring version and its media of the same type as the open media. */
export interface CompareTarget {
  versionId: number;
  name: string;
  media: CompareTargetMedia[];
}

const fetchVersion = (id: number) =>
  api.get<{ version: VersionDetail }>(`/api/versions/${id}`).then((d) => d.version);

/**
 * Neighbouring versions (same task or same asset) of the open media.
 *
 * Single source of the "can we compare" decision: the "Compare" segment of the toggle refers
 * to it rather than guessing, otherwise a mode with no way out is offered as soon as the task
 * carries only one version. Same query keys as `VersionNavigator`: nothing more is requested
 * from the server.
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
 * Comparable media of each neighbouring version: the second step of choosing B.
 *
 * B used to be chosen per version: a version carrying several images could only be compared
 * through the first one. Details are only loaded on entering the comparison (`enabled`): one
 * request per neighbouring version, useless as long as we are not comparing.
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
    /** First known comparable media, null until the details have arrived. */
    firstMediaId: targets.find((v) => v.media.length > 0)?.media[0]?.id ?? null,
  };
}
