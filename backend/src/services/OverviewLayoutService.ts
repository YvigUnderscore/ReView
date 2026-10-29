// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Role } from '@prisma/client';
import { prisma } from '../lib/prisma';
import {
  OVERVIEW_DEFAULTS_SETTING_KEY as KEY,
  overviewDefaultsSchema,
  type OverviewLayout,
  type OverviewRoleDefaults,
} from '../lib/overviewWidgets';

/**
 * Default layouts of the overview, **one per role**, decided in administration.
 *
 * An artist, a supervisor and a producer do not open the same page: the first wants what is assigned to them,
 * the second what blocks, the third progress. Serving the same layout to
 * everyone amounts to asking each to redo it — and whoever does not redo it keeps a page that does not speak
 * to them.
 *
 * Storage is one `Setting` row: four layouts of a few hundred bytes do not merit a table, and administration
 * already writes its settings there.
 */

/**
 * The registered defaults. An unreadable value — broken JSON, the shape of an earlier version, a block that
 * has disappeared from the product — returns an empty object rather than an error:
 * the page must open whatever happens, on the layout shipped with the product.
 */
export async function getRoleDefaults(): Promise<OverviewRoleDefaults> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  return parseDefaults(row?.value);
}

/** Tolerant reading of the setting, isolated so it can be tested without a database. */
export function parseDefaults(value: string | null | undefined): OverviewRoleDefaults {
  if (!value) return {};
  try {
    const parsed = overviewDefaultsSchema.safeParse(JSON.parse(value));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/**
 * Saves (or removes, with `null`) the default layout of a role.
 *
 * Read then write within a transaction: the four roles live in the same row, and two administrators setting
 * two roles in the same second would erase each other. This is also why only the
 * targeted role is replaced, never the whole map.
 */
export async function setRoleDefault(
  role: Role,
  layout: OverviewLayout | null,
): Promise<OverviewRoleDefaults> {
  return prisma.$transaction(async (tx) => {
    const row = await tx.setting.findUnique({ where: { key: KEY } });
    const next = parseDefaults(row?.value);
    if (layout === null) delete next[role];
    else next[role] = layout;
    const value = JSON.stringify(next);
    await tx.setting.upsert({ where: { key: KEY }, update: { value }, create: { key: KEY, value } });
    return next;
  });
}
