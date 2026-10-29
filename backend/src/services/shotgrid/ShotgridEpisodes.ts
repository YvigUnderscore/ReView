// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PipelineStatus, ShotgridLink } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type { ConnectionContext } from './ShotgridConfigService';
import type { SyncJournal } from './ShotgridSyncJournal';
import { belongsToProject, projectFilter, type ProjectScope } from './shotgridProjectGuard';
import { asDate, asEntityRef, asString, type SgRecord } from './shotgridMapper';
import { can, parseSettings, sgCreateLink } from './shotgridSettings';
import { mapSgToLocal, upsertLink } from './shotgridLinks';
import { localTarget, statusPatch } from './ShotgridPullService';

/**
 * The ShotGrid Episode entity.
 *
 * ShotGrid knows an `Episode` level above `Sequence` (field `sg_episode` on the sequence). ReView has just acquired it: this module does the matching.
 *
 * **The connector's safety invariants apply without exception**: a site hosts all the studio's projects, so every request carries the project filter
 * (`projectFilter`) AND every entity received is rechecked (`belongsToProject`). Writing into the wrong project cannot be undone: the belt (the filter)
 * can be forgotten in one call, the braces (the check) are the last line of defence.
 *
 * The import only runs if the level is enabled on the ReView project: bringing episodes back into a project that shows none would create invisible rows
 * that nobody could see or correct.
 *
 * Matching goes through `ShotgridLink` with `localType = 'episode'`, set by the shared helpers of `shotgridLinks.ts` as for all other entities.
 */

const LOCAL_TYPE = 'episode';
const SG_TYPE = 'Episode';

/** Fields read from the remote entity: never `*`, we only fetch what we write. */
export const EPISODE_FIELDS = ['code', 'description', 'sg_status_list', 'project', 'updated_at'];

/** ShotGrid Sequence field that carries its episode. */
export const SG_SEQUENCE_EPISODE_FIELD = 'sg_episode';

/**
 * Fields read from the remote Sequence for the attachment alone.
 *
 * `sg_episode` is requested ONLY by this pass, and this pass only runs on a project where the level is enabled: a site that does not know the field,
 * a studio without a series, is never queried on it, and the ordinary import of sequences stays exactly what it was.
 */
const SEQUENCE_EPISODE_FIELDS = ['project', 'updated_at', SG_SEQUENCE_EPISODE_FIELD];

/** Is the Episode level enabled on ReView's side for the linked project? */
async function episodesEnabled(projectId: number): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { episodesEnabled: true },
  });
  return project?.episodesEnabled ?? false;
}

// ───────────────────────────── Creation lock ─────────────────────────────

/** Error carrying the remote creation link: the client turns it into a button. */
export class ShotgridEpisodeLockedError extends AppError {
  constructor(
    message: string,
    readonly sgCreateUrl: string,
    readonly sgProjectName: string,
  ) {
    super(message, 409, 'SHOTGRID_LOCKED', { sgCreateUrl, sgProjectName });
    this.name = 'ShotgridEpisodeLockedError';
  }
}

/**
 * Refuses the local creation of an episode when the project is driven from ShotGrid.
 *
 * Same rule as for a sequence or a shot, but with the right remote form: `CreatableKind` in `ShotgridGuardService` does not yet know "episode",
 * and borrowing its "sequence" entry would send the studio to the wrong screen.
 */
export async function assertEpisodeCreationAllowed(projectId: number): Promise<void> {
  const conn = await prisma.shotgridConnection.findUnique({
    where: { projectId },
    include: { site: true },
  });
  if (!conn?.active) return;
  if (!parseSettings(conn.settings).lockLocalCreation) return;
  throw new ShotgridEpisodeLockedError(
    `This project is driven from ShotGrid ("${conn.sgProjectName}") — create the episode there, it will come back on the next synchronisation`,
    sgCreateLink(conn.site.baseUrl, SG_TYPE, conn.sgProjectId),
    conn.sgProjectName,
  );
}

// ───────────────────────────── Correspondance ─────────────────────────────

/**
 * Local code of a ShotGrid episode. The site leaves `code` empty more often than one thinks; the fallback is stable and unique, so it can be replayed without creating a duplicate.
 */
export function episodeCode(record: SgRecord): string {
  return asString(record.code) ?? `EP${record.id}`;
}

// ───────────────────────────── Import ─────────────────────────────

/** What the import needs: structural subset of the `pullSequences` context. */
export interface EpisodePullContext extends ConnectionContext {
  journal: SyncJournal;
  scope: ProjectScope;
}

export interface EpisodePullOptions {
  since?: Date | null;
  onlySgIds?: { sgType: string; sgId: number }[];
}

/**
 * Discards any entity that does not belong to the linked project.
 *
 * This check should never catch anything since the request is filtered: that is precisely why it is there.
 */
async function keepInProject(records: SgRecord[], ctx: EpisodePullContext): Promise<SgRecord[]> {
  const kept: SgRecord[] = [];
  for (const record of records) {
    const verdict = belongsToProject(record, ctx.scope);
    if (verdict.ok) {
      kept.push(record);
      continue;
    }
    ctx.journal.count('guard', 'skipped');
    await ctx.journal.log(
      'error',
      'shotgrid.log.wrongProject',
      {
        sgType: record.type,
        sgId: record.id,
        expected: ctx.scope.sgProjectId,
        found: verdict.foundProjectId ?? null,
      },
      { sgType: record.type, sgId: record.id },
    );
    logger.error(
      { sgType: record.type, sgId: record.id, expected: ctx.scope.sgProjectId },
      'Entité ShotGrid hors du projet lié — écartée',
    );
  }
  return kept;
}

async function fetchEpisodes(ctx: EpisodePullContext, options: EpisodePullOptions): Promise<SgRecord[]> {
  if (options.onlySgIds?.length) {
    const ids = options.onlySgIds.filter((r) => r.sgType === SG_TYPE).map((r) => r.sgId);
    if (ids.length === 0) return [];
    const records: SgRecord[] = [];
    for (const id of ids) {
      const rec = await ctx.client.findById(SG_TYPE, id, EPISODE_FIELDS);
      if (rec) records.push(rec);
    }
    return keepInProject(records, ctx);
  }
  const filters: Array<[string, string, unknown]> = [projectFilter(ctx.scope.sgProjectId)];
  if (options.since) filters.push(['updated_at', 'greater_than', options.since.toISOString()]);
  const records = await ctx.client.search(SG_TYPE, { fields: EPISODE_FIELDS, filters, sort: 'id' });
  return keepInProject(records, ctx);
}

/**
 * Imports the episodes of the linked project.
 *
 * Two locks before any write: the `hierarchy` domain must be open for reading, and the Episode level must be enabled on the ReView side. Without the second,
 * the synchronization would create rows that no screen shows.
 */
export async function pullEpisodes(
  ctx: EpisodePullContext,
  statuses: Map<string, PipelineStatus> = new Map(),
  options: EpisodePullOptions = {},
): Promise<void> {
  if (!can(ctx.settings, 'hierarchy', 'read')) return;
  const projectId = ctx.connection.projectId;
  if (!(await episodesEnabled(projectId))) return;

  const records = await fetchEpisodes(ctx, options);
  // `order` is deduced from the rank within the batch: it only makes sense in a full pass, otherwise a targeted re-read
  // would bring the episode to the top of the list for everyone.
  const fullPass = !options.since && !options.onlySgIds;
  const links = await mapSgToLocal(ctx.connection.id, LOCAL_TYPE);

  for (const [index, record] of records.entries()) {
    const code = episodeCode(record);
    const { patch } = statusPatch(asString(record.sg_status_list), statuses);
    const link = links.get(record.id);
    const { existing, name: localCode } = await localTarget({
      connectionId: ctx.connection.id,
      localType: LOCAL_TYPE,
      sgId: record.id,
      sgName: code,
      linkedId: link?.localId ?? null,
      findById: (id) => prisma.episode.findUnique({ where: { id } }),
      findByName: (c) => prisma.episode.findUnique({ where: { projectId_code: { projectId, code: c } } }),
    });

    const data = {
      name: localCode,
      code: localCode,
      ...(fullPass ? { order: index } : {}),
      projectId,
      ...patch,
      deletedAt: null,
    };
    const saved = existing
      ? await prisma.episode.update({ where: { id: existing.id }, data })
      : await prisma.episode.create({ data });

    await upsertLink({
      connectionId: ctx.connection.id,
      localType: LOCAL_TYPE,
      localId: saved.id,
      sgType: SG_TYPE,
      sgId: record.id,
      sgUpdatedAt: asDate(record.updated_at),
    });
    ctx.journal.count('episodes', existing ? 'updated' : 'created');
  }
}

/**
 * Attaches the already imported sequences to their episode.
 *
 * To be called AFTER `pullEpisodes` and the import of sequences: the attachment reads the match on both sides. A sequence whose remote episode is not linked
 * (it was not imported, or belongs to another project) is left detached rather than attached at random.
 */
export async function linkSequencesToEpisodes(
  ctx: EpisodePullContext,
  sequenceRecords: SgRecord[],
  sequenceLinks: Map<number, ShotgridLink>,
): Promise<number> {
  const episodeLinks = await mapSgToLocal(ctx.connection.id, LOCAL_TYPE);
  let updated = 0;
  for (const record of sequenceRecords) {
    const localSequenceId = sequenceLinks.get(record.id)?.localId;
    if (localSequenceId === undefined) continue;
    const ref = asEntityRef(record[SG_SEQUENCE_EPISODE_FIELD]);
    const episodeId = ref ? (episodeLinks.get(ref.id)?.localId ?? null) : null;
    // The sequence must belong to the linked project: the map of links comes from the connection, but the write is by local identifier, so we bound it.
    const { count } = await prisma.sequence.updateMany({
      where: { id: localSequenceId, projectId: ctx.connection.projectId },
      data: { episodeId },
    });
    updated += count;
  }
  return updated;
}

/**
 * The full attachment pass: re-reads the remote sequences for the sole `sg_episode` field, then attaches them.
 *
 * It is separated from `pullSequences` on purpose. The ordinary import of sequences does not request `sg_episode`: a site without a series does not necessarily
 * have that field, and claiming it would make the synchronization fail for everyone, for a level nobody has enabled. Here, the request only goes out if the project has switched the level on.
 */
export async function pullSequenceEpisodes(
  ctx: EpisodePullContext,
  options: EpisodePullOptions = {},
): Promise<number> {
  if (!can(ctx.settings, 'hierarchy', 'read')) return 0;
  if (!(await episodesEnabled(ctx.connection.projectId))) return 0;

  const filters: Array<[string, string, unknown]> = [projectFilter(ctx.scope.sgProjectId)];
  if (options.since) filters.push(['updated_at', 'greater_than', options.since.toISOString()]);
  const fetched = await ctx.client.search('Sequence', {
    fields: SEQUENCE_EPISODE_FIELDS,
    filters,
    sort: 'id',
  });
  // Same belt and braces as for episodes: the request carries the project filter, and each entity received is rechecked before any write.
  const records = await keepInProject(fetched, ctx);
  const sequenceLinks = await mapSgToLocal(ctx.connection.id, 'sequence');
  return linkSequencesToEpisodes(ctx, records, sequenceLinks);
}
