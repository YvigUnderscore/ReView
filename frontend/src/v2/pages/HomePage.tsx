// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useAuth } from '../stores/useAuth';
import Shell from '../components/Shell';
import AnnouncementBanner from '../components/AnnouncementBanner';
import ResumeCard from '../components/ResumeCard';
import { Skeleton } from '../components/ui/skeleton';
import LatestReviews from './home/LatestReviews';
import MyTasksCard from './home/MyTasksCard';
import ActivityFeed from './home/ActivityFeed';
import StatsRow from './home/StatsRow';
import RecentProjects from './home/RecentProjects';
import type { DashboardData } from './home/homeTypes';
import { useT } from '../i18n';

/**
 * Page Accueil (racine « / », 12.B) : dernières reviews commentées, mes tâches,
 * projets récents, flux d'activité et stats — bornés à mes projets (GET /api/dashboard).
 */
export default function HomePage() {
  const t = useT();
  const user = useAuth((s) => s.user);
  const { data, error } = useQuery({
    queryKey: qk.dashboard,
    queryFn: () => api.get<DashboardData>('/api/dashboard'),
  });

  const firstName = user?.firstName ?? user?.username ?? user?.displayName ?? '';

  return (
    <Shell title={t('nav.home')}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">{firstName ? `Bonjour ${firstName}` : t('nav.home')}</h1>
          <p className="text-sm text-muted-foreground">{t('home.whatMoved')}</p>
        </div>
        {error && <p className="mb-4 text-sm text-destructive">{error.message}</p>}
        <AnnouncementBanner />
        <ResumeCard />
        {data === undefined ? (
          <div className="space-y-6">
            <Skeleton className="h-24 w-full" />
            <div className="grid grid-cols-3 gap-6">
              <Skeleton className="col-span-2 h-72" />
              <Skeleton className="h-72" />
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <StatsRow stats={data.stats} />
            <div className="grid grid-cols-3 items-start gap-6">
              <div className="col-span-2 space-y-6">
                <LatestReviews reviews={data.latestReviews} />
                <MyTasksCard tasks={data.myTasks} />
              </div>
              <div className="space-y-6">
                <RecentProjects />
                <ActivityFeed items={data.activity} />
              </div>
            </div>
          </div>
        )}
      </div>
    </Shell>
  );
}
