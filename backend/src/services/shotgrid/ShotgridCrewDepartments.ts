// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logger } from '../../lib/logger';
import { asEntityRef, asString, type SgRecord } from './shotgridMapper';
import type { ShotgridClient } from './ShotgridClient';
import { findByKey } from '../DepartmentService';
import type { Department } from '@prisma/client';

/**
 * Le département d'une personne, tel que le site le déclare (lot 10).
 *
 * Un site ShotGrid range ses artistes par département, et c'est l'information qui manquait
 * à l'import d'équipe : les comptes arrivaient, mais il fallait ensuite dire à la main qui
 * fait du compositing et qui fait du lighting.
 *
 * Deux précautions gouvernent ce module.
 *
 * 1. **On sonde le schéma avant de demander quoi que ce soit.** Un champ inconnu ne renvoie
 *    pas « vide » : la requête entière échoue, et l'équipe ne se charge plus du tout. Or le
 *    champ n'a pas le même nom partout — `department` est le champ standard (lien vers
 *    l'entité `Department`), `sg_department` la variante maison qu'on trouve sur les sites
 *    anciens. On ne demande donc que ce que `/schema/HumanUser/fields` déclare.
 * 2. **On ne crée jamais de département.** Un département ShotGrid est une unité
 *    d'organisation — « 2D », « Production », « Pipeline » — pas nécessairement une étape
 *    du pipe. Le rapprochement se fait sur ce que le studio a déjà déclaré ; ce qui ne
 *    correspond à rien reste affiché tel quel, à titre indicatif, et n'enrichit rien.
 */

/** Les deux noms sous lesquels un site range le département d'un `HumanUser`. */
export const DEPARTMENT_FIELDS = ['department', 'sg_department'] as const;

/**
 * Ceux de ces champs que le site déclare vraiment.
 *
 * Le schéma ne se lit pas toujours — un script sans droit dessus répond 403. L'échec vaut
 * alors « pas de département » : c'est une information de confort, elle n'a pas à faire
 * tomber le chargement de l'équipe.
 */
export async function departmentFields(client: ShotgridClient): Promise<string[]> {
  try {
    const declared = await client.schemaFields('HumanUser');
    return DEPARTMENT_FIELDS.filter((field) => declared.has(field));
  } catch (err) {
    logger.warn({ err }, 'Schéma HumanUser illisible : département ShotGrid ignoré');
    return [];
  }
}

/**
 * Le libellé porté par un enregistrement, quelle que soit la forme du champ : lien
 * d'entité (le cas standard), liste de liens (site qui autorise plusieurs départements),
 * ou simple texte (champ maison).
 */
export function departmentLabel(record: SgRecord, fields: readonly string[]): string | null {
  for (const field of fields) {
    const raw = record[field];
    const one = asEntityRef(raw);
    if (one?.name) return one.name;
    if (Array.isArray(raw)) {
      const named = raw.map((item) => asEntityRef(item)).find((ref) => ref?.name);
      if (named?.name) return named.name;
    }
    const text = asString(raw);
    if (text) return text;
  }
  return null;
}

/**
 * Le département ReView correspondant, **s'il existe déjà**. Une seule recherche par
 * libellé distinct : une équipe de soixante personnes tient en cinq ou six départements.
 */
export async function matchDepartments(
  projectId: number,
  labels: readonly (string | null)[],
): Promise<Map<string, Department>> {
  const out = new Map<string, Department>();
  for (const label of new Set(labels.filter((l): l is string => Boolean(l)))) {
    const found = await findByKey(projectId, label);
    if (found) out.set(label, found);
  }
  return out;
}
