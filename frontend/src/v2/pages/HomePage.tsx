// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, LayoutGrid, Play, Plus, RefreshCw, RotateCcw } from 'lucide-react';
import { api } from '../../lib/apiClient';
import { qk } from '../lib/query';
import { useAuth } from '../stores/useAuth';
import { useRecents } from '../stores/useRecents';
import PageShell from '../components/PageShell';
import AnnouncementBanner from '../components/AnnouncementBanner';
import { Skeleton } from '../components/ui/skeleton';
import EntityContextMenu from '../components/ui/entity-menu';
import { separator, type MenuEntry } from '../lib/menuSpec';
import { usePreferences, useUpdatePreferences } from '../lib/usePreferences';
import HomeGrid from './home/HomeGrid';
import {
  HOME_WIDGETS,
  hiddenWidgets,
  resetWidgets,
  toggleWidget,
  type HomeWidgetId,
  type HomeWidgetsPref,
} from './home/homeWidgets';
import type { DashboardData } from './home/homeTypes';
import { useT } from '../i18n';

/**
 * Page Accueil (racine « / ») — composable (C2).
 *
 * Hors édition, c'est une page : aucune poignée, aucune bordure, aucune barre en pointillés
 * — celle qui proposait les blocs masqués restait affichée en permanence. En édition, chaque
 * bloc gagne sa poignée et ses réglages (largeur, hauteur, densité, variante, cadre), et le
 * catalogue des blocs retirés apparaît.
 *
 * On y entre de trois façons, comme demandé : par le bouton de l'en-tête, par le clic droit
 * sur le fond de page, ou par le clic droit sur un bloc.
 */
export default function HomePage() {
  const t = useT();
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
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

  // Les préférences ne sont pas encore là : composer maintenant écraserait la disposition
  // enregistrée, le serveur fusionnant la clé `homeWidgets` en bloc.
  const ready = !prefsQ.isPending;
  const savePref = (next: HomeWidgetsPref) => {
    if (!ready) return;
    updatePrefs.mutate({ homeWidgets: next });
  };

  const entries: MenuEntry[] = [
    {
      id: 'edit',
      label: editing ? t('home.widget.editDone') : t('home.widget.editStart'),
      icon: editing ? <Check size={14} /> : <LayoutGrid size={14} />,
      disabled: !ready,
      onSelect: () => setEditing((v) => !v),
    },
    ...(hidden.length > 0
      ? [
          {
            kind: 'submenu' as const,
            id: 'add',
            label: t('home.widget.add'),
            icon: <Plus size={14} />,
            items: hidden.map((id) => ({
              id: `add-${id}`,
              label: t(HOME_WIDGETS[id].labelKey),
              onSelect: () => savePref(toggleWidget(id, true, pref)),
            })),
          },
        ]
      : []),
    {
      id: 'reset',
      label: t('home.widget.reset'),
      icon: <RotateCcw size={14} />,
      onSelect: () => savePref(resetWidgets()),
    },
    separator('refresh'),
    {
      id: 'refresh',
      label: t('gctx.refreshData'),
      icon: <RefreshCw size={14} />,
      onSelect: () => void qc.invalidateQueries({ queryKey: qk.dashboard }),
    },
  ];

  // Résumé actionnable de l'en-tête : mes chiffres, sinon la phrase d'ambiance.
  const headline = data
    ? data.stats.myRetakes + data.stats.pendingReview > 0
      ? t('home.headline', { retakes: data.stats.myRetakes, pending: data.stats.pendingReview })
      : t('home.whatMoved')
    : t('home.whatMoved');

  return (
    <PageShell title={t('nav.home')}>
      <EntityContextMenu entries={entries}>
        <div className="min-h-full">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-xl font-semibold">
                {firstName ? t('home.greeting', { name: firstName }) : t('nav.home')}
              </h1>
              <p className="text-sm text-muted-foreground">{headline}</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
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
              <button
                onClick={() => setEditing((v) => !v)}
                disabled={!ready}
                title={editing ? t('home.widget.editDone') : t('home.widget.editStart')}
                aria-label={editing ? t('home.widget.editDone') : t('home.widget.editStart')}
                className={`rounded-md p-2 transition-colors disabled:opacity-50 ${
                  editing
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
              >
                {editing ? <Check size={16} /> : <LayoutGrid size={16} />}
              </button>
            </div>
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
              <HomeGrid
                data={data}
                pref={pref}
                editing={editing}
                onPref={savePref}
                onHide={(id: HomeWidgetId) => savePref(toggleWidget(id, false, pref))}
                onEnterEdit={() => setEditing(true)}
              />
              {/* Catalogue des blocs retirés : visible en édition seulement. */}
              {editing && hidden.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border p-3">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Plus size={13} /> {t('home.widget.add')}
                  </span>
                  {hidden.map((id) => (
                    <button
                      key={id}
                      onClick={() => savePref(toggleWidget(id, true, pref))}
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
      </EntityContextMenu>
    </PageShell>
  );
}
