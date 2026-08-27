// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { belongsToProject, projectFilter } from './shotgridProjectGuard';
import { asDate, asEntityRefs, asString } from './shotgridMapper';
import { findByLocal, mapSgToLocal, upsertLink } from './shotgridLinks';
import { can } from './shotgridSettings';
import { touch, type PullContext } from './ShotgridPullService';

/**
 * Playlists ShotGrid ↔ playlists de dailies.
 *
 * Une playlist prépare une séance de review : elle est constituée dans l'outil où l'on
 * travaille, et doit être jouable dans celui où l'on projette. L'ordre compte autant
 * que le contenu — une séance suit un déroulé, pas un ensemble.
 */

const PLAYLIST_FIELDS = ['code', 'description', 'versions', 'created_at', 'updated_at', 'project'];

export interface PlaylistPullOptions {
  /** Playlists précises à relire (traitement d'un événement). */
  onlySgIds?: number[];
}

/**
 * Import des playlists du projet.
 *
 * Seules les versions déjà connues de ReView entrent : une playlist ShotGrid peut citer
 * des versions que le filtre de statuts a écartées à l'import, et les inventer ici
 * fabriquerait des entrées qui ne mènent nulle part. L'ordre de ShotGrid est conservé.
 */
export async function pullPlaylists(ctx: PullContext, options: PlaylistPullOptions = {}): Promise<void> {
  if (!can(ctx.settings, 'playlists', 'read')) return;

  // Restriction cumulative : le filtre de projet reste posé même quand on ne relit
  // qu'une playlist désignée par un événement, et chaque enregistrement est revérifié.
  const filters: Array<[string, string, unknown]> = [projectFilter(ctx.scope.sgProjectId)];
  if (options.onlySgIds?.length) filters.push(['id', 'in', options.onlySgIds]);

  const records = await ctx.client.search('Playlist', {
    fields: PLAYLIST_FIELDS,
    filters,
    sort: '-id',
    maxRecords: options.onlySgIds?.length ?? 200,
  });

  const versionLinks = await mapSgToLocal(ctx.connection.id, 'version');
  const playlistLinks = await mapSgToLocal(ctx.connection.id, 'playlist');

  for (const record of records) {
    if (!belongsToProject(record, ctx.scope).ok) {
      ctx.journal.count('guard', 'skipped');
      continue;
    }
    const name = asString(record.code);
    if (!name) continue;

    const versionIds = asEntityRefs(record.versions)
      .map((r) => versionLinks.get(r.id)?.localId)
      .filter((id): id is number => typeof id === 'number');

    /*
     * Retrouver la playlist locale, dans cet ordre : le lien, puis le nom.
     *
     * Le repli sur le nom vaut **aussi quand le lien existe** : il peut désigner une
     * playlist supprimée depuis, et une création aveugle butait alors sur la contrainte
     * `(projectId, name)` — la synchronisation entière s'arrêtait pour une playlist
     * effacée à la main des mois plus tôt.
     */
    const link = playlistLinks.get(record.id);
    const linked = link ? await prisma.playlist.findUnique({ where: { id: link.localId } }) : null;
    const byName = await prisma.playlist.findUnique({
      where: { projectId_name: { projectId: ctx.connection.projectId, name } },
    });
    const existing = linked ?? byName;

    /*
     * Renommage côté ShotGrid vers un nom déjà porté par une AUTRE playlist locale : on
     * garde le nom actuel plutôt que de faire échouer le lot. Fusionner deux séances ou en
     * écraser une n'est pas une décision qu'une synchronisation prend toute seule ; le
     * conflit se voit au journal, et se tranche à la main.
     */
    const renameCollides = Boolean(linked && byName && byName.id !== linked.id);
    if (renameCollides) {
      ctx.journal.count('playlists', 'skipped');
      await ctx.journal.log(
        'conflict',
        'shotgrid.log.playlistNameTaken',
        { name },
        { sgType: 'Playlist', sgId: record.id, localType: 'playlist', localId: linked!.id },
      );
    }

    const playlist = existing
      ? await prisma.playlist.update({
          where: { id: existing.id },
          data: renameCollides ? {} : { name },
        })
      : await prisma.playlist.create({ data: { projectId: ctx.connection.projectId, name } });

    // Le contenu est remplacé, pas complété : une version retirée côté ShotGrid doit
    // disparaître de la séance, et repasser deux fois ne doit rien dupliquer.
    await prisma.playlistItem.deleteMany({ where: { playlistId: playlist.id } });
    if (versionIds.length > 0) {
      await prisma.playlistItem.createMany({
        data: versionIds.map((versionId, order) => ({ playlistId: playlist.id, versionId, order })),
        skipDuplicates: true,
      });
    }

    await upsertLink({
      connectionId: ctx.connection.id,
      localType: 'playlist',
      localId: playlist.id,
      sgType: 'Playlist',
      sgId: record.id,
      sgUpdatedAt: asDate(record.updated_at),
      data: { versionCount: versionIds.length },
    });
    touch(ctx, 'playlist', playlist.id);
    ctx.journal.count('playlists', existing ? 'updated' : 'created');
  }
}

export interface PlaylistPushContext {
  connectionId: number;
  sgProjectId: number;
  client: {
    create: (entity: string, data: Record<string, unknown>) => Promise<{ id: number }>;
    update: (
      entity: string,
      id: number,
      data: Record<string, unknown>,
      options?: { asUserLogin?: string | null },
    ) => Promise<unknown>;
  };
  asUserLogin: string | null;
}

/**
 * Envoi d'une playlist vers ShotGrid.
 *
 * Une playlist déjà liée est mise à jour plutôt que recréée — sans quoi chaque
 * modification laisserait une séance de plus dans la liste du studio. Les versions non
 * reliées sont ignorées : elles n'existent pas là-bas.
 */
export async function pushPlaylist(ctx: PlaylistPushContext, playlistId: number): Promise<number | null> {
  const playlist = await prisma.playlist.findUnique({
    where: { id: playlistId },
    include: { items: { orderBy: { order: 'asc' }, select: { versionId: true } } },
  });
  if (!playlist) return null;

  const versionRefs: Array<{ type: string; id: number }> = [];
  for (const item of playlist.items) {
    const link = await findByLocal(ctx.connectionId, 'version', item.versionId);
    if (link) versionRefs.push({ type: 'Version', id: link.sgId });
  }

  const existing = await findByLocal(ctx.connectionId, 'playlist', playlist.id);
  if (existing) {
    await ctx.client.update(
      'Playlist',
      existing.sgId,
      { code: playlist.name, versions: versionRefs },
      { asUserLogin: ctx.asUserLogin },
    );
    logger.info({ playlistId, sgId: existing.sgId }, 'Playlist mise à jour dans ShotGrid');
    return existing.sgId;
  }

  const created = await ctx.client.create('Playlist', {
    project: { type: 'Project', id: ctx.sgProjectId },
    code: playlist.name,
    versions: versionRefs,
  });
  await upsertLink({
    connectionId: ctx.connectionId,
    localType: 'playlist',
    localId: playlist.id,
    sgType: 'Playlist',
    sgId: created.id,
    data: { createdFromReview: true },
  });
  logger.info({ playlistId, sgId: created.id }, 'Playlist créée dans ShotGrid');
  return created.id;
}
