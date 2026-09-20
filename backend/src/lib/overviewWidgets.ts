// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role } from '@prisma/client';
import { z } from 'zod';

/**
 * Registre des **blocs de la vue d'ensemble d'un projet** — la liste que l'écran propose
 * d'afficher, de masquer et de réordonner, et la seule que le serveur accepte d'écrire,
 * qu'il s'agisse de la disposition d'une personne ou du défaut d'un rôle.
 *
 * Il existe pour la même raison que `notificationKinds` : `User.preferences` est un sac
 * JSON sans schéma, et une disposition écrite avec des identifiants inventés se serait
 * enregistrée sans broncher pour ne rien afficher du tout. Le registre est **recopié à
 * l'identique côté front** (`frontend/src/v2/pages/project/overview/overviewWidgets.ts`),
 * et `overviewWidgets.test.ts` refuse que les deux copies divergent — même contrat que
 * `notificationKinds` et `i18n/locales.json`.
 *
 * L'ordre de la liste est l'ordre de déclaration : c'est lui qui place un bloc livré après
 * la dernière sauvegarde, et celui que retrouve une disposition remise à zéro.
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

/** Clé du réglage studio où vivent les dispositions par défaut, une par rôle. */
export const OVERVIEW_DEFAULTS_SETTING_KEY = 'overview_layout_defaults';

const isWidgetId = (value: string): boolean => (OVERVIEW_WIDGETS as readonly string[]).includes(value);

/** Largeurs admises sur la grille de douze — la même rampe qu'à l'accueil. */
const spanSchema = z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(12)]);

/**
 * Hauteurs admises, en **rangées** de la grille de la vue d'ensemble.
 *
 * Recopie de la rampe `OVERVIEW_ROWS` (`frontend/…/overview/overviewSizing.ts`), gardée par
 * le même test que la liste des blocs : l'écran ne sait rendre que ces emprises, et une
 * hauteur hors rampe s'enregistrerait pour ne jamais être relue. La clé `height` reste
 * admise à côté — c'est celle des dispositions enregistrées avant les rangées, que l'écran
 * traduit à la lecture.
 */
export const OVERVIEW_ROWS = [2, 3, 4, 5, 6] as const;

const rowsSchema = z
  .number()
  .int()
  .refine((value) => (OVERVIEW_ROWS as readonly number[]).includes(value));

/**
 * Réglages d'un bloc. `.strict()` : une clé de réglage inventée est un défaut d'écriture,
 * pas une extension — elle ne serait relue par personne.
 */
const widgetSettingsSchema = z
  .object({
    span: spanSchema.optional(),
    rows: rowsSchema.optional(),
    height: z.enum(['short', 'normal', 'tall']).optional(),
    density: z.enum(['comfortable', 'compact']).optional(),
    variant: z.enum(['list', 'grid', 'kpi']).optional(),
    bare: z.boolean().optional(),
  })
  .strict();

/** Liste d'identifiants de blocs, sans doublon et bornée au registre. */
const widgetIdList = z
  .array(z.string().max(40))
  .max(OVERVIEW_WIDGETS.length)
  .refine((ids) => ids.every(isWidgetId), { message: 'Unknown overview widget' })
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate overview widget' });

/**
 * Forme admissible d'une disposition — celle d'une personne comme celle d'un rôle.
 *
 * Les identifiants sont contrôlés par un `refine` plutôt que par `z.enum`, pour la même
 * raison qu'au registre des notifications : l'inconnu se refuse à **l'écriture**, et la
 * lecture, elle, se contente d'ignorer ce qu'elle ne connaît plus. Un bloc retiré du
 * produit ne doit pas rendre illisible la disposition de tout un studio.
 */
export const overviewLayoutSchema = z
  .object({
    hidden: widgetIdList.optional(),
    order: widgetIdList.optional(),
    settings: z
      .record(z.string().max(40), widgetSettingsSchema)
      .refine((value) => Object.keys(value).every(isWidgetId), { message: 'Unknown overview widget' })
      .optional(),
  })
  .strict();

export type OverviewLayout = z.infer<typeof overviewLayoutSchema>;

/**
 * Dispositions par défaut, une par rôle. Un rôle absent n'a jamais été réglé : l'écran
 * retombe alors sur la disposition livrée avec le produit, qu'il porte lui-même.
 */
export const overviewDefaultsSchema = z
  .record(z.string().max(20), overviewLayoutSchema)
  .refine((value) => Object.keys(value).every((role) => role in Role), { message: 'Unknown role' });

export type OverviewRoleDefaults = Partial<Record<Role, OverviewLayout>>;
