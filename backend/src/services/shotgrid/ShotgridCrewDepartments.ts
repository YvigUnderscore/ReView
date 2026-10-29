// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logger } from '../../lib/logger';
import { asEntityRef, asString, type SgRecord } from './shotgridMapper';
import type { ShotgridClient } from './ShotgridClient';
import { findByKey } from '../DepartmentService';
import type { Department } from '@prisma/client';

/**
 * A person's department, as the site declares it (batch 10).
 *
 * A ShotGrid site sorts its artists by department, and that is the information missing from the team import: accounts arrived,
 * but one then had to say by hand who does compositing and who does lighting.
 *
 * Two precautions govern this module.
 *
 * 1. **The schema is probed before asking for anything.** An unknown field does not return "empty": the whole request fails, and the
 *    team is no longer loaded at all. Yet the field does not have the same name everywhere: `department` is the standard field (link to
 *    the `Department` entity), `sg_department` the in-house variant found on older sites. We therefore only ask for what
 *    `/schema/HumanUser/fields` declares.
 * 2. **A department is never created.** A ShotGrid department is an organizational unit ("2D", "Production", "Pipeline"), not necessarily
 *    a step of the pipe. Matching is done against what the studio has already declared; what matches nothing stays displayed as is, for
 *    information, and enriches nothing.
 */

/** The two names under which a site sorts the department of a `HumanUser`. */
export const DEPARTMENT_FIELDS = ['department', 'sg_department'] as const;

/**
 * Those of these fields that the site really declares.
 *
 * The schema is not always readable: a script without rights on it gets a 403. The failure then means "no department": it is a
 * convenience information, and must not bring down the loading of the team.
 */
export async function departmentFields(client: ShotgridClient): Promise<string[]> {
  try {
    const declared = await client.schemaFields('HumanUser');
    return DEPARTMENT_FIELDS.filter((field) => declared.has(field));
  } catch (err) {
    logger.warn({ err }, 'Unreadable HumanUser schema: ShotGrid department ignored');
    return [];
  }
}

/**
 * The label carried by a record, whatever the shape of the field: entity link (the standard case), list of links (a site that allows
 * several departments), or plain text (in-house field).
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
 * The matching ReView department, **if it already exists**. A single lookup per distinct label: a team of sixty people fits in five or six departments.
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
