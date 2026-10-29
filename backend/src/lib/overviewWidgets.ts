// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role } from '@prisma/client';
import { z } from 'zod';

/**
 * Registry of the **blocks of a project's overview** — the list the screen offers to show, hide and reorder, and the only
 * one the server agrees to write, whether it is a person's layout or a role's default.
 *
 * It exists for the same reason as `notificationKinds`: `User.preferences` is a schema-less JSON bag, and a layout written
 * with invented identifiers would have been saved without a murmur to display nothing at all. The registry is **copied
 * verbatim on the front end** (`frontend/src/v2/pages/project/overview/overviewWidgets.ts`), and `overviewWidgets.test.ts`
 * refuses the two copies diverging — the same contract as `notificationKinds` and `i18n/locales.json`.
 *
 * The order of the list is the declaration order: it is what places a block shipped after the last save, and what a layout
 * reset to zero recovers.
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

/** Top-level key of the preference bag where a person's layout lives. */
export const OVERVIEW_PREFERENCE_KEY = 'projectOverview';

/** Key of the studio setting where the default layouts live, one per role. */
export const OVERVIEW_DEFAULTS_SETTING_KEY = 'overview_layout_defaults';

const isWidgetId = (value: string): boolean => (OVERVIEW_WIDGETS as readonly string[]).includes(value);

/** Widths admitted on the twelve-column grid — the same ramp as on the home page. */
const spanSchema = z.union([z.literal(3), z.literal(4), z.literal(6), z.literal(8), z.literal(12)]);

/**
 * Admitted heights, in **rows** of the overview grid.
 *
 * A copy of the `OVERVIEW_ROWS` ramp (`frontend/…/overview/overviewSizing.ts`), guarded by the same test as the list of
 * blocks: the screen can only render these footprints, and a height off the ramp would be saved only to never be read back.
 * The `height` key remains admitted alongside — it is the one of layouts saved before the rows, which the screen translates
 * on read.
 */
export const OVERVIEW_ROWS = [2, 3, 4, 5, 6] as const;

const rowsSchema = z
  .number()
  .int()
  .refine((value) => (OVERVIEW_ROWS as readonly number[]).includes(value));

/**
 * Settings of a block. `.strict()`: an invented setting key is a writing defect, not an extension — nobody would read it back.
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

/** List of block identifiers, without duplicates and bounded to the registry. */
const widgetIdList = z
  .array(z.string().max(40))
  .max(OVERVIEW_WIDGETS.length)
  .refine((ids) => ids.every(isWidgetId), { message: 'Unknown overview widget' })
  .refine((ids) => new Set(ids).size === ids.length, { message: 'Duplicate overview widget' });

/**
 * Admissible shape of a layout — a person's as well as a role's.
 *
 * The identifiers are checked by a `refine` rather than by `z.enum`, for the same reason as the notifications registry:
 * the unknown is refused on **write**, and the read merely ignores what it no longer knows. A block removed from the product
 * must not make the layout of a whole studio unreadable.
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
 * Default layouts, one per role. A role with no entry has never been set: the screen then falls back on the layout shipped
 * with the product, which it carries itself.
 */
export const overviewDefaultsSchema = z
  .record(z.string().max(20), overviewLayoutSchema)
  .refine((value) => Object.keys(value).every((role) => role in Role), { message: 'Unknown role' });

export type OverviewRoleDefaults = Partial<Record<Role, OverviewLayout>>;
