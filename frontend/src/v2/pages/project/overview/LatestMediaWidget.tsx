// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileVideo, Play } from 'lucide-react';
import { api } from '../../../../lib/apiClient';
import { qk } from '../../../lib/query';
import { reviewPath } from '../../../lib/slug';
import { Skeleton } from '../../../components/ui/skeleton';
import type { MediaRef } from '../../../types/api';
import { tileCapacity, tileGridClass, type OverviewRows } from './overviewSizing';
import type { WidgetSpan } from '../../../lib/widgetLayout';
import { useT } from '../../../i18n';

/**
 * Les derniers médias publiés du projet, en vignettes cliquables vers la review.
 *
 * C'est le bloc que l'utilisatrice a entouré en premier : huit vignettes sur une ligne, et
 * du vide sous elles quelle que soit la place. La grille de vignettes suit maintenant
 * l'emprise du bloc — la largeur décide du nombre de colonnes, la hauteur du nombre de
 * lignes — et un bloc plus grand montre réellement plus de médias.
 */

type RecentMedia = MediaRef & { thumbnailUrl: string | null };

export default function LatestMediaWidget({
  projectId,
  rows,
  span,
}: {
  projectId: number;
  rows: OverviewRows;
  span: WidgetSpan;
}) {
  const t = useT();
  const tiles = tileCapacity(rows, span);
  const columns = tileGridClass(span);
  const { data, isError } = useQuery({
    queryKey: qk.projectMedia(projectId),
    queryFn: () =>
      api.get<{ items: RecentMedia[] }>(`/api/media?projectId=${projectId}`).then((d) => d.items),
  });
  const media = isError ? [] : (data?.slice(0, tiles) ?? null);

  if (media === null)
    return (
      <div className={`grid gap-3 ${columns}`}>
        {Array.from({ length: tiles }, (_, i) => (
          <Skeleton key={i} className="aspect-video w-full" />
        ))}
      </div>
    );

  if (media.length === 0) return <p className="text-xs text-muted-foreground">{t('overview.noPublished')}</p>;

  return (
    <div className={`grid gap-3 ${columns}`}>
      {media.map((m) => (
        <Link
          key={m.id}
          to={reviewPath(m)}
          title={t('review.openNamed', { name: m.originalName })}
          className="group overflow-hidden rounded-md border border-border bg-card transition-colors hover:border-primary"
        >
          <div className="relative aspect-video bg-black/40">
            {m.thumbnailUrl ? (
              <img src={m.thumbnailUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <FileVideo size={20} />
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              <Play size={18} className="text-primary" />
            </div>
          </div>
          <div className="truncate px-1.5 py-1 text-2xs text-muted-foreground">{m.originalName}</div>
        </Link>
      ))}
    </div>
  );
}
