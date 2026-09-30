// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../i18n';

/**
 * Algèbre d'une page composable — masquer, réordonner, régler un bloc.
 *
 * Elle est née à l'Accueil (C2), écrite pour lui : les fonctions lisaient `HOME_WIDGETS`,
 * et leurs types nommaient ses cinq blocs. La vue d'ensemble d'un projet demande
 * exactement les mêmes gestes ; les recopier aurait donné deux jeux de règles à corriger
 * deux fois. Le registre devient donc un **paramètre**, et chaque page garde le sien.
 *
 * Rien ici ne rend quoi que ce soit : ce sont des fonctions pures sur une préférence, ce
 * qui les rend vérifiables sans écran.
 */

/** Largeur en colonnes sur une grille de douze. */
export type WidgetSpan = 3 | 4 | 6 | 8 | 12;
export type WidgetHeight = 'short' | 'normal' | 'tall';
export type WidgetDensity = 'comfortable' | 'compact';
/** Liste détaillée, grille de vignettes, ou chiffre seul. */
export type WidgetVariant = 'list' | 'grid' | 'kpi';

export interface WidgetSettings {
  span?: WidgetSpan;
  height?: WidgetHeight;
  /**
   * Hauteur en **rangées de grille** — la vue d'ensemble d'un projet et l'accueil. La rampe
   * des hauteurs offertes et leur traduction en classes vivent dans le modèle de taille
   * (`components/widgets/widgetSizing`), pas ici : seule la forme enregistrée est commune.
   *
   * Absente, la page retombe sur `height` puis sur son propre défaut — c'est ce qui rend
   * relisible une disposition enregistrée avant que les hauteurs existent.
   */
  rows?: number;
  density?: WidgetDensity;
  variant?: WidgetVariant;
  /** Sans en-tête ni cadre : le bloc affleure la page. C'est ce qui la rend « épurée ». */
  bare?: boolean;
}

/** Disposition enregistrée — absente, la page rend sa disposition de déclaration. */
export interface WidgetsPref {
  hidden?: string[];
  /** Ordre unique de la page, blocs masqués compris (cf. `reorderWidgets`). */
  order?: string[];
  settings?: Record<string, WidgetSettings>;
}

export interface WidgetDefinition {
  labelKey: MessageKey;
  /** Largeur par défaut, et largeurs proposées au réglage. */
  span: WidgetSpan;
  spans: WidgetSpan[];
  /** Variantes que ce bloc sait rendre ; une seule = pas de choix proposé. */
  variants: [WidgetVariant, ...WidgetVariant[]];
}

/** Un registre de page : identifiant de bloc → sa définition. */
export type WidgetRegistry<Id extends string> = Record<Id, WidgetDefinition>;

/** Ordre de déclaration du registre = disposition par défaut d'un compte neuf. */
export const registryIds = <Id extends string>(registry: WidgetRegistry<Id>): Id[] =>
  Object.keys(registry) as Id[];

export const isKnownWidget = <Id extends string>(registry: WidgetRegistry<Id>, value: string): value is Id =>
  value in registry;

/** Blocs masqués (préférence filtrée sur les ids encore connus). */
export function hiddenWidgets<Id extends string>(
  registry: WidgetRegistry<Id>,
  pref: WidgetsPref | undefined,
): Id[] {
  return (pref?.hidden ?? []).filter((id): id is Id => isKnownWidget(registry, id));
}

/**
 * Ordre effectif de la page : l'ordre sauvegardé d'abord, puis les blocs jamais ordonnés
 * (livrés après la dernière sauvegarde) à leur place de déclaration, moins les masqués.
 */
export function visibleWidgets<Id extends string>(
  registry: WidgetRegistry<Id>,
  pref: WidgetsPref | undefined,
): Id[] {
  const hidden = new Set(hiddenWidgets(registry, pref));
  const saved = (Array.isArray(pref?.order) ? pref.order : []).filter((id): id is Id =>
    isKnownWidget(registry, id),
  );
  const ordered = [...saved, ...registryIds(registry).filter((id) => !saved.includes(id))];
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
export function widgetSettings<Id extends string>(
  registry: WidgetRegistry<Id>,
  id: Id,
  pref: WidgetsPref | undefined,
): ResolvedWidgetSettings {
  const definition = registry[id];
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
  id: string,
  patch: WidgetSettings,
  pref: WidgetsPref | undefined,
): WidgetsPref {
  return {
    ...pref,
    settings: { ...pref?.settings, [id]: { ...pref?.settings?.[id], ...patch } },
  };
}

/**
 * Réordonne la page après un déplacement ; renvoie le patch de préférence.
 *
 * L'ordre complet est réécrit, blocs masqués compris : ne sauvegarder que les visibles
 * ferait réapparaître un bloc démasqué à une place arbitraire.
 */
export function reorderWidgets<Id extends string>(
  registry: WidgetRegistry<Id>,
  activeId: Id,
  overId: Id,
  pref: WidgetsPref | undefined,
): WidgetsPref {
  const visible = visibleWidgets(registry, pref);
  const from = visible.indexOf(activeId);
  const to = visible.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return pref ?? {};
  const next: Id[] = [...visible];
  next.splice(from, 1);
  next.splice(to, 0, activeId);
  const hidden = hiddenWidgets(registry, pref);
  return { ...pref, order: [...next, ...hidden.filter((id) => !next.includes(id))] };
}

/** Masque ou réaffiche un bloc ; renvoie le patch de préférence. */
export function toggleWidget<Id extends string>(
  registry: WidgetRegistry<Id>,
  id: Id,
  visible: boolean,
  pref: WidgetsPref | undefined,
): WidgetsPref {
  const hidden = new Set<string>(hiddenWidgets(registry, pref));
  if (visible) hidden.delete(id);
  else hidden.add(id);
  return { ...pref, hidden: [...hidden] };
}

/** Rend à la page sa disposition d'origine. */
export function resetWidgets<Id extends string>(registry: WidgetRegistry<Id>): WidgetsPref {
  return { hidden: [], order: registryIds(registry), settings: {} };
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
