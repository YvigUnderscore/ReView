// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  hiddenWidgets as genericHidden,
  registryIds,
  reorderWidgets as genericReorder,
  resetWidgets as genericReset,
  setWidgetSetting as genericSetSetting,
  toggleWidget as genericToggle,
  visibleWidgets as genericVisible,
  widgetSettings as genericSettings,
  type ResolvedWidgetSettings,
  type WidgetDefinition,
  type WidgetRegistry,
  type WidgetSettings,
  type WidgetsPref,
} from '../../lib/widgetLayout';

/**
 * Registre des blocs de l'Accueil (C2).
 *
 * La page se composait déjà, mais de très loin : trois colonnes figées dans le code, un
 * widget assigné à l'une d'elles une fois pour toutes, un déplacement d'un cran par menu
 * contextuel, et aucun réglage — ni taille, ni densité, ni variante. Un bloc « activité »
 * ne pouvait pas monter en colonne principale, et la page ne pouvait être ni resserrée ni
 * épurée.
 *
 * Désormais : une grille de douze colonnes, un ordre unique, et chaque bloc portant sa
 * taille, sa hauteur, sa densité, sa variante et l'affichage ou non de son cadre. Tout est
 * persisté par compte dans la préférence `homeWidgets`.
 *
 * Les règles de composition, elles, ne sont plus écrites ici : elles sont partagées avec la
 * vue d'ensemble d'un projet (`lib/widgetLayout`), qui demande les mêmes gestes. Ce fichier
 * ne garde que ce qui appartient en propre à l'accueil — ses blocs — et lie le registre aux
 * fonctions communes pour que les appelants n'aient pas à le répéter à chaque appel.
 */

export type HomeWidgetId = 'stats' | 'projects' | 'myTasks' | 'latestReviews' | 'activity';

export type {
  ResolvedWidgetSettings,
  WidgetDensity,
  WidgetHeight,
  WidgetSpan,
  WidgetVariant,
} from '../../lib/widgetLayout';

/** Réglages d'un bloc de l'accueil — la forme commune, renommée pour ses appelants. */
export type HomeWidgetSettings = WidgetSettings;

/** Préférence `homeWidgets` — absente = disposition par défaut. */
export type HomeWidgetsPref = WidgetsPref;

/** Ordre de déclaration = disposition par défaut d'un compte neuf. */
export const HOME_WIDGETS: WidgetRegistry<HomeWidgetId> = {
  stats: { labelKey: 'home.widget.stats', span: 12, spans: [6, 8, 12], variants: ['kpi'] },
  projects: { labelKey: 'home.recentProjects', span: 12, spans: [4, 6, 8, 12], variants: ['grid', 'list'] },
  myTasks: { labelKey: 'home.myTasks', span: 6, spans: [4, 6, 8, 12], variants: ['list'] },
  latestReviews: { labelKey: 'home.latestReviews', span: 6, spans: [4, 6, 8, 12], variants: ['list'] },
  activity: { labelKey: 'home.recentActivity', span: 6, spans: [3, 4, 6, 8], variants: ['list'] },
};

export type HomeWidgetDefinition = WidgetDefinition;

export const ALL_WIDGET_IDS = registryIds(HOME_WIDGETS);

export const isWidgetId = (v: string): v is HomeWidgetId => v in HOME_WIDGETS;

/** Widgets masqués (préférence filtrée sur les ids encore connus). */
export const hiddenWidgets = (pref: HomeWidgetsPref | undefined): HomeWidgetId[] =>
  genericHidden(HOME_WIDGETS, pref);

/** Ordre effectif de la page, moins les blocs masqués. */
export const visibleWidgets = (pref: HomeWidgetsPref | undefined): HomeWidgetId[] =>
  genericVisible(HOME_WIDGETS, pref);

/** Réglages effectifs d'un bloc : ceux du compte, complétés par les défauts du registre. */
export const widgetSettings = (id: HomeWidgetId, pref: HomeWidgetsPref | undefined): ResolvedWidgetSettings =>
  genericSettings(HOME_WIDGETS, id, pref);

/** Applique un réglage à un bloc ; renvoie le patch de préférence. */
export const setWidgetSetting = (
  id: HomeWidgetId,
  patch: HomeWidgetSettings,
  pref: HomeWidgetsPref | undefined,
): HomeWidgetsPref => genericSetSetting(id, patch, pref);

/** Réordonne la page après un déplacement ; renvoie le patch de préférence. */
export const reorderWidgets = (
  activeId: HomeWidgetId,
  overId: HomeWidgetId,
  pref: HomeWidgetsPref | undefined,
): HomeWidgetsPref => genericReorder(HOME_WIDGETS, activeId, overId, pref);

/** Masque ou réaffiche un bloc ; renvoie le patch de préférence. */
export const toggleWidget = (
  id: HomeWidgetId,
  visible: boolean,
  pref: HomeWidgetsPref | undefined,
): HomeWidgetsPref => genericToggle(HOME_WIDGETS, id, visible, pref);

/** Rend à la page sa disposition d'origine. */
export const resetWidgets = (): HomeWidgetsPref => genericReset(HOME_WIDGETS);

export { heightClass, spanClass } from '../../lib/widgetLayout';
