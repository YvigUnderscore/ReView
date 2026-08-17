// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileVideo, Play } from 'lucide-react';
import { api } from '../../../lib/apiClient';
import { qk } from '../../lib/query';
import { reviewPath } from '../../lib/slug';
import ProjectActivity from '../../components/ProjectActivity';
import TimelineCard from '../timeline/TimelineCard';
import { Skeleton } from '../../components/ui/skeleton';
import type { MediaRef } from '../../types/api';
import { useT } from '../../i18n';

type RecentMedia = MediaRef & { thumbnailUrl: string | null };

// Hissé hors du render (règle react-hooks/static-components)
function StatCard({ label, value, onClick }: { label: string; value: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-lg border border-border bg-card p-5 text-left transition-colors hover:border-primary"
    >
      <div className="text-3xl font-semibold">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </button>
  );
}

/**
 * Vue d'ensemble du projet (10.C1) : compteurs, derniers médias publiés
 * (vignettes cliquables → review), progression + activité (ProjectActivity).
 */
export default function OverviewTab({
  name,
  projectId,
  canManage,
  counts,
  onGo,
}: {
  name: string;
  projectId: number;
  canManage: boolean;
  counts: { sequences: number; shots: number; assets: number };
  onGo: (k: string) => void;
}) {
  const t = useT();
  const { data, isError } = useQuery({
    queryKey: qk.projectMedia(projectId),
    queryFn: () =>
      api.get<{ items: RecentMedia[] }>(`/api/media?projectId=${projectId}`).then((d) => d.items),
  });
  const media = isError ? [] : (data?.slice(0, 8) ?? null);

  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">{t('overview.projectDashboard', { name })}</p>
      {/* Montage du film entier (45) : toutes les séquences bout à bout, tenu à jour seul. */}
      <TimelineCard projectId={projectId} sequenceId={null} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label={t('sequences.title')} value={counts.sequences} onClick={() => onGo('sequences')} />
        <StatCard label={t('shots.title')} value={counts.shots} onClick={() => onGo('shots')} />
        <StatCard label="Assets" value={counts.assets} onClick={() => onGo('assets')} />
      </div>

      {/* Derniers médias publiés : vignettes cliquables vers la review */}
      <section className="mt-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t('playlist.latestPublished')}
        </h3>
        {media === null ? (
          <div className="grid grid-cols-4 gap-3 lg:grid-cols-8">
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="aspect-video w-full" />
            ))}
          </div>
        ) : media.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('overview.noPublished')}</p>
        ) : (
          <div className="grid grid-cols-4 gap-3 lg:grid-cols-8">
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
        )}
      </section>

      {/* Progression des tâches + dernières mises à jour + tâches prioritaires */}
      <ProjectActivity projectId={projectId} canManage={canManage} />
    </div>
  );
}
