// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Suspense, lazy, useState } from 'react';
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
  setWidgetSize,
  visibleWidgets,
  widgetSettings,
  type HomeResolvedSettings,
  type HomeWidgetId,
  type HomeWidgetSettings,
  type HomeWidgetsPref,
} from './homeWidgets';
import { WIDGET_ROW_GRID_CLASS, listCapacity, type WidgetSize } from '../../components/widgets/widgetSizing';
import type { DashboardData } from './homeTypes';

/**
 * Grille composable de l'Accueil (C2) : douze colonnes, chaque bloc portant son emprise.
 *
 * Le déplacement se faisait d'un cran par menu contextuel, à l'intérieur d'une colonne
 * qu'un bloc ne pouvait jamais quitter. Ici, tout se déplace partout — à la souris comme
 * au clavier (dnd-kit gère les deux) — et seulement en mode édition : hors édition, la
 * page reste une page, sans poignée ni bordure.
 *
 * Lot 13 : la page prend le modèle de taille de la vue d'ensemble, demandé mot pour mot
 * (« les mêmes réglages de redimensionnement, de fenêtres »). Un bloc ne portait qu'une
 * largeur, sa hauteur était celle de son contenu, et la grille alignait tout par le haut :
 * un bloc court ouvrait sous lui un trou que son voisin ne pouvait pas combler. Chaque bloc
 * porte maintenant une **largeur en colonnes et une hauteur en rangées**, réglées d'un seul
 * geste à la poignée de coin, la grille **tasse** (`grid-flow-row-dense`), et le contenu
 * suit la taille — une carte plus haute montre réellement plus de lignes.
 *
 * Le moteur de glisser-déposer suit cette règle jusqu'au bout depuis F5 : il n'est
 * téléchargé qu'à l'entrée en édition. Hors édition, la grille ne charge pas les 16,8 ko
 * gzip de @dnd-kit dans le premier chargement de tout le monde.
 */
const WidgetSortable = lazy(() => import('../../components/widgets/WidgetSortable'));

/** Taille montrée pendant un glissement, avant tout enregistrement. */
interface Preview extends WidgetSize {
  id: HomeWidgetId;
}

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
  // La taille sous le curseur ne passe pas par les préférences : un cran franchi est un
  // aperçu, pas une décision. Seul le relâchement enregistre.
  const [preview, setPreview] = useState<Preview | null>(null);

  const content = (id: HomeWidgetId, settings: HomeResolvedSettings) => {
    switch (id) {
      case 'stats':
        return <StatsRow stats={data.stats} />;
      case 'projects':
        return (
          <RecentProjects
            projects={data.recentProjects}
            variant={settings.variant}
            rows={settings.rows}
            span={settings.span}
          />
        );
      case 'myTasks':
        return <MyTasksCard tasks={data.myTasks} limit={listCapacity(settings.rows)} />;
      case 'latestReviews':
        return <LatestReviews reviews={data.latestReviews} rows={settings.rows} />;
      case 'activity':
        return <ActivityFeed items={data.activity} limit={listCapacity(settings.rows)} />;
    }
  };

  const widget = (id: HomeWidgetId, index: number, drag?: WidgetDragHandle) => {
    const saved = widgetSettings(id, pref);
    // L'aperçu ne vaut que pour le bloc qu'on tire ; les autres gardent leur emprise.
    const settings: HomeResolvedSettings =
      preview?.id === id ? { ...saved, span: preview.span, rows: preview.rows } : saved;
    const apply = (patch: HomeWidgetSettings) => onPref(setWidgetSetting(id, patch, pref));
    const resize = (next: WidgetSize) => onPref(setWidgetSize(id, next, pref));
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
        onPreview={(next) => setPreview(next ? { id, ...next } : null)}
        onResize={resize}
        drag={drag}
      >
        <div data-density={settings.density} className={settings.density === 'compact' ? 'text-sm' : ''}>
          {content(id, settings)}
        </div>
      </WidgetFrame>
    );
  };

  const grid = <div className={WIDGET_ROW_GRID_CLASS}>{ids.map((id, index) => widget(id, index))}</div>;

  if (!editing) return grid;

  // Repli identique à la grille finale : le temps que le module arrive, la page ne bouge
  // pas — seules les poignées ne répondent pas encore.
  return (
    <Suspense fallback={grid}>
      <WidgetSortable
        ids={ids}
        className={WIDGET_ROW_GRID_CLASS}
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
