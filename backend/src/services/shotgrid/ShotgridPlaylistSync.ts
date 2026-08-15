// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { belongsToProject, projectFilter } from './shotgridProjectGuard';
import { asDate, asEntityRefs, asString } from './shotgridMapper';
import { findByLocal, mapSgToLocal, upsertLink } from './shotgridLinks';
import { can } from './shotgridSettings';
import type { PullContext } from './ShotgridPullService';

/**
 * Playlists ShotGrid ↔ playlists de dailies.
 *
 * Une playlist prépare une séance de review : elle est constituée dans l'outil où l'on
 * travaille, et doit être jouable dans celui où l'on projette. L'ordre compte autant
 * que le contenu — une séance suit un déroulé, pas un ensemble.
 */

const PLAYLIST_FIELDS = ['code', 'description', 'versions', 'created_at', 'updated_at', 'project'];

/**
 * Import des playlists du projet.
 *
 * Seules les versions déjà connues de ReView entrent : une playlist ShotGrid peut citer
 * des versions que le filtre de statuts a écartées à l'import, et les inventer ici
 * fabriquerait des entrées qui ne mènent nulle part. L'ordre de ShotGrid est conservé.
 */
export async function pullPlaylists(ctx: PullContext): Promise<void> {
  if (!can(ctx.settings, 'playlists', 'read')) return;

  const records = await ctx.client.search('Playlist', {
    fields: PLAYLIST_FIELDS,
    filters: [projectFilter(ctx.scope.sgProjectId)],
    sort: '-id',
    maxRecords: 200,
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

    const link = playlistLinks.get(record.id);
    const existing = link
      ? await prisma.playlist.findUnique({ where: { id: link.localId } })
      : await prisma.playlist.findUnique({
          where: { projectId_name: { projectId: ctx.connection.projectId, name } },
        });

    const playlist = existing
      ? await prisma.playlist.update({ where: { id: existing.id }, data: { name } })
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
