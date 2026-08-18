// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../../i18n';

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
 */

export type HomeWidgetId = 'stats' | 'projects' | 'myTasks' | 'latestReviews' | 'activity';

/** Largeur en colonnes sur une grille de douze. */
export type WidgetSpan = 3 | 4 | 6 | 8 | 12;
export type WidgetHeight = 'short' | 'normal' | 'tall';
export type WidgetDensity = 'comfortable' | 'compact';
/** Liste détaillée, grille de vignettes, ou chiffre seul. */
export type WidgetVariant = 'list' | 'grid' | 'kpi';

export interface HomeWidgetSettings {
  span?: WidgetSpan;
  height?: WidgetHeight;
  density?: WidgetDensity;
  variant?: WidgetVariant;
  /** Sans en-tête ni cadre : le bloc affleure la page. C'est ce qui la rend « épurée ». */
  bare?: boolean;
}

/** Préférence `homeWidgets` — absente = disposition par défaut. */
export interface HomeWidgetsPref {
  hidden?: string[];
  /**
   * Ordre unique de la page. Il remplace l'ancien ordre par colonne : la colonne était
   * portée par le registre, donc un bloc ne pouvait jamais en changer.
   */
  order?: string[];
  settings?: Partial<Record<HomeWidgetId, HomeWidgetSettings>>;
}

interface WidgetDefinition {
  labelKey: MessageKey;
  /** Largeur par défaut, et largeurs proposées au réglage. */
  span: WidgetSpan;
  spans: WidgetSpan[];
  /** Variantes que ce bloc sait rendre ; une seule = pas de choix proposé. */
  variants: [WidgetVariant, ...WidgetVariant[]];
}

/** Ordre de déclaration = disposition par défaut d'un compte neuf. */
export const HOME_WIDGETS: Record<HomeWidgetId, WidgetDefinition> = {
  stats: { labelKey: 'home.widget.stats', span: 12, spans: [6, 8, 12], variants: ['kpi'] },
  projects: { labelKey: 'home.recentProjects', span: 12, spans: [4, 6, 8, 12], variants: ['grid', 'list'] },
  myTasks: { labelKey: 'home.myTasks', span: 6, spans: [4, 6, 8, 12], variants: ['list'] },
  latestReviews: { labelKey: 'home.latestReviews', span: 6, spans: [4, 6, 8, 12], variants: ['list'] },
  activity: { labelKey: 'home.recentActivity', span: 6, spans: [3, 4, 6, 8], variants: ['list'] },
};

export const ALL_WIDGET_IDS = Object.keys(HOME_WIDGETS) as HomeWidgetId[];

export const isWidgetId = (v: string): v is HomeWidgetId => v in HOME_WIDGETS;

/** Widgets masqués (préférence filtrée sur les ids encore connus). */
export function hiddenWidgets(pref: HomeWidgetsPref | undefined): HomeWidgetId[] {
  return (pref?.hidden ?? []).filter(isWidgetId);
}

/**
 * Ordre effectif de la page : l'ordre sauvegardé d'abord, puis les blocs jamais ordonnés
 * (livrés après la dernière sauvegarde) à leur place de déclaration, moins les masqués.
 */
export function visibleWidgets(pref: HomeWidgetsPref | undefined): HomeWidgetId[] {
  const hidden = new Set(hiddenWidgets(pref));
  // L'ordre était naguère un objet par colonne : une préférence enregistrée avant C2 ne
  // doit pas faire tomber la page, juste repartir de la disposition par défaut.
  const saved = (Array.isArray(pref?.order) ? pref.order : []).filter(isWidgetId);
  const ordered = [...saved, ...ALL_WIDGET_IDS.filter((id) => !saved.includes(id))];
  return ordered.filter((id) => !hidden.has(id));
}

/** Réglages d'un bloc, tous renseignés — ce que le cadre reçoit pour se rendre. */
export interface ResolvedWidgetSettings {
  span: WidgetSpan;
  variant: WidgetVariant;
  height: WidgetHeight;
  density: WidgetDensity;
  bare: boolean;
}

/** Réglages effectifs d'un bloc : ceux du compte, complétés par les défauts du registre. */
export function widgetSettings(id: HomeWidgetId, pref: HomeWidgetsPref | undefined): ResolvedWidgetSettings {
  const definition = HOME_WIDGETS[id];
  const saved = pref?.settings?.[id] ?? {};
  const span = saved.span && definition.spans.includes(saved.span) ? saved.span : definition.span;
  const variant =
    saved.variant && definition.variants.includes(saved.variant) ? saved.variant : definition.variants[0];
  return {
    span,
    variant,
    height: saved.height ?? 'normal',
    density: saved.density ?? 'comfortable',
    bare: saved.bare ?? false,
  };
}

/** Applique un réglage à un bloc ; renvoie le patch de préférence. */
export function setWidgetSetting(
  id: HomeWidgetId,
  patch: HomeWidgetSettings,
  pref: HomeWidgetsPref | undefined,
): HomeWidgetsPref {
  return {
    ...pref,
    settings: { ...pref?.settings, [id]: { ...pref?.settings?.[id], ...patch } },
  };
}

/**
 * Réordonne la page après un glisser-déposer ; renvoie le patch de préférence.
 *
 * L'ordre complet est réécrit, blocs masqués compris : ne sauvegarder que les visibles
 * ferait réapparaître un bloc démasqué à une place arbitraire.
 */
export function reorderWidgets(
  activeId: HomeWidgetId,
  overId: HomeWidgetId,
  pref: HomeWidgetsPref | undefined,
): HomeWidgetsPref {
  const visible = visibleWidgets(pref);
  const from = visible.indexOf(activeId);
  const to = visible.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return pref ?? {};
  const next = [...visible];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  const hidden = hiddenWidgets(pref);
  return { ...pref, order: [...next, ...hidden.filter((id) => !next.includes(id))] };
}

/** Masque ou réaffiche un bloc ; renvoie le patch de préférence. */
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

/** Rend à la page sa disposition d'origine. */
export function resetWidgets(): HomeWidgetsPref {
  return { hidden: [], order: [...ALL_WIDGET_IDS], settings: {} };
}

/**
 * Classes de grille. Écrites en toutes lettres : une classe Tailwind construite par
 * interpolation (`col-span-${n}`) est purgée au build et ne produit aucun style.
 */
const SPAN_CLASS: Record<WidgetSpan, string> = {
  3: 'md:col-span-6 xl:col-span-3',
  4: 'md:col-span-6 xl:col-span-4',
  6: 'md:col-span-6 xl:col-span-6',
  8: 'md:col-span-12 xl:col-span-8',
  12: 'md:col-span-12 xl:col-span-12',
};

const HEIGHT_CLASS: Record<WidgetHeight, string> = {
  short: 'max-h-56 overflow-y-auto',
  normal: '',
  tall: 'min-h-96',
};

export const spanClass = (span: WidgetSpan): string => SPAN_CLASS[span];
export const heightClass = (height: WidgetHeight): string => HEIGHT_CLASS[height];
