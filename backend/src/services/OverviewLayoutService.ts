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
 * Dispositions par défaut de la vue d'ensemble, **une par rôle**, décidées en
 * administration.
 *
 * Un artiste, un superviseur et un producteur n'ouvrent pas la même page : le premier veut
 * ce qui lui est assigné, le deuxième ce qui bloque, le troisième l'avancement. Servir la
 * même disposition à tout le monde revient à demander à chacun de la refaire — et celui qui
 * ne la refait pas garde une page qui ne lui parle pas.
 *
 * Le stockage est une ligne de `Setting` : quatre dispositions de quelques centaines
 * d'octets ne méritent pas une table, et l'administration écrit déjà ses réglages là.
 */

/**
 * Les défauts enregistrés. Une valeur illisible — JSON cassé, forme d'une version
 * antérieure, bloc disparu du produit — rend un objet vide plutôt qu'une erreur : la page
 * doit s'ouvrir quoi qu'il arrive, sur la disposition livrée avec le produit.
 */
export async function getRoleDefaults(): Promise<OverviewRoleDefaults> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  return parseDefaults(row?.value);
}

/** Lecture tolérante du réglage, isolée pour être testable sans base. */
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
 * Enregistre (ou retire, avec `null`) la disposition par défaut d'un rôle.
 *
 * Lecture puis écriture dans une transaction : les quatre rôles vivent dans la même ligne,
 * et deux administrateurs qui règlent deux rôles à la même seconde s'effaceraient l'un
 * l'autre. C'est aussi pourquoi seul le rôle visé est remplacé, jamais la carte entière.
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
