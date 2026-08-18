// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import LatestReviews from './LatestReviews';
import MyTasksCard from './MyTasksCard';
import ActivityFeed from './ActivityFeed';
import StatsRow from './StatsRow';
import RecentProjects from './RecentProjects';
import WidgetFrame from './WidgetFrame';
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
import type { DashboardData } from './homeTypes';

/**
 * Grille composable de l'Accueil (C2) : douze colonnes, chaque bloc portant sa largeur.
 *
 * Le déplacement se faisait d'un cran par menu contextuel, à l'intérieur d'une colonne
 * qu'un bloc ne pouvait jamais quitter. Ici, tout se déplace partout — à la souris comme
 * au clavier (dnd-kit gère les deux) — et seulement en mode édition : hors édition, la
 * page reste une page, sans poignée ni bordure.
 */
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
  const sensors = useSensors(
    // Un seuil de quelques pixels : sans lui, un simple clic sur un bloc démarrerait un
    // glissement et avalerait le clic.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = String(active.id);
    const to = String(over.id);
    if (!isWidgetId(from) || !isWidgetId(to)) return;
    onPref(reorderWidgets(from, to, pref));
  };

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

  const grid = (
    <div className="grid grid-cols-12 items-start gap-6">
      {ids.map((id, index) => {
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
          >
            <div data-density={settings.density} className={settings.density === 'compact' ? 'text-sm' : ''}>
              {content(id, settings.variant)}
            </div>
          </WidgetFrame>
        );
      })}
    </div>
  );

  if (!editing) return grid;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        {grid}
      </SortableContext>
    </DndContext>
  );
}
