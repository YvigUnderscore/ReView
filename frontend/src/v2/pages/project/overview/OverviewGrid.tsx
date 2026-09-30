// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Suspense, lazy, useState } from 'react';
import WidgetShell, { type WidgetDragHandle } from '../../../components/widgets/WidgetShell';
import RetakePanel from '../../../components/production/RetakePanel';
import type { WidgetSettings, WidgetsPref } from '../../../lib/widgetLayout';
import CountsWidget, { type ProjectCounts } from './CountsWidget';
import LatestMediaWidget from './LatestMediaWidget';
import ProgressWidget from './ProgressWidget';
import ActivityWidget from './ActivityWidget';
import TasksWidget from './TasksWidget';
import MyTasksWidget from './MyTasksWidget';
import AttentionWidget from './AttentionWidget';
import WidgetResizeHandle, { WidgetRowsChoice } from './WidgetResizeHandle';
import {
  OVERVIEW_GRID_CLASS,
  listCapacity,
  rowSpanClass,
  type OverviewRows,
  type WidgetSize,
} from './overviewSizing';
import {
  OVERVIEW_WIDGET_DEFS,
  isOverviewWidget,
  overviewWidgetSettings,
  reorderOverviewWidgets,
  setOverviewWidgetSetting,
  setOverviewWidgetSize,
  visibleOverviewWidgets,
  type OverviewWidgetId,
} from './overviewWidgets';
import { useT } from '../../../i18n';

/**
 * Grille de la vue d'ensemble : douze colonnes, des rangées, et des blocs qui se tirent.
 *
 * Elle alignait ses blocs par le haut et les laissait prendre la hauteur de leur contenu.
 * Un bloc court ouvrait donc sous lui un trou que rien ne pouvait combler — les zones vides
 * entourées en rouge sur la capture. Chaque bloc porte désormais une **emprise** : une
 * largeur en colonnes et une hauteur en rangées, réglées d'un seul geste à la poignée de
 * coin, et la grille **tasse** (`grid-flow-row-dense`) : les rangées qu'un bloc court
 * libère sont prises par le premier bloc suivant qui y tient.
 *
 * Le glisser-déposer suit la même règle qu'à l'accueil — @dnd-kit n'est téléchargé qu'à
 * l'entrée en composition. Hors composition, c'est une page : ni poignée, ni bordure, ni
 * bouton sur les blocs.
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

/** Taille montrée pendant un glissement, avant tout enregistrement. */
interface Preview extends WidgetSize {
  id: OverviewWidgetId;
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
  // La taille sous le curseur ne passe pas par les préférences : un cran franchi est un
  // aperçu, pas une décision. Seul le relâchement enregistre.
  const [preview, setPreview] = useState<Preview | null>(null);

  const content = (id: OverviewWidgetId, size: WidgetSize) => {
    switch (id) {
      case 'counts':
        return <CountsWidget counts={counts} onGo={onGo} />;
      case 'myTasks':
        return <MyTasksWidget projectId={projectId} limit={listCapacity(size.rows)} />;
      case 'latestMedia':
        return <LatestMediaWidget projectId={projectId} rows={size.rows} span={size.span} />;
      case 'progress':
        return <ProgressWidget projectId={projectId} />;
      case 'activity':
        return <ActivityWidget projectId={projectId} limit={listCapacity(size.rows)} />;
      case 'tasks':
        return <TasksWidget projectId={projectId} canManage={canManage} limit={listCapacity(size.rows)} />;
      case 'attention':
        return <AttentionWidget projectId={projectId} />;
      case 'retakes':
        return <RetakePanel projectId={projectId} />;
    }
  };

  const widget = (id: OverviewWidgetId, index: number, drag?: WidgetDragHandle) => {
    const definition = OVERVIEW_WIDGET_DEFS[id];
    const saved = overviewWidgetSettings(id, layout);
    // L'aperçu ne vaut que pour le bloc qu'on tire ; les autres gardent leur emprise.
    const size: WidgetSize =
      preview?.id === id
        ? { span: preview.span, rows: preview.rows }
        : { span: saved.span, rows: saved.rows };
    const settings = { ...saved, span: size.span, rows: size.rows };
    const title = t(definition.labelKey);

    const apply = (patch: WidgetSettings) => onLayout(setOverviewWidgetSetting(id, patch, layout));
    const resize = (next: WidgetSize) => onLayout(setOverviewWidgetSize(id, next, layout));
    const setRows = (rows: OverviewRows) => resize({ span: size.span, rows });
    // Déplacement d'une place : le voisin sert de cible, la même fonction que le glisser.
    const move = (direction: -1 | 1) => {
      const neighbour = ids[index + direction];
      if (neighbour) onLayout(reorderOverviewWidgets(id, neighbour, layout));
    };

    return (
      <WidgetShell
        key={id}
        id={id}
        title={title}
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
        rowSizing={{
          className: rowSpanClass(size.rows),
          control: <WidgetRowsChoice rows={size.rows} onRows={setRows} />,
          // La poignée est une commande de composition : elle vit avec la poignée de
          // déplacement, et disparaît avec elle.
          handle: editing ? (
            <WidgetResizeHandle
              name={title}
              size={size}
              spans={definition.spans}
              onPreview={(next) => setPreview(next ? { id, ...next } : null)}
              onCommit={resize}
            />
          ) : null,
        }}
      >
        <div data-density={settings.density} className={settings.density === 'compact' ? 'text-sm' : ''}>
          {content(id, size)}
        </div>
      </WidgetShell>
    );
  };

  const grid = <div className={OVERVIEW_GRID_CLASS}>{ids.map((id, index) => widget(id, index))}</div>;

  if (!editing) return grid;

  // Repli identique à la grille finale : le temps que le module arrive, la page ne bouge
  // pas — seules les poignées ne répondent pas encore.
  return (
    <Suspense fallback={grid}>
      <WidgetSortable
        ids={ids}
        className={OVERVIEW_GRID_CLASS}
        onReorder={(from, to) => {
          if (isOverviewWidget(from) && isOverviewWidget(to))
            onLayout(reorderOverviewWidgets(from, to, layout));
        }}
        renderWidget={(id, index, drag) => (isOverviewWidget(id) ? widget(id, index, drag) : null)}
      />
    </Suspense>
  );
}
