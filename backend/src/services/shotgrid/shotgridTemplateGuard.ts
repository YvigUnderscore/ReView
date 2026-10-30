// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { logger } from '../../lib/logger';
import { badRequest } from '../../lib/errors';
import { asString, type SgRecord } from './shotgridMapper';

/**
 * Protection of ShotGrid template projects.
 *
 * A studio site keeps projects that serve as templates for all the others ("Template Project" and its variants). Writing into one does not break a project: it breaks all
 * those later derived from it, and nobody links the two for a long time.
 *
 * Segregation by project is enough in theory — a template is not the linked project. This guard exists for the case where the theory is wrong: identifier re-typed by hand,
 * project renamed, link inherited from a trial. It refuses the link as well as the write, without ever trusting the identifier alone.
 */

/** Name patterns that designate a template on a ShotGrid site. */
const TEMPLATE_PATTERNS = [
  /^template\b/i,
  /\btemplate\s*project\b/i,
  /^_?template/i,
  /\bproject\s*template\b/i,
  /^zzz?[_ -]?template/i,
];

export function looksLikeTemplate(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = name.trim();
  return TEMPLATE_PATTERNS.some((re) => re.test(trimmed));
}

/**
 * Can a ShotGrid project be linked? A template is refused at the source: that is the safest moment to say no, before a single request goes out.
 */
export function assertNotTemplateProject(name: string | null | undefined, sgProjectId: number): void {
  if (!looksLikeTemplate(name)) return;
  logger.warn({ sgProjectId, name }, 'Attempt to link a ShotGrid template project — refused');
  throw badRequest(
    `"${name}" is a ShotGrid template project: linking it would expose every project created from it. Choose a production project.`,
  );
}

/**
 * Last bulwark before a write: does the target belong to a template?
 * Returns `false` so that the caller gives up cleanly rather than throwing — a refused write is logged, it does not interrupt a synchronization.
 */
export function writeAllowedOn(record: SgRecord | null | undefined): boolean {
  if (!record) return false;
  if (record.type === 'Project') return !looksLikeTemplate(asString(record.name));
  const project = record.project as { name?: unknown } | null | undefined;
  return !looksLikeTemplate(asString(project?.name));
}
