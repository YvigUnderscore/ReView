// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../../i18n';

/**
 * Registre des blocs de l'Accueil (refonte G) : la page est composée de widgets
 * masquables et réordonnables, persistés par compte dans les préférences
 * (`homeWidgets`). Ici : la source de vérité des blocs (id, libellé, colonne)
 * et le calcul de la disposition effective depuis la préférence.
 */

export type HomeWidgetId = 'stats' | 'latestReviews' | 'myTasks' | 'recentProjects' | 'activity';
export type HomeColumn = 'top' | 'main' | 'side';

/** Préférence `homeWidgets` — absente = disposition par défaut. */
export interface HomeWidgetsPref {
  hidden?: string[];
  order?: Partial<Record<HomeColumn, string[]>>;
}

/** Ordre de déclaration = ordre par défaut dans chaque colonne. */
export const HOME_WIDGETS: Record<HomeWidgetId, { labelKey: MessageKey; col: HomeColumn }> = {
  stats: { labelKey: 'home.widget.stats', col: 'top' },
  latestReviews: { labelKey: 'home.latestReviews', col: 'main' },
  myTasks: { labelKey: 'home.myTasks', col: 'main' },
  recentProjects: { labelKey: 'home.recentProjects', col: 'side' },
  activity: { labelKey: 'home.recentActivity', col: 'side' },
};

export const ALL_WIDGET_IDS = Object.keys(HOME_WIDGETS) as HomeWidgetId[];

const isWidgetId = (v: string): v is HomeWidgetId => v in HOME_WIDGETS;

/** Widgets masqués (préférence filtrée sur les ids encore connus). */
export function hiddenWidgets(pref: HomeWidgetsPref | undefined): HomeWidgetId[] {
  return (pref?.hidden ?? []).filter(isWidgetId);
}

/**
 * Ordre effectif d'une colonne : l'ordre sauvegardé d'abord (ids connus de la colonne),
 * puis les widgets de la colonne jamais ordonnés (nouveaux blocs livrés après la sauvegarde),
 * moins les masqués.
 */
export function columnWidgets(col: HomeColumn, pref: HomeWidgetsPref | undefined): HomeWidgetId[] {
  const hidden = new Set(hiddenWidgets(pref));
  const defaults = ALL_WIDGET_IDS.filter((id) => HOME_WIDGETS[id].col === col);
  const saved = (pref?.order?.[col] ?? []).filter((id): id is HomeWidgetId => isWidgetId(id) && HOME_WIDGETS[id].col === col);
  const ordered = [...saved, ...defaults.filter((id) => !saved.includes(id))];
  return ordered.filter((id) => !hidden.has(id));
}

/** Déplace un widget d'un cran dans sa colonne ; renvoie le patch de préférence. */
export function moveWidget(
  id: HomeWidgetId,
  dir: -1 | 1,
  pref: HomeWidgetsPref | undefined,
): HomeWidgetsPref {
  const col = HOME_WIDGETS[id].col;
  const order = columnWidgets(col, pref);
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return pref ?? {};
  const next = [...order];
  [next[i], next[j]] = [next[j], next[i]];
  return { ...pref, order: { ...pref?.order, [col]: next } };
}

/** Masque ou réaffiche un widget ; renvoie le patch de préférence. */
export function toggleWidget(
  id: HomeWidgetId,
  visible: boolean,
  pref: HomeWidgetsPref | undefined,
): HomeWidgetsPref {
  const hidden = new Set(hiddenWidgets(pref));
  if (visible) hidden.delete(id);
  else hidden.add(id);
  return { ...pref, hidden: [...hidden] };
}
