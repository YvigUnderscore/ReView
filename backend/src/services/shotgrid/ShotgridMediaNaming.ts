// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { sgMediaName } from '../../lib/mediaNaming';
import type { SyncJournal } from './ShotgridSyncJournal';

/**
 * Realignment of media names already imported.
 *
 * Media fetched before this version carry the name of the attached file. Rather than an SQL migration, which would not know which media come from the
 * site nor which code matches them, the correction is done on re-reading: each synchronization pass goes back over the version's media and renames them if
 * needed. Idempotent: a version already aligned writes nothing.
 *
 * Only media marked `importedFromShotgrid` are touched. A file an artist dropped by hand keeps its name: it carries information (`_lin_`, `_acescg_`,
 * `_h265_`) that the site's code does not reproduce.
 *
 * This is **presentation**, like the thumbnail: the publication lock does not apply, and none of this is exposed on a user route.
 */
export async function realignMediaNames(
  ctx: { journal: SyncJournal; settings: { media: { naming: 'sgCode' | 'filename' } } },
  versionId: number,
  code: string,
): Promise<number> {
  if (ctx.settings.media.naming !== 'sgCode') return 0;
  const media = await prisma.mediaObject.findMany({
    where: { versionId, deletedAt: null },
    select: { id: true, originalName: true, mimeType: true, metadata: true },
  });

  let renamed = 0;
  for (const item of media) {
    const meta = (item.metadata ?? {}) as Record<string, unknown>;
    if (meta.importedFromShotgrid !== true) continue;
    // The name of the delivered file, if it was kept; otherwise the current name is authoritative for the
    // extension: it is the one that comes from the site.
    const sourceFilename = typeof meta.sourceFilename === 'string' ? meta.sourceFilename : item.originalName;
    const wanted = sgMediaName({ code, sourceFilename, mimeType: item.mimeType });
    if (wanted === item.originalName) continue;
    await prisma.mediaObject.update({
      where: { id: item.id },
      data: {
        originalName: wanted,
        // The first rename records the original name, otherwise it would be lost.
        metadata: { ...meta, sourceFilename } as never,
      },
    });
    await ctx.journal.log(
      'info',
      'shotgrid.log.mediaRenamed',
      { name: code, from: item.originalName, to: wanted },
      { localType: 'media', localId: item.id },
    );
    renamed += 1;
  }
  return renamed;
}
