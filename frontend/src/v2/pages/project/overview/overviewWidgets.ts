// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  hiddenWidgets as genericHidden,
  registryIds,
  reorderWidgets as genericReorder,
  setWidgetSetting as genericSetSetting,
  toggleWidget as genericToggle,
  visibleWidgets as genericVisible,
  widgetSettings as genericSettings,
  type ResolvedWidgetSettings,
  type WidgetDefinition,
  type WidgetSettings,
  type WidgetsPref,
} from '../../../lib/widgetLayout';
import type { Role } from '../../../types/api';

/**
 * Registre des blocs de la vue d'ensemble d'un projet (lot 10).
 *
 * La page était figée : trois compteurs, huit vignettes, une jauge et deux colonnes, dans
 * cet ordre, pour tout le monde. Or un artiste, un superviseur et un producteur n'ouvrent
 * pas la même page — le premier vient voir ce qu'on lui demande, le deuxième ce qui bloque,
 * le troisième où en est le projet. La page se compose donc **par personne**, sur un défaut
 * **par rôle** décidé en administration.
 *
 * La liste des identifiants est **recopiée à l'identique côté serveur**
 * (`backend/src/lib/overviewWidgets.ts`), qui refuse d'enregistrer une disposition citant
 * un bloc inconnu ; `overviewWidgets.test.ts` (backend) refuse que les deux copies
 * divergent. Les règles de composition, elles, sont celles de toute page composable
 * (`lib/widgetLayout`), partagées avec l'accueil.
 */
export const OVERVIEW_WIDGETS = [
  'counts',
  'myTasks',
  'latestMedia',
  'progress',
  'activity',
  'tasks',
  'attention',
  'retakes',
] as const;

export type OverviewWidgetId = (typeof OVERVIEW_WIDGETS)[number];

/** Clé de premier niveau du sac de préférences où vit la disposition d'une personne. */
export const OVERVIEW_PREFERENCE_KEY = 'projectOverview';

/**
 * Un bloc de la vue d'ensemble. `manage` marque ceux dont le contenu est **réservé à qui
 * gère le projet** : le serveur refuse déjà ces lectures aux autres (`requireProjectManage`),
 * et un bloc qui n'afficherait qu'une erreur ne doit pas exister pour eux — ni dans la
 * page, ni dans le catalogue des blocs à ajouter.
 */
export interface OverviewWidgetDefinition extends WidgetDefinition {
  manage?: boolean;
}

/** Ordre de déclaration = disposition livrée avec le produit, avant tout défaut de rôle. */
export const OVERVIEW_WIDGET_DEFS: Record<OverviewWidgetId, OverviewWidgetDefinition> = {
  counts: { labelKey: 'overview.widget.counts', span: 12, spans: [4, 6, 8, 12], variants: ['kpi'] },
  myTasks: { labelKey: 'home.myTasks', span: 6, spans: [4, 6, 8, 12], variants: ['list'] },
  latestMedia: { labelKey: 'playlist.latestPublished', span: 12, spans: [6, 8, 12], variants: ['grid'] },
  progress: { labelKey: 'activity.title', span: 12, spans: [6, 8, 12], variants: ['kpi'] },
  activity: { labelKey: 'home.recentActivity', span: 6, spans: [4, 6, 8, 12], variants: ['list'] },
  tasks: { labelKey: 'overview.widget.tasks', span: 6, spans: [4, 6, 8, 12], variants: ['list'] },
  attention: {
    labelKey: 'production.section.attention',
    span: 12,
    spans: [6, 8, 12],
    variants: ['list'],
    manage: true,
  },
  retakes: {
    labelKey: 'production.retakes.title',
    span: 12,
    spans: [6, 8, 12],
    variants: ['list'],
    manage: true,
  },
};

export const ALL_OVERVIEW_IDS = registryIds(OVERVIEW_WIDGET_DEFS);

export const isOverviewWidget = (v: string): v is OverviewWidgetId => v in OVERVIEW_WIDGET_DEFS;

/**
 * Dispositions livrées avec le produit, une par rôle.
 *
 * Elles ne sont qu'un point de départ — l'administration les remplace, chacun les modifie —
 * mais elles doivent déjà être justes : un studio qui ne règle rien doit ouvrir une page
 * qui parle à chacun. L'artiste entre par son travail, le superviseur par ce qui bloque,
 * le client par ce qu'il y a à regarder.
 */
export const BUILTIN_ROLE_LAYOUTS: Record<Role, WidgetsPref> = {
  ADMIN: {
    order: ['attention', 'progress', 'tasks', 'retakes', 'latestMedia', 'activity', 'counts', 'myTasks'],
    hidden: ['myTasks'],
    settings: { activity: { span: 6 }, tasks: { span: 6 } },
  },
  SUPERVISOR: {
    order: ['attention', 'progress', 'tasks', 'retakes', 'latestMedia', 'activity', 'counts', 'myTasks'],
    hidden: ['myTasks'],
    settings: { activity: { span: 6 }, tasks: { span: 6 } },
  },
  ARTIST: {
    order: ['myTasks', 'latestMedia', 'activity', 'progress', 'counts', 'tasks'],
    hidden: ['tasks', 'counts'],
    settings: { myTasks: { span: 6 }, activity: { span: 6 } },
  },
  // Un client vient voir ce qu'il y a à regarder, pas l'organisation interne du studio.
  CLIENT: {
    order: ['latestMedia', 'activity', 'counts', 'progress', 'myTasks', 'tasks'],
    hidden: ['counts', 'progress', 'myTasks', 'tasks'],
    settings: { activity: { span: 12 } },
  },
};

/**
 * Disposition effective : celle de la personne, **champ par champ**, complétée par le
 * défaut de son rôle.
 *
 * Le repli est par champ et non en bloc, et c'est tout l'intérêt : quelqu'un qui masque un
 * bloc n'a rien dit de l'ordre. Un repli « tout ou rien » lui ferait perdre l'ordre décidé
 * par l'administration au premier bloc masqué, et la page se réarrangerait sous ses yeux
 * pour un geste qui n'en demandait pas tant. Les réglages, eux, se superposent : ceux du
 * rôle d'abord, ceux de la personne par-dessus.
 */
export function resolveOverviewLayout(
  personal: WidgetsPref | undefined | null,
  roleLayout: WidgetsPref | undefined,
): WidgetsPref {
  const base = roleLayout ?? {};
  if (!personal) return base;
  return {
    hidden: personal.hidden ?? base.hidden,
    order: personal.order ?? base.order,
    settings: personal.settings || base.settings ? { ...base.settings, ...personal.settings } : undefined,
  };
}

/**
 * Disposition par défaut d'un rôle : celle du studio si l'administration en a réglé une,
 * sinon celle livrée avec le produit. Un rôle inconnu (compte sans rôle lisible) retombe
 * sur l'artiste, le plus restreint des rôles internes.
 */
export function roleLayout(
  defaults: Partial<Record<Role, WidgetsPref>> | undefined,
  role: Role | null,
): WidgetsPref {
  const effective: Role = role ?? 'ARTIST';
  return defaults?.[effective] ?? BUILTIN_ROLE_LAYOUTS[effective];
}

/** Blocs masqués, filtrés sur ceux que le registre connaît encore. */
export const hiddenOverviewWidgets = (pref: WidgetsPref | undefined): OverviewWidgetId[] =>
  genericHidden(OVERVIEW_WIDGET_DEFS, pref);

/**
 * Ordre effectif de la page. `canManage` écarte les blocs dont le serveur refuse le
 * contenu : le filtre est ici, à la source, pour que le catalogue des blocs à ajouter ne
 * propose jamais ce qui n'afficherait qu'un 403.
 */
export function visibleOverviewWidgets(
  pref: WidgetsPref | undefined,
  canManage: boolean,
): OverviewWidgetId[] {
  return genericVisible(OVERVIEW_WIDGET_DEFS, pref).filter(
    (id) => canManage || !OVERVIEW_WIDGET_DEFS[id].manage,
  );
}

/** Blocs masqués qu'on peut proposer d'ajouter, droits compris. */
export function addableOverviewWidgets(
  pref: WidgetsPref | undefined,
  canManage: boolean,
): OverviewWidgetId[] {
  return hiddenOverviewWidgets(pref).filter((id) => canManage || !OVERVIEW_WIDGET_DEFS[id].manage);
}

/** Réglages effectifs d'un bloc : ceux de la disposition, complétés par le registre. */
export const overviewWidgetSettings = (
  id: OverviewWidgetId,
  pref: WidgetsPref | undefined,
): ResolvedWidgetSettings => genericSettings(OVERVIEW_WIDGET_DEFS, id, pref);

export const setOverviewWidgetSetting = (
  id: OverviewWidgetId,
  patch: WidgetSettings,
  pref: WidgetsPref | undefined,
): WidgetsPref => genericSetSetting(id, patch, pref);

export const reorderOverviewWidgets = (
  activeId: OverviewWidgetId,
  overId: OverviewWidgetId,
  pref: WidgetsPref | undefined,
): WidgetsPref => genericReorder(OVERVIEW_WIDGET_DEFS, activeId, overId, pref);

export const toggleOverviewWidget = (
  id: OverviewWidgetId,
  visible: boolean,
  pref: WidgetsPref | undefined,
): WidgetsPref => genericToggle(OVERVIEW_WIDGET_DEFS, id, visible, pref);
