// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Navigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/apiClient';
import { qk } from '../../lib/query';
import { parseIdParam, reviewPath } from '../../lib/slug';
import type { AssetLatest } from '../../types/api';
import { useT } from '../../i18n';

/**
 * `/assets/:id/latest` and `/shots/:id/latest` — stable address of an entity's most advanced
 * state (Phase 45, extended to shots in C3).
 *
 * A link pasted into a production note, a ticket or a message must stay accurate
 * as the work advances. This one resolves on each opening: it leads to the review of the
 * media of the most downstream step, or to the entity page if there is nothing to show.
 */
export default function AssetLatestRedirect({ entity = 'asset' }: { entity?: 'asset' | 'shot' }) {
  const t = useT();
  const { id } = useParams();
  const entityId = parseIdParam(id);
  const segment = entity === 'shot' ? 'shots' : 'assets';
  const { data, isLoading, isError } = useQuery({
    queryKey: qk.entityLatest(entity, entityId),
    queryFn: () =>
      api.get<{ latest: AssetLatest }>(`/api/${segment}/${entityId}/latest`).then((d) => d.latest),
    enabled: Number.isFinite(entityId),
    retry: false,
  });

  if (isLoading) return <div className="p-6 text-sm text-muted-foreground">{t('common.loading')}</div>;
  // Without a published version (or without media), the entity page remains the best destination:
  // it shows the full tree, drafts included, rather than an error.
  if (isError || !data?.media) return <Navigate to={`/${segment}/${entityId}`} replace />;
  return <Navigate to={reviewPath(data.media)} replace />;
}
