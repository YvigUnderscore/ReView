// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { sgMediaName } from '../../lib/mediaNaming';
import type { SyncJournal } from './ShotgridSyncJournal';

/**
 * Réalignement des noms de médias déjà importés.
 *
 * Les médias rapatriés avant cette version portent le nom du fichier joint. Plutôt qu'une
 * migration SQL — qui ne saurait pas quel média vient du site ni quel code lui
 * correspond — la correction se fait à la relecture : chaque passe de synchronisation
 * repasse sur les médias de la version et les renomme si besoin. Idempotent : une version
 * déjà alignée n'écrit rien.
 *
 * Seuls les médias marqués `importedFromShotgrid` sont touchés. Le fichier qu'un artiste a
 * déposé à la main garde son nom : il porte de l'information (`_lin_`, `_acescg_`,
 * `_h265_`) que le code du site ne reprend pas.
 *
 * C'est de la **présentation**, comme la miniature : le verrou de publication ne
 * s'applique pas, et rien de tout ceci n'est exposé en route utilisateur.
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
    // Le nom du fichier livré, s'il a été conservé ; sinon le nom courant fait foi pour
    // l'extension — c'est lui qui vient du site.
    const sourceFilename = typeof meta.sourceFilename === 'string' ? meta.sourceFilename : item.originalName;
    const wanted = sgMediaName({ code, sourceFilename, mimeType: item.mimeType });
    if (wanted === item.originalName) continue;
    await prisma.mediaObject.update({
      where: { id: item.id },
      data: {
        originalName: wanted,
        // La première reprise mémorise le nom d'origine, sans quoi il serait perdu.
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
