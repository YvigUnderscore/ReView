// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { belongsToProject, projectFilter, type ProjectScope } from './shotgridProjectGuard';
import type { ShotgridClient } from './ShotgridClient';
import { logger } from '../../lib/logger';

/**
 * Does a Version already carrying this code exist on the site?
 *
 * Publishing from ReView used to create a Version without ever looking for one of the same name. The case is common: an artist publishes in ReView a piece of work whose
 * Version has already been created on the site by their render tool. The site then ended up with two identical entries, and production no longer knew which to look at —
 * a duplicate cannot be undone from here, it has to be deleted by hand over there.
 *
 * Two homonyms: we choose neither. Getting the attachment wrong costs more than creating one Version too many, which a human will see.
 */
export async function findVersionByCode(
  ctx: { client: ShotgridClient; scope: ProjectScope },
  code: string,
): Promise<number | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  const records = await ctx.client.search('Version', {
    fields: ['id', 'code', 'project'],
        // The project filter is mandatory: a site hosts all the studio's projects, and a version code readily repeats from one project to another.
    filters: [projectFilter(ctx.scope.sgProjectId), ['code', 'is', trimmed]],
    maxRecords: 5,
  });
    // Each record is rechecked: the filter may be bypassed by an unexpected site configuration, and writing into the neighbouring project cannot be undone.
  const mine = records.filter((r) => belongsToProject(r, ctx.scope).ok);
  if (mine.length !== 1) {
    if (mine.length > 1) {
      logger.warn({ code: trimmed, count: mine.length }, 'Plusieurs Versions ShotGrid du même code');
    }
    return null;
  }
  return mine[0]!.id;
}
