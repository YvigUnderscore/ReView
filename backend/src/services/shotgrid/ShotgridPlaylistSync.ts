// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { belongsToProject, projectFilter } from './shotgridProjectGuard';
import { asDate, asEntityRefs, asString, type SgEntityRef, type SgRecord } from './shotgridMapper';
import { findByLocal, mapLocalToSg, mapSgToLocal, upsertLink } from './shotgridLinks';
import { can } from './shotgridSettings';
import { touch, type PullContext } from './ShotgridPullService';
import type { ShotgridWriter } from './ShotgridWriter';

/**
 * ShotGrid playlists <-> dailies playlists.
 *
 * A playlist prepares a review session: it is put together in the tool where one works, and must be playable in the one where one projects. Order matters as
 * much as content: a session follows a sequence of events, not a set.
 */

const PLAYLIST_FIELDS = ['code', 'description', 'versions', 'created_at', 'updated_at', 'project'];

export interface PlaylistPullOptions {
  /** Specific playlists to re-read (processing an event). */
  onlySgIds?: number[];
}

/**
 * Imports the playlists of the project.
 *
 * Only versions already known to ReView come in: a ShotGrid playlist may cite versions that the status filter discarded at import, and inventing them here would
 * create entries leading nowhere. ShotGrid's order is kept.
 */
export async function pullPlaylists(ctx: PullContext, options: PlaylistPullOptions = {}): Promise<void> {
  if (!can(ctx.settings, 'playlists', 'read')) return;

  // Cumulative restriction: the project filter stays in place even when re-reading only a playlist designated by an event, and each record is rechecked.
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
     * Find the local playlist, in this order: the link, then the name.
     *
     * The fallback on the name ALSO applies when the link exists: it may designate a playlist since deleted, and a blind creation would then hit the
     * `(projectId, name)` constraint: the whole synchronization stopped for a playlist erased by hand months earlier.
     */
    const link = playlistLinks.get(record.id);
    const linked = link ? await prisma.playlist.findUnique({ where: { id: link.localId } }) : null;
    const byName = await prisma.playlist.findUnique({
      where: { projectId_name: { projectId: ctx.connection.projectId, name } },
    });
    const existing = linked ?? byName;

    /*
     * Rename on the ShotGrid side to a name already held by ANOTHER local playlist: we keep the current name rather than fail the batch. Merging two
     * sessions or overwriting one is not a decision a synchronization takes on its own; the conflict is visible in the journal and is settled by hand.
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

    // The content is replaced, not completed: a version removed on the ShotGrid side must disappear from the session, and running twice must duplicate nothing.
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

/** Fields re-read on the remote playlist before writing to it. */
const PLAYLIST_PUSH_FIELDS = ['id', 'code', 'project', 'versions'];

export interface PlaylistPushContext {
  connectionId: number;
  sgProjectId: number;
  /**
   * Name of the linked project, when the caller has it at hand. It does not enter the membership decision (`belongsToProject` only rules on the identifier),
   * and only serves to complete the scope shared with the rest of the file.
   */
  sgProjectName?: string | null;
  /** Read-only: the remote playlist is re-read before its versions are merged. */
  client: {
    findById: (entity: string, id: number, fields: string[]) => Promise<SgRecord | null>;
  };
  /** Every write goes through here: segregation and template project included. */
  writer: Pick<ShotgridWriter, 'create' | 'update'>;
  asUserLogin: string | null;
}

type SgRef = { type: string; id: number };

/**
 * Merges a playlist's content: what ReView is entitled to say, and nothing more.
 *
 * The `versions` field of a ShotGrid playlist is not modified by addition or removal: our client writes it as a block (PUT), so it must be re-read, merged,
 * then rewritten whole. Writing only ReView's view erased everything the studio had set directly on the site: an irreversible loss. The invariant:
 *
 * - a remote version that ReView **does not know** (no match for this connection, hence no version of this project) is **preserved as is**, at its place in the
 *   order: this is also what protects an entity of another project, never moved or removed by a decision taken here;
 * - a version **added** on the ReView side is added;
 * - a version **removed** on the ReView side is removed remotely only if ReView knew it; otherwise we do not touch it.
 *
 * The order: the slots occupied by known versions are recomposed in the order of the ReView session (a playlist is a sequence of events, reordering must
 * come from there), unknown versions keep their position, and the local surplus is added at the end. An unknown version therefore cannot be duplicated by the
 * local side: ReView only cites versions it knows.
 *
 * The read and the write do not form an atomic operation — the API offers nothing of the sort. A remote modification slipped between the two would be lost;
 * that is precisely why we only remove what ReView legitimately owns.
 */
export function mergePlaylistVersions(params: {
  remote: readonly SgEntityRef[];
  local: readonly number[];
  known: ReadonlySet<number>;
}): SgRef[] {
  const { remote, local, known } = params;
  const pending = [...local];
  const merged: SgRef[] = [];

  for (const entry of remote) {
    // Unknown to ReView (or of a type other than Version): untouchable, at its place.
    if (entry.type !== 'Version' || !known.has(entry.id)) {
      merged.push({ type: entry.type, id: entry.id });
      continue;
    }
    // A slot governed by ReView: it receives the session's next version, or disappears if the session has no more of them (removal done in ReView).
    const next = pending.shift();
    if (next !== undefined) merged.push({ type: 'Version', id: next });
  }

  for (const id of pending) merged.push({ type: 'Version', id });
  return merged;
}

/** Do two lists of references describe the same content, in the same order? */
function sameRefs(a: readonly SgRef[], b: readonly SgRef[]): boolean {
  return a.length === b.length && a.every((ref, i) => ref.type === b[i]!.type && ref.id === b[i]!.id);
}

/**
 * Sends a playlist to ShotGrid.
 *
 * An already linked playlist is updated rather than recreated: otherwise every change would leave one more session in the studio's list. Unlinked versions are
 * ignored: they do not exist there.
 */
export async function pushPlaylist(ctx: PlaylistPushContext, playlistId: number): Promise<number | null> {
  const playlist = await prisma.playlist.findUnique({
    where: { id: playlistId },
    include: { items: { orderBy: { order: 'asc' }, select: { versionId: true } } },
  });
  if (!playlist) return null;

  /*
   * A single read of the correspondence table serves two needs: translating the session's versions, and knowing which ones ReView knows. The links are carried by
   * the connection, itself attached to a single project: this set therefore contains only versions of the linked project, which makes it the right boundary for
   * deciding what ReView is entitled to remove over there.
   */
  const versionLinks = await mapLocalToSg(ctx.connectionId, 'version');
  const known = new Set<number>();
  for (const link of versionLinks.values()) {
    if (link.sgType === 'Version') known.add(link.sgId);
  }

  const localSgIds: number[] = [];
  for (const item of playlist.items) {
    const link = versionLinks.get(item.versionId);
    if (link?.sgType === 'Version' && !localSgIds.includes(link.sgId)) localSgIds.push(link.sgId);
  }

  const existing = await findByLocal(ctx.connectionId, 'playlist', playlist.id);
  if (existing) {
    return updateRemotePlaylist(
      ctx,
      { id: playlist.id, name: playlist.name },
      existing.sgId,
      localSgIds,
      known,
    );
  }

  // No `project` here: `ShotgridWriter` sets it and re-reads what the site wrote.
  const created = await ctx.writer.create('Playlist', {
    code: playlist.name,
    versions: localSgIds.map((id) => ({ type: 'Version', id })),
  });
  await upsertLink({
    connectionId: ctx.connectionId,
    localType: 'playlist',
    localId: playlist.id,
    sgType: 'Playlist',
    sgId: created.id,
    data: { createdFromReview: true },
  });
  logger.info({ playlistId, sgId: created.id }, 'Playlist created in ShotGrid');
  return created.id;
}

/**
 * Updates an existing playlist: re-read, merge, write only if necessary.
 *
 * The three pre-write checks of the file are redone here, since sending a playlist does not go through `resolveTarget`: does the target still exist, does it
 * indeed belong to the linked project (an identifier may have been reassigned), and is it not in a template project. Each one gives up instead of throwing: a
 * refused write is logged, it does not interrupt the queue.
 */
async function updateRemotePlaylist(
  ctx: PlaylistPushContext,
  playlist: { id: number; name: string },
  sgId: number,
  localSgIds: readonly number[],
  known: ReadonlySet<number>,
): Promise<number | null> {
  const remote = await ctx.client.findById('Playlist', sgId, PLAYLIST_PUSH_FIELDS);
  if (!remote) {
    // The link survives the playlist it designates. Recreating it would put back into the studio a session someone deleted: we stop and say so.
    logger.warn({ playlistId: playlist.id, sgId }, 'ShotGrid playlist not found — write abandoned');
    return null;
  }

  // Segregation and the refusal of template projects are no longer copied here: it is `ShotgridWriter` that applies them, just before writing, for all the
  // file's writes. Two copies of one rule end up diverging: this one was one of them.
  const remoteRefs = asEntityRefs(remote.versions);
  const merged = mergePlaylistVersions({ remote: remoteRefs, local: localSgIds, known });
  const preserved = merged.filter((ref) => ref.type !== 'Version' || !known.has(ref.id)).length;

  // Nothing new to say: not writing avoids a round trip of events with the site, and a modification trace in the studio's history for an empty pass.
  if (asString(remote.code) === playlist.name && sameRefs(remoteRefs, merged)) {
    logger.info({ playlistId: playlist.id, sgId }, 'ShotGrid playlist already up to date — no write');
    return sgId;
  }

  await ctx.writer.update(
    'Playlist',
    sgId,
    { code: playlist.name, versions: merged },
    { asUserLogin: ctx.asUserLogin },
  );
  logger.info(
    { playlistId: playlist.id, sgId, versions: merged.length, preserved },
    'Playlist updated in ShotGrid',
  );
  return sgId;
}
