// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { qk } from '@/v2/lib/query';
import AttentionPanel from '@/v2/components/production/AttentionPanel';
import { SkeletonRows } from '@/v2/components/ui/skeleton';
import type { ProductionOverview } from '@/v2/types/production';

/**
 * What is blocking: overdue, unassigned, awaiting review.
 *
 * The panel has existed since phase 43 and lived only in the Production tab, that is, two clicks
 * away from the page a supervisor opens first. It reads the same route, with the default pace
 * window: the overview does not set a window, it announces.
 *
 * `requireProjectManage` on the server side: the block exists only for those who manage the
 * project, and the registry knows it (`manage: true`), so it is never offered to the others.
 */
const DEFAULT_WEEKS = 8;

export default function AttentionWidget({ projectId }: { projectId: number }) {
  const { data, error } = useQuery({
    queryKey: qk.projectProduction(projectId, DEFAULT_WEEKS),
    queryFn: () =>
      api.get<ProductionOverview>(`/api/projects/${projectId}/production?weeks=${DEFAULT_WEEKS}`),
  });

  if (error) return <p className="text-xs text-destructive">{error.message}</p>;
  if (!data) return <SkeletonRows count={3} />;
  return <AttentionPanel data={data} />;
}
