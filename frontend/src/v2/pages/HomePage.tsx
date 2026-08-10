// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Play, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useAuth } from '../stores/useAuth';
import { useRecents } from '../stores/useRecents';
import Shell from '../components/Shell';
import AnnouncementBanner from '../components/AnnouncementBanner';
import { Skeleton } from '../components/ui/skeleton';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '../components/ui/context-menu';
import { usePreferences, useUpdatePreferences } from '../lib/usePreferences';
import LatestReviews from './home/LatestReviews';
import MyTasksCard from './home/MyTasksCard';
import ActivityFeed from './home/ActivityFeed';
import StatsRow from './home/StatsRow';
import RecentProjects from './home/RecentProjects';
import HomeWidget from './home/HomeWidget';
import {
  HOME_WIDGETS,
  columnWidgets,
  hiddenWidgets,
  moveWidget,
  toggleWidget,
  type HomeColumn,
  type HomeWidgetId,
  type HomeWidgetsPref,
} from './home/homeWidgets';
import type { DashboardData } from './home/homeTypes';
import { useT } from '../i18n';

/**
 * Page Accueil (racine « / », refonte G) : mêmes blocs qu'avant mais affûtés — compteurs
 * personnels cliquables, tâches actionnables, progression des projets, activité datée —
 * et composables : chaque bloc est un widget masquable/réordonnable (clic droit),
 * persisté par compte (`homeWidgets` dans les préférences).
 */
export default function HomePage() {
  const t = useT();
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const { data, error } = useQuery({
    queryKey: qk.dashboard,
    queryFn: () => api.get<DashboardData>('/api/dashboard'),
  });
  const prefsQ = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const pref: HomeWidgetsPref | undefined = prefsQ.data?.homeWidgets ?? undefined;

  const firstName = user?.firstName ?? user?.username ?? user?.displayName ?? '';
  // « Reprendre » compact dans l'en-tête (remplace la ResumeCard pleine largeur).
  const lastMedia = useRecents((s) => s.recents.find((r) => r.type === 'media'));

  const hidden = hiddenWidgets(pref);
  const cols: Record<HomeColumn, HomeWidgetId[]> = {
    top: columnWidgets('top', pref),
    main: columnWidgets('main', pref),
    side: columnWidgets('side', pref),
  };

  const onHide = (id: HomeWidgetId) => updatePrefs.mutate({ homeWidgets: toggleWidget(id, false, pref) });
  const onShow = (id: HomeWidgetId) => updatePrefs.mutate({ homeWidgets: toggleWidget(id, true, pref) });
  const onMove = (id: HomeWidgetId, dir: -1 | 1) =>
    updatePrefs.mutate({ homeWidgets: moveWidget(id, dir, pref) });
  // `null` = suppression de la clé côté serveur (merge superficiel) → retour au défaut.
  const onReset = () => updatePrefs.mutate({ homeWidgets: null });

  const renderWidget = (id: HomeWidgetId, d: DashboardData) => {
    switch (id) {
      case 'stats':
        return <StatsRow stats={d.stats} />;
      case 'latestReviews':
        return <LatestReviews reviews={d.latestReviews} />;
      case 'myTasks':
        return <MyTasksCard tasks={d.myTasks} />;
      case 'recentProjects':
        return <RecentProjects projects={d.recentProjects} />;
      case 'activity':
        return <ActivityFeed items={d.activity} />;
    }
  };

  const column = (ids: HomeWidgetId[], d: DashboardData) => (
    <>
      {ids.map((id, i) => (
        <HomeWidget
          key={id}
          id={id}
          canUp={i > 0}
          canDown={i < ids.length - 1}
          onHide={onHide}
          onMove={onMove}
        >
          {renderWidget(id, d)}
        </HomeWidget>
      ))}
    </>
  );

  // Résumé actionnable de l'en-tête : mes chiffres, sinon la phrase d'ambiance.
  const headline = data
    ? data.stats.myRetakes + data.stats.pendingReview > 0
      ? t('home.headline', { retakes: data.stats.myRetakes, pending: data.stats.pendingReview })
      : t('home.whatMoved')
    : t('home.whatMoved');

  return (
    <Shell title={t('nav.home')}>
      {/* Fond de page : le clic droit compose la page (ajouter un bloc, réinitialiser). */}
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="mx-auto min-h-full max-w-7xl">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold">
                  {firstName ? t('home.greeting', { name: firstName }) : t('nav.home')}
                </h1>
                <p className="text-sm text-muted-foreground">{headline}</p>
              </div>
              {lastMedia && (
                <Link
                  to={lastMedia.to}
                  className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm text-primary transition-colors hover:bg-primary/10"
                >
                  <Play size={15} />
                  <span className="max-w-64 truncate">
                    {t('home.resumeShort')} · {lastMedia.label}
                  </span>
                </Link>
              )}
            </div>
            {error && <p className="mb-4 text-sm text-destructive">{error.message}</p>}
            <AnnouncementBanner />
            {data === undefined ? (
              <div className="space-y-6">
                <Skeleton className="h-24 w-full" />
                <div className="grid gap-6 lg:grid-cols-3">
                  <Skeleton className="h-72 lg:col-span-2" />
                  <Skeleton className="h-72" />
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {column(cols.top, data)}
                <div className="grid items-start gap-6 lg:grid-cols-3">
                  <div className="space-y-6 lg:col-span-2">{column(cols.main, data)}</div>
                  <div className="space-y-6">{column(cols.side, data)}</div>
                </div>
                {hidden.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-3">
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Plus size={13} /> {t('home.widget.add')}
                    </span>
                    {hidden.map((id) => (
                      <button
                        key={id}
                        onClick={() => onShow(id)}
                        className="rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
                      >
                        {t(HOME_WIDGETS[id].labelKey)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {hidden.length > 0 && (
            <ContextMenuSub>
              <ContextMenuSubTrigger>
                <Plus size={14} /> {t('home.widget.add')}
              </ContextMenuSubTrigger>
              <ContextMenuSubContent>
                {hidden.map((id) => (
                  <ContextMenuItem key={id} onSelect={() => onShow(id)}>
                    {t(HOME_WIDGETS[id].labelKey)}
                  </ContextMenuItem>
                ))}
              </ContextMenuSubContent>
            </ContextMenuSub>
          )}
          <ContextMenuItem onSelect={onReset}>
            <RotateCcw size={14} /> {t('home.widget.reset')}
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => void qc.invalidateQueries({ queryKey: qk.dashboard })}>
            <RefreshCw size={14} /> {t('gctx.refreshData')}
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </Shell>
  );
}
