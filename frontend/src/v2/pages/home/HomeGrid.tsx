// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Suspense, lazy } from 'react';
import LatestReviews from './LatestReviews';
import MyTasksCard from './MyTasksCard';
import ActivityFeed from './ActivityFeed';
import StatsRow from './StatsRow';
import RecentProjects from './RecentProjects';
import WidgetFrame, { type WidgetDragHandle } from './WidgetFrame';
import {
  isWidgetId,
  reorderWidgets,
  setWidgetSetting,
  visibleWidgets,
  widgetSettings,
  type HomeWidgetId,
  type HomeWidgetSettings,
  type HomeWidgetsPref,
} from './homeWidgets';
import { WIDGET_GRID_CLASS } from '../../lib/widgetLayout';
import type { DashboardData } from './homeTypes';

/**
 * Grille composable de l'Accueil (C2) : douze colonnes, chaque bloc portant sa largeur.
 *
 * Le déplacement se faisait d'un cran par menu contextuel, à l'intérieur d'une colonne
 * qu'un bloc ne pouvait jamais quitter. Ici, tout se déplace partout — à la souris comme
 * au clavier (dnd-kit gère les deux) — et seulement en mode édition : hors édition, la
 * page reste une page, sans poignée ni bordure.
 *
 * Le moteur de glisser-déposer suit cette règle jusqu'au bout depuis F5 : il n'est
 * téléchargé qu'à l'entrée en édition. Hors édition, la grille est exactement le même HTML
 * qu'avant — mêmes classes, mêmes blocs, mêmes menus — mais sans les 16,8 ko gzip de
 * @dnd-kit dans le premier chargement de tout le monde.
 */
const WidgetSortable = lazy(() => import('../../components/widgets/WidgetSortable'));

export default function HomeGrid({
  data,
  pref,
  editing,
  onPref,
  onHide,
  onEnterEdit,
}: {
  data: DashboardData;
  pref: HomeWidgetsPref | undefined;
  editing: boolean;
  onPref: (next: HomeWidgetsPref) => void;
  onHide: (id: HomeWidgetId) => void;
  onEnterEdit: () => void;
}) {
  const ids = visibleWidgets(pref);

  const content = (id: HomeWidgetId, variant: string) => {
    switch (id) {
      case 'stats':
        return <StatsRow stats={data.stats} />;
      case 'projects':
        return <RecentProjects projects={data.recentProjects} variant={variant as 'grid' | 'list'} />;
      case 'myTasks':
        return <MyTasksCard tasks={data.myTasks} />;
      case 'latestReviews':
        return <LatestReviews reviews={data.latestReviews} />;
      case 'activity':
        return <ActivityFeed items={data.activity} />;
    }
  };

  const widget = (id: HomeWidgetId, index: number, drag?: WidgetDragHandle) => {
    const settings = widgetSettings(id, pref);
    const apply = (patch: HomeWidgetSettings) => onPref(setWidgetSetting(id, patch, pref));
    // Déplacement d'une place : le voisin sert de cible, la même fonction que le glisser.
    const move = (direction: -1 | 1) => {
      const neighbour = ids[index + direction];
      if (neighbour) onPref(reorderWidgets(id, neighbour, pref));
    };
    return (
      <WidgetFrame
        key={id}
        id={id}
        settings={settings}
        editing={editing}
        onSettings={apply}
        onHide={() => onHide(id)}
        onEdit={onEnterEdit}
        onMove={move}
        canMoveBefore={index > 0}
        canMoveAfter={index < ids.length - 1}
        drag={drag}
      >
        <div data-density={settings.density} className={settings.density === 'compact' ? 'text-sm' : ''}>
          {content(id, settings.variant)}
        </div>
      </WidgetFrame>
    );
  };

  const grid = <div className={WIDGET_GRID_CLASS}>{ids.map((id, index) => widget(id, index))}</div>;

  if (!editing) return grid;

  // Repli identique à la grille finale : le temps que le module arrive, la page ne bouge
  // pas — seules les poignées ne répondent pas encore.
  return (
    <Suspense fallback={grid}>
      <WidgetSortable
        ids={ids}
        className={WIDGET_GRID_CLASS}
        onReorder={(from, to) => {
          // Le moteur de déplacement ne connaît pas le registre : c'est la page qui écarte
          // un identifiant qu'elle ne reconnaît plus.
          if (isWidgetId(from) && isWidgetId(to)) onPref(reorderWidgets(from, to, pref));
        }}
        renderWidget={(id, index, drag) => (isWidgetId(id) ? widget(id, index, drag) : null)}
      />
    </Suspense>
  );
}
