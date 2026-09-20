// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Suspense, lazy } from 'react';
import WidgetShell, { type WidgetDragHandle } from '../../../components/widgets/WidgetShell';
import RetakePanel from '../../../components/production/RetakePanel';
import { WIDGET_GRID_CLASS, type WidgetSettings, type WidgetsPref } from '../../../lib/widgetLayout';
import CountsWidget, { type ProjectCounts } from './CountsWidget';
import LatestMediaWidget from './LatestMediaWidget';
import ProgressWidget from './ProgressWidget';
import ActivityWidget from './ActivityWidget';
import TasksWidget from './TasksWidget';
import MyTasksWidget from './MyTasksWidget';
import AttentionWidget from './AttentionWidget';
import {
  OVERVIEW_WIDGET_DEFS,
  isOverviewWidget,
  overviewWidgetSettings,
  reorderOverviewWidgets,
  setOverviewWidgetSetting,
  visibleOverviewWidgets,
  type OverviewWidgetId,
} from './overviewWidgets';
import { useT } from '../../../i18n';

/**
 * Grille de la vue d'ensemble : douze colonnes, chaque bloc portant sa largeur.
 *
 * Même moteur que l'accueil (`components/widgets`) et même règle sur le glisser-déposer —
 * @dnd-kit n'est téléchargé qu'à l'entrée en édition. Hors édition, c'est une page : ni
 * poignée, ni bordure, ni bouton sur les blocs.
 */
const WidgetSortable = lazy(() => import('../../../components/widgets/WidgetSortable'));

export interface OverviewGridProps {
  projectId: number;
  counts: ProjectCounts;
  canManage: boolean;
  layout: WidgetsPref;
  editing: boolean;
  onLayout: (next: WidgetsPref) => void;
  onHide: (id: OverviewWidgetId) => void;
  onEnterEdit: () => void;
  onGo: (tab: string) => void;
}

export default function OverviewGrid({
  projectId,
  counts,
  canManage,
  layout,
  editing,
  onLayout,
  onHide,
  onEnterEdit,
  onGo,
}: OverviewGridProps) {
  const t = useT();
  const ids = visibleOverviewWidgets(layout, canManage);

  const content = (id: OverviewWidgetId) => {
    switch (id) {
      case 'counts':
        return <CountsWidget counts={counts} onGo={onGo} />;
      case 'myTasks':
        return <MyTasksWidget projectId={projectId} />;
      case 'latestMedia':
        return <LatestMediaWidget projectId={projectId} />;
      case 'progress':
        return <ProgressWidget projectId={projectId} />;
      case 'activity':
        return <ActivityWidget projectId={projectId} />;
      case 'tasks':
        return <TasksWidget projectId={projectId} canManage={canManage} />;
      case 'attention':
        return <AttentionWidget projectId={projectId} />;
      case 'retakes':
        return <RetakePanel projectId={projectId} />;
    }
  };

  const widget = (id: OverviewWidgetId, index: number, drag?: WidgetDragHandle) => {
    const definition = OVERVIEW_WIDGET_DEFS[id];
    const settings = overviewWidgetSettings(id, layout);
    const apply = (patch: WidgetSettings) => onLayout(setOverviewWidgetSetting(id, patch, layout));
    // Déplacement d'une place : le voisin sert de cible, la même fonction que le glisser.
    const move = (direction: -1 | 1) => {
      const neighbour = ids[index + direction];
      if (neighbour) onLayout(reorderOverviewWidgets(id, neighbour, layout));
    };
    return (
      <WidgetShell
        key={id}
        id={id}
        title={t(definition.labelKey)}
        spans={definition.spans}
        variants={definition.variants}
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
          {content(id)}
        </div>
      </WidgetShell>
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
          if (isOverviewWidget(from) && isOverviewWidget(to))
            onLayout(reorderOverviewWidgets(from, to, layout));
        }}
        renderWidget={(id, index, drag) => (isOverviewWidget(id) ? widget(id, index, drag) : null)}
      />
    </Suspense>
  );
}
