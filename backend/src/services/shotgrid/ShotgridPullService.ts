// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PipelineStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import type { ConnectionContext } from './ShotgridConfigService';
import { belongsToProject, projectFilter, type ProjectScope } from './shotgridProjectGuard';
import {
  asDate,
  asEntityRef,
  asEntityRefs,
  asNumber,
  asString,
  cutDuration,
  disambiguatedName,
  sgAssetType,
  sgDisplayName,
  sgStepToTaskType,
  type SgRecord,
} from './shotgridMapper';
import {
  findByLocal,
  findBySg,
  mapSgToLocal,
  removeLink,
  upsertLink,
  type LocalType,
  type AssetLinkData,
  type SequenceLinkData,
  type ShotLinkData,
  type TaskLinkData,
} from './shotgridLinks';
import { syncThumbnail } from './ShotgridThumbnails';
import { sgIdsOfType } from './ShotgridSyncPasses';
import type { SyncJournal } from './ShotgridSyncJournal';
import { can } from './shotgridSettings';
import { enqueuePush } from './ShotgridPushService';
import { emitToProject } from '../SocketService';
import { isReplayable, TOUCHED_EVENT_NAME, type TouchedEntities, type TouchedKind } from './ShotgridTouched';
import { resolveForTask, type TaskDepartment } from '../DepartmentService';
import { ignoreFailure } from '../../lib/ignoreFailure';

/**
 * Import of the production hierarchy from ShotGrid.
 *
 * Every request carries the project filter AND every entity received is rechecked: ShotGrid hosts all the studio's projects on the same site, and a forgotten
 * filter is not visible: it simply imports the neighbour's project over ours.
 *
 * The import is idempotent: re-synchronizing an unchanged project produces no write. This is what makes periodic reconciliation safe.
 */

/**
 * `image` is the thumbnail chosen on the site: requested everywhere ReView can carry one (sequence, shot, asset). See `ShotgridThumbnails`: the value is a
 * short-lived signed URL, so it is copied and never pointed to.
 */
const SEQUENCE_FIELDS = ['code', 'description', 'sg_status_list', 'image', 'project', 'updated_at'];
const SHOT_FIELDS = [
  'code',
  'description',
  'sg_sequence',
  'sg_cut_in',
  'sg_cut_out',
  'sg_cut_duration',
  'sg_status_list',
  'image',
  'project',
  'updated_at',
];
const ASSET_FIELDS = [
  'code',
  'description',
  'sg_asset_type',
  'sg_status_list',
  'image',
  // Asset-side links held in ShotGrid: this is where the "which assets for this shot" lists come from, and reading them avoids re-entering them here.
  'shots',
  'sequences',
  'project',
  'updated_at',
];
const TASK_FIELDS = [
  'content',
  'step',
  'entity',
  'sg_status_list',
  'start_date',
  'due_date',
  'duration',
  'task_assignees',
  'project',
  'updated_at',
];

export interface PullOptions {
  /** Only take over what has changed since this date (reconciliation, incremental). */
  since?: Date | null;
  /** Restrict to a few remote entities (processing an event). */
  onlySgIds?: { sgType: string; sgId: number }[];
}

interface PullContext extends ConnectionContext {
  journal: SyncJournal;
  scope: ProjectScope;
  /**
   * Accumulator of the realigned entities. When absent, each entity emits its event at once: this is the expected behaviour of callers that orchestrate only an
   * isolated pass (manual import of versions).
   */
  touched?: TouchedEntities;
}

/**
 * Signals that an entity has just been realigned.
 *
 * With a collector, the entity is retained and the decision to emit is taken at the end of the pass (see `ShotgridTouched`). Without a collector, we emit as before:
 * an isolated caller has nobody to empty the accumulator behind it. Families without a closing event on the client side (notes, playlists) count for nothing then:
 * they never emitted anything anyway.
 */
export function touch(
  ctx: PullContext,
  kind: TouchedKind,
  id: number,
  extra?: Record<string, unknown>,
): void {
  if (ctx.touched) {
    ctx.touched.add(kind, id, extra);
    return;
  }
  if (!isReplayable(kind)) return;
  emitToProject(ctx.connection.projectId, TOUCHED_EVENT_NAME[kind], {
    projectId: ctx.connection.projectId,
    id,
    ...extra,
  });
}

/**
 * What the site no longer returns is put in the trash — on a complete pass **as** on a targeted pass.
 *
 * This corrects a complete silence: a `Shotgun_Shot_Retirement` event was accepted, queued, executed, and did nothing. The pass it triggers is targeted, the trashing
 * was reserved to the complete pass, and the targeted read of a retired entity obviously returns nothing. The journal recorded an "ok" run with empty statistics, and the
 * deletion made in ShotGrid only reached ReView at the next complete sweep, triggered by hand.
 *
 * The three cases are not equal, and that is the whole point of this function:
 *  - **complete**: the batch received is authoritative, what is missing from it has been removed;
 *  - **targeted**: only the identifiers requested conclude: the site has just named these entities, their absence from the response is an answer;
 *  - **incremental** (`since`): an entity absent from the batch has simply not changed. Deducing a removal from it would empty the project at every nightly catch-up.
 */
async function trashMissing(
  ctx: PullContext,
  sgType: 'Shot' | 'Sequence' | 'Asset' | 'Task',
  records: SgRecord[],
  options: PullOptions,
): Promise<void> {
  const alive = new Set(records.map((r) => r.id));
  if (!options.since && !options.onlySgIds) {
    await trashRemoved(ctx, sgType, alive);
    return;
  }
  const requested = sgIdsOfType(options.onlySgIds, sgType);
  if (requested.length === 0) return;
  const gone = await confirmGone(ctx, sgType, requested, alive);
  if (gone.length > 0) await trashRemoved(ctx, sgType, alive, gone);
}

/**
 * Among the targeted identifiers absent from the read, those the site really no longer knows.
 *
 * The absence has two causes, and only one is a removal: the entity has disappeared from the site, or it still exists but `keepInProject` discarded it — it now
 * belongs to another project. Putting the second in the trash under the message "removed in ShotGrid" would say something false, and would act precisely where the
 * project guard, everywhere else in this file, refuses to act.
 *
 * One re-read per identifier settles it. It costs a single call, and only for an identifier already missing — that is, on a removal event, not on current traffic.
 */
export async function confirmGone(
  ctx: PullContext,
  sgType: string,
  requested: readonly number[],
  alive: ReadonlySet<number>,
): Promise<number[]> {
  const gone: number[] = [];
  for (const sgId of requested) {
    if (alive.has(sgId)) continue;
    if (await ctx.client.findById(sgType, sgId, ['id'])) continue;
    gone.push(sgId);
  }
  return gone;
}

/** Filters of a search: project required, plus the time window if any. */
function buildFilters(scope: ProjectScope, since?: Date | null): Array<[string, string, unknown]> {
  const filters: Array<[string, string, unknown]> = [projectFilter(scope.sgProjectId)];
  if (since) filters.push(['updated_at', 'greater_than', since.toISOString()]);
  return filters;
}

/**
 * Discards any entity that does not belong to the linked project.
 *
 * This check should never catch anything since the queries are filtered — that is precisely why it is there: the day a filter fails, we refuse the entity
 * instead of overwriting another project's work, and we say so loudly.
 */
async function keepInProject(records: SgRecord[], ctx: PullContext): Promise<SgRecord[]> {
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
      {
        sgType: record.type,
        sgId: record.id,
        expected: ctx.scope.sgProjectId,
        found: verdict.foundProjectId,
      },
      'Entité ShotGrid hors du projet lié — écartée',
    );
  }
  return kept;
}

/** Read of a batch of entities, filtered and verified. */
async function fetchScoped(
  ctx: PullContext,
  entity: string,
  fields: string[],
  options: PullOptions,
): Promise<SgRecord[]> {
  if (options.onlySgIds?.length) {
    const ids = options.onlySgIds.filter((r) => r.sgType === entity).map((r) => r.sgId);
    if (ids.length === 0) return [];
    const records: SgRecord[] = [];
    for (const id of ids) {
      const rec = await ctx.client.findById(entity, id, fields);
      if (rec) records.push(rec);
    }
    return keepInProject(records, ctx);
  }
  const records = await ctx.client.search(entity, {
    fields,
    filters: buildFilters(ctx.scope, options.since),
    sort: 'id',
  });
  return keepInProject(records, ctx);
}

/**
 * Can a local entity found by its name host this ShotGrid entity?
 *
 * No if it is already the counterpart of another one: a site easily hosts four sequences named "DO_NOT_USE_", and merging them onto the same local row would import
 * only one — the other three would be missing at every comparison, with nothing saying why. The name therefore serves to adopt what existed before the link, never to
 * conflate two distinct entities of the site.
 */
async function adoptable(
  connectionId: number,
  localType: LocalType,
  localId: number,
  sgId: number,
): Promise<boolean> {
  const held = await findByLocal(connectionId, localType, localId);
  return !held || held.sgId === sgId;
}

/**
 * Where to write this entity of the site, and under what name.
 *
 * Three questions in order: does it already have a local counterpart (the link)? If not, can it adopt an entity of the same name created before the link? And above all:
 * is the site's name free at the moment of writing?
 *
 * This last question also applies to updates, not only to creation. Asking it too late costs a unique-constraint violation: an already disambiguated entity would be
 * renamed to the site's name at the next pass — a name its twin still carries.
 *
 * Database accesses are injected: this resolution is a rule, and it is tested as such.
 */
export async function localTarget<T extends { id: number }>(params: {
  connectionId: number;
  localType: LocalType;
  sgId: number;
  /** Name carried by the entity on the ShotGrid side. */
  sgName: string;
  linkedId: number | null;
  findById: (id: number) => Promise<T | null>;
  findByName: (name: string) => Promise<T | null>;
}): Promise<{ existing: T | null; name: string }> {
  const { connectionId, localType, sgId, sgName, linkedId } = params;
  let existing = linkedId !== null ? await params.findById(linkedId) : null;

  if (!existing) {
    const sameName = await params.findByName(sgName);
    if (sameName && (await adoptable(connectionId, localType, sameName.id, sgId))) existing = sameName;
    else if (sameName) existing = await params.findByName(disambiguatedName(sgName, sgId));
  }

  // The site's name if it is free or already ours; otherwise ours, suffixed.
  const holder = await params.findByName(sgName);
  const name = !holder || holder.id === existing?.id ? sgName : disambiguatedName(sgName, sgId);
  return { existing, name };
}

/**
 * Is there really a conflict? Two conditions, and both are needed.
 *
 * The ReView side must have moved since the last synchronization, **and** the two values must really diverge. The second was missing: any local change declared a
 * conflict, even when both sides already carried the same value. The studio's journal was full of it — "review: ip, shotgrid: ip" — and one could no longer tell
 * real disagreements from noise.
 *
 * Worse: `updatedAt` moves for any modification of the task (checklist, assignee, dates). Ticking a box therefore declared a **status** conflict.
 */
export function isRealConflict(params: {
  localUpdatedAt: Date | null | undefined;
  linkSyncedAt: Date | null | undefined;
  reviewValue?: string | null;
  remoteValue?: string | null;
}): boolean {
  const { localUpdatedAt, linkSyncedAt } = params;
  if (!localUpdatedAt || !linkSyncedAt) return false;
  // One second of tolerance: the local write and the link's timestamp are never simultaneous to the millisecond.
  if (localUpdatedAt.getTime() <= linkSyncedAt.getTime() + 1000) return false;
  // Known and identical values: the site and ReView say the same thing, there is nothing to arbitrate. Unknown values (a caller that supplies none): we stick
  // to the date, as before.
  if (params.reviewValue !== undefined && params.remoteValue !== undefined) {
    return (params.reviewValue ?? null) !== (params.remoteValue ?? null);
  }
  return true;
}

/**
 * Arbitration verdict. `overwrite`: the site's value comes down. `keep`: ReView keeps its own and sends it back to the site. `defer`: nobody moves, a human will decide.
 */
export type ConflictVerdict = 'overwrite' | 'keep' | 'defer';

/** Translates the studio setting into a verdict. Pure: this is the rule, without the effects. */
export function arbitrate(policy: string | undefined): ConflictVerdict {
  if (policy === 'review_wins') return 'keep';
  if (policy === 'manual') return 'defer';
  return 'overwrite';
}

/**
 * Removes from `data` the field that arbitration left to ReView.
 *
 * We remove the field, not the write: the name, dates and link are not in conflict and must keep coming down from the site.
 */
function withoutStatus<T extends Record<string, unknown>>(data: T, verdict: ConflictVerdict): T {
  if (verdict === 'overwrite') return data;
  const { pipelineStatusId: _p, status: _s, ...rest } = data;
  return rest as unknown as T;
}

/**
 * Arbitrates a conflict and logs it.
 *
 * The "When both sides have changed" setting offered three policies and applied none: `conflictPolicy` was only read as a variable of a message, and the caller
 * wrote the site's value no matter what. A studio on `review_wins` therefore saw its decisions overwritten exactly as with `sg_wins`, with in addition a journal line
 * claiming the opposite.
 *
 * Returns the verdict; it is up to the caller to remove the disputed field from its `data` (and only that one: the other fields are not in conflict and must come down).
 */
async function arbitrateConflict(
  ctx: PullContext,
  params: {
    localUpdatedAt: Date | null | undefined;
    linkSyncedAt: Date | null | undefined;
    localType: string;
    localId: number;
    sgType: string;
    sgId: number;
    name: string;
    /**
     * Field concerned and the values at stake: what the arbiter must see.
     * `field` is a stable identifier (`status`...), not a label: it is the reader who decides the language, not the server that wrote the row.
     */
    field?: string;
    reviewValue?: string | null;
    remoteValue?: string | null;
  },
): Promise<ConflictVerdict> {
  const { localUpdatedAt } = params;
  if (!isRealConflict(params)) return 'overwrite';
  const verdict = arbitrate(ctx.settings.conflictPolicy);
  ctx.journal.count('conflicts', 'updated');
  // One key per outcome: the message is written after arbitration, not before. The former text announced an overwrite by interpolating the policy: it could
  // therefore say "review_wins" at the very moment it was overwriting.
  const key =
    verdict === 'keep'
      ? 'shotgrid.log.conflictKept'
      : verdict === 'defer'
        ? 'shotgrid.log.conflictPending'
        : 'shotgrid.log.conflictOverwritten';
  await ctx.journal.conflict(
    key,
    {
      name: params.name,
      policy: ctx.settings.conflictPolicy,
      // Without these markers, the conflict row does not say what diverged or when: impossible to arbitrate knowingly.
      ...(params.field ? { field: params.field } : {}),
      review: params.reviewValue ?? '—',
      shotgrid: params.remoteValue ?? '—',
      // `isRealConflict` has already discarded the case without a date: it is necessarily there.
      localAt: localUpdatedAt?.toISOString() ?? '—',
    },
    {
      sgType: params.sgType,
      sgId: params.sgId,
      localType: params.localType,
      localId: params.localId,
    },
  );
  return verdict;
}

/**
 * Translates a `sg_status_list` into a Prisma write — three situations, three answers.
 *
 * The original code confused them, in two opposite ways: sequence and shot wrote `null` as soon as the status map did not recognize the code (status **silently erased**),
 * while the task omitted the field even when the site had emptied the status (erasure **never propagated**). The map is empty in ordinary cases — `statuses.read` closed,
 * the site's schema inaccessible, code removed from the `valid_values` — so a routine pass was enough to empty the statuses of a whole project without a single journal line.
 *
 * - code absent/empty -> `{ pipelineStatusId: null }`: the site emptied it, we propagate.
 * - known code        -> we write the status.
 * - unknown code      -> **nothing**: we keep the local value, and say so in the journal.
 */
/**
 * The description received from the site, when it is the authoritative one.
 *
 * It had been requested in `SEQUENCE_FIELDS` and `SHOT_FIELDS` forever, then thrown away: only the asset wrote it. A shot imported from ShotGrid therefore arrived without
 * its brief, and production re-entered it by hand in ReView — only to see it diverge at once.
 *
 * When the studio has chosen that ReView is authoritative (`descriptions.source = 'review'`), we write nothing: copying would overwrite what a supervisor has just written there.
 *
 * The site's emptiness is translated to `null` rather than to an empty string: that is what the column holds when nobody has written anything, and the two must not coexist.
 */
export function descriptionPatch(ctx: PullContext, raw: unknown): { description?: string | null } {
  if (ctx.settings.descriptions.source !== 'shotgrid') return {};
  const value = asString(raw);
  return { description: value && value.trim() ? value : null };
}

export function statusPatch(
  statusCode: string | null | undefined,
  statuses: Map<string, PipelineStatus>,
): { patch: { pipelineStatusId?: number | null }; unknownCode: string | null } {
  if (!statusCode) return { patch: { pipelineStatusId: null }, unknownCode: null };
  const status = statuses.get(statusCode);
  if (status) return { patch: { pipelineStatusId: status.id }, unknownCode: null };
  return { patch: {}, unknownCode: statusCode };
}

/**
 * Reports an unknown status code — only once per (scope, code) and per pass.
 * A complete pass over three thousand shots would otherwise write three thousand identical lines and drown the journal.
 */
const reportedUnknownStatus = new WeakMap<SyncJournal, Set<string>>();

export async function noteUnknownStatus(
  ctx: PullContext,
  scope: string,
  code: string | null,
  name: string,
): Promise<void> {
  if (!code) return;
  let seen = reportedUnknownStatus.get(ctx.journal);
  if (!seen) {
    seen = new Set();
    reportedUnknownStatus.set(ctx.journal, seen);
  }
  const key = `${scope}:${code}`;
  if (seen.has(key)) return;
  seen.add(key);
  await ctx.journal.log('warn', 'shotgrid.log.unknownStatusCode', { code, scope, name });
}

// ───────────────────────────── Sequences ─────────────────────────────

export async function pullSequences(
  ctx: PullContext,
  statuses: Map<string, PipelineStatus> = new Map(),
  options: PullOptions = {},
) {
  if (!can(ctx.settings, 'hierarchy', 'read')) return;
  const records = await fetchScoped(ctx, 'Sequence', SEQUENCE_FIELDS, options);
  /**
   * `order` is deduced from the rank within the batch received. It only makes sense if the batch is the whole project: on a targeted re-read (a status webhook) the batch
   * is one element, and the entity restarted at `order: 0` — the status change of a shot brought the sequence to the top of the list for everyone.
   */
  const fullPass = !options.since && !options.onlySgIds;
  // What the site no longer returns has been put in the trash there — see `trashMissing`.
  await trashMissing(ctx, 'Sequence', records, options);
  const links = await mapSgToLocal(ctx.connection.id, 'sequence');

  for (const [index, record] of records.entries()) {
    const code = asString(record.code) ?? `SQ${record.id}`;
    const statusCode = asString(record.sg_status_list);
    const seqStatus = statusPatch(statusCode, statuses);
    await noteUnknownStatus(ctx, 'sequence', seqStatus.unknownCode, code);
    const link = links.get(record.id);
    const { existing, name: localCode } = await localTarget({
      connectionId: ctx.connection.id,
      localType: 'sequence',
      sgId: record.id,
      sgName: code,
      linkedId: link?.localId ?? null,
      findById: (id) => prisma.sequence.findUnique({ where: { id } }),
      findByName: (c) =>
        prisma.sequence.findUnique({
          where: { projectId_code: { projectId: ctx.connection.projectId, code: c } },
        }),
    });

    const data = {
      name: localCode,
      code: localCode,
      ...(fullPass ? { order: index } : {}),
      projectId: ctx.connection.projectId,
      ...descriptionPatch(ctx, record.description),
      ...seqStatus.patch,
      deletedAt: null,
    };

    let saved: { id: number; thumbnailKey: string | null };
    if (existing) {
      const localStatus = existing.pipelineStatusId
        ? ((await prisma.pipelineStatus.findUnique({ where: { id: existing.pipelineStatusId } }))?.code ??
          null)
        : null;
      // The sequence was not arbitrated at all: it was overwritten without detection or trace, whatever the studio's policy.
      const verdict = await arbitrateConflict(ctx, {
        localUpdatedAt: existing.updatedAt,
        linkSyncedAt: link?.syncedAt,
        localType: 'sequence',
        localId: existing.id,
        sgType: 'Sequence',
        sgId: record.id,
        name: localCode,
        field: 'status',
        reviewValue: localStatus,
        remoteValue: statusCode,
      });
      if (verdict === 'keep') {
        await enqueuePush(ctx.connection.projectId, {
          type: 'sequence-status',
          sequenceId: existing.id,
        });
      }
      saved = await prisma.sequence.update({
        where: { id: existing.id },
        data: withoutStatus(data, verdict),
      });
    } else {
      saved = await prisma.sequence.create({ data });
    }
    /**
     * The thumbnail is aligned BEFORE the signal: `touch` is the only notification of the loop, and emitting it first let the screen refresh on the card still
     * empty, with nothing behind it to announce the image.
     */
    const sgThumbSrc = await syncThumbnail(ctx, {
      holder: 'sequence',
      localId: saved.id,
      sgType: 'Sequence',
      sgId: record.id,
      name: localCode,
      image: record.image,
      previous: (link?.data as SequenceLinkData | undefined)?.sgThumbSrc,
      currentKey: saved.thumbnailKey,
    });
    // Without this signal, a status read from the site never reaches an open screen: one had to reload the page to see it appear.
    touch(ctx, 'sequence', saved.id);

    await upsertLink({
      connectionId: ctx.connection.id,
      localType: 'sequence',
      localId: saved.id,
      sgType: 'Sequence',
      sgId: record.id,
      sgUpdatedAt: asDate(record.updated_at),
      data: { sgThumbSrc } satisfies SequenceLinkData,
    });
    ctx.journal.count('sequences', existing ? 'updated' : 'created');
  }
}

// ───────────────────────────── Shots ─────────────────────────────

export async function pullShots(
  ctx: PullContext,
  statuses: Map<string, PipelineStatus>,
  options: PullOptions = {},
) {
  if (!can(ctx.settings, 'hierarchy', 'read')) return;
  const records = await fetchScoped(ctx, 'Shot', SHOT_FIELDS, options);
  // Same reason as for sequences: `order` only makes sense in a complete pass.
  const fullPass = !options.since && !options.onlySgIds;
  await trashMissing(ctx, 'Shot', records, options);
  const sequenceLinks = await mapSgToLocal(ctx.connection.id, 'sequence');
  const shotLinks = await mapSgToLocal(ctx.connection.id, 'shot');

  for (const [index, record] of records.entries()) {
    const code = asString(record.code) ?? `SH${record.id}`;
    const sequenceRef = asEntityRef(record.sg_sequence);
    const sequenceId = sequenceRef ? (sequenceLinks.get(sequenceRef.id)?.localId ?? null) : null;
    const statusCode = asString(record.sg_status_list);
    const shotStatus = statusPatch(statusCode, statuses);
    await noteUnknownStatus(ctx, 'shot', shotStatus.unknownCode, code);
    const cutIn = asNumber(record.sg_cut_in);
    const cutOut = asNumber(record.sg_cut_out);

    const link = shotLinks.get(record.id);
    const existing = link ? await prisma.shot.findUnique({ where: { id: link.localId } }) : null;

    const data = {
      projectId: ctx.connection.projectId,
      sequenceId,
      name: code,
      code,
      startFrame: cutIn,
      endFrame: cutOut,
      ...(fullPass ? { order: index } : {}),
      ...descriptionPatch(ctx, record.description),
      ...shotStatus.patch,
      deletedAt: null,
    };

    let saved: { id: number; thumbnailKey: string | null };
    if (existing) {
      const localStatus = existing.pipelineStatusId
        ? ((await prisma.pipelineStatus.findUnique({ where: { id: existing.pipelineStatusId } }))?.code ??
          null)
        : null;
      const verdict = await arbitrateConflict(ctx, {
        localUpdatedAt: existing.updatedAt,
        linkSyncedAt: link?.syncedAt,
        localType: 'shot',
        localId: existing.id,
        sgType: 'Shot',
        sgId: record.id,
        name: code,
        field: 'status',
        reviewValue: localStatus,
        remoteValue: statusCode,
      });
      if (verdict === 'keep') {
        await enqueuePush(ctx.connection.projectId, { type: 'shot-status', shotId: existing.id });
      }
      saved = await prisma.shot.update({
        where: { id: existing.id },
        data: withoutStatus(data, verdict),
      });
      ctx.journal.count('shots', 'updated');
    } else {
      saved = await prisma.shot.create({ data });
      ctx.journal.count('shots', 'created');
    }
    const savedId = saved.id;
    // Before `touch`, for the same reason as for sequences: a single signal goes out.
    const sgThumbSrc = await syncThumbnail(ctx, {
      holder: 'shot',
      localId: savedId,
      sgType: 'Shot',
      sgId: record.id,
      name: code,
      image: record.image,
      previous: (link?.data as ShotLinkData | undefined)?.sgThumbSrc,
      currentKey: saved.thumbnailKey,
    });
    touch(ctx, 'shot', savedId);

    const linkData: ShotLinkData = {
      sgStatusCode: statusCode,
      cutDuration: asNumber(record.sg_cut_duration) ?? cutDuration(cutIn, cutOut),
      sgThumbSrc,
    };
    await upsertLink({
      connectionId: ctx.connection.id,
      localType: 'shot',
      localId: savedId,
      sgType: 'Shot',
      sgId: record.id,
      sgUpdatedAt: asDate(record.updated_at),
      data: linkData,
    });
  }
}

// ───────────────────────────── Assets ─────────────────────────────

export async function pullAssets(
  ctx: PullContext,
  statuses: Map<string, PipelineStatus> = new Map(),
  options: PullOptions = {},
) {
  if (!can(ctx.settings, 'hierarchy', 'read')) return;
  const records = await fetchScoped(ctx, 'Asset', ASSET_FIELDS, options);
  await trashMissing(ctx, 'Asset', records, options);
  const assetLinks = await mapSgToLocal(ctx.connection.id, 'asset');
  // The shots and sequences were imported just before: their matches exist, so we can attach without creating anything along the way.
  const shotLinks = await mapSgToLocal(ctx.connection.id, 'shot');
  const sequenceLinks = await mapSgToLocal(ctx.connection.id, 'sequence');

  for (const record of records) {
    const name = asString(record.code) ?? `Asset ${record.id}`;
    const link = assetLinks.get(record.id);
    const { existing, name: localName } = await localTarget({
      connectionId: ctx.connection.id,
      localType: 'asset',
      sgId: record.id,
      sgName: name,
      linkedId: link?.localId ?? null,
      findById: (id) => prisma.asset.findUnique({ where: { id } }),
      findByName: (n) =>
        prisma.asset.findUnique({
          where: { projectId_name: { projectId: ctx.connection.projectId, name: n } },
        }),
    });

    const sgType = asString(record.sg_asset_type);
    const statusCode = asString(record.sg_status_list);
    const assetStatus = statusPatch(statusCode, statuses);
    await noteUnknownStatus(ctx, 'asset', assetStatus.unknownCode, localName);
    const data = {
      projectId: ctx.connection.projectId,
      name: localName,
      // The enumeration serves the filters; the studio's exact label is what is displayed.
      type: sgAssetType(sgType),
      typeLabel: sgType,
      ...descriptionPatch(ctx, record.description),
      ...assetStatus.patch,
      deletedAt: null,
    };
    const saved = existing
      ? await prisma.asset.update({ where: { id: existing.id }, data })
      : await prisma.asset.create({ data });

    // Attachments: `set` replaces the whole list rather than adding — this is what prevents duplicates when a synchronization runs again. Only entities already
    // linked are cited: a shot unknown to ReView has nothing to attach.
    const shotIds = asEntityRefs(record.shots)
      .map((r) => shotLinks.get(r.id)?.localId)
      .filter((id): id is number => typeof id === 'number');
    const sequenceIds = asEntityRefs(record.sequences)
      .map((r) => sequenceLinks.get(r.id)?.localId)
      .filter((id): id is number => typeof id === 'number');
    await prisma.asset.update({
      where: { id: saved.id },
      data: {
        shots: { set: shotIds.map((id) => ({ id })) },
        sequences: { set: sequenceIds.map((id) => ({ id })) },
      },
    });

    const sgThumbSrc = await syncThumbnail(ctx, {
      holder: 'asset',
      localId: saved.id,
      sgType: 'Asset',
      sgId: record.id,
      name: localName,
      image: record.image,
      previous: (link?.data as AssetLinkData | undefined)?.sgThumbSrc,
      currentKey: saved.thumbnailKey,
    });
    const linkData: AssetLinkData = {
      sgAssetType: asString(record.sg_asset_type),
      sgStatusCode: asString(record.sg_status_list),
      sgThumbSrc,
    };
    await upsertLink({
      connectionId: ctx.connection.id,
      localType: 'asset',
      localId: saved.id,
      sgType: 'Asset',
      sgId: record.id,
      sgUpdatedAt: asDate(record.updated_at),
      data: linkData,
    });
    // The asset emitted nothing: an asset created or renamed from the site did not reach an open screen, although the client knows how to handle `asset:update`.
    touch(ctx, 'asset', saved.id);
    ctx.journal.count('assets', existing ? 'updated' : 'created');
  }
}

// ───────────────────────────── Tasks ─────────────────────────────

/**
 * Matching of accounts by e-mail address.
 *
 * No account is created: a ShotGrid artist without a ReView account stays displayed by their name (kept in the link), but the task is assigned to nobody. Inventing
 * accounts from a synchronization would open access nobody has validated.
 */
export async function buildUserMap(ctx: PullContext): Promise<Map<number, number>> {
  if (!can(ctx.settings, 'users', 'read')) return new Map();
  const sgUsers = await ctx.client.search('HumanUser', {
    fields: ['login', 'name', 'email', 'sg_status_list'],
    maxRecords: 2000,
  });
  const emails = sgUsers.map((u) => asString(u.email)).filter((e): e is string => Boolean(e));
  const locals = emails.length
    ? await prisma.user.findMany({
        where: { email: { in: emails, mode: 'insensitive' } },
        select: { id: true, email: true },
      })
    : [];
  const byEmail = new Map(locals.map((u) => [u.email.toLocaleLowerCase(), u.id]));

  const out = new Map<number, number>();
  for (const sgUser of sgUsers) {
    const email = asString(sgUser.email)?.toLocaleLowerCase();
    const localId = email ? byEmail.get(email) : undefined;
    if (localId) {
      out.set(sgUser.id, localId);
      await upsertLink({
        connectionId: ctx.connection.id,
        localType: 'user',
        localId,
        sgType: 'HumanUser',
        sgId: sgUser.id,
        data: { login: asString(sgUser.login), name: asString(sgUser.name), email },
      });
      ctx.journal.count('users', 'updated');
    } else {
      ctx.journal.count('users', 'skipped');
    }
  }
  return out;
}

/**
 * Memoized resolution of steps into departments, for the duration of a pass.
 *
 * A project counts thousands of tasks for about ten steps: without memory, the synchronization would make as many database round trips as there are tasks, to
 * find each time the same ten rows.
 */
export function departmentResolver(
  projectId: number,
): (stepName: string | null | undefined) => Promise<TaskDepartment> {
  const seen = new Map<string, TaskDepartment>();
  return async (stepName) => {
    const key = stepName?.trim();
    if (!key) return { department: null, departmentId: null };
    const cached = seen.get(key.toLowerCase());
    if (cached) return cached;
    const resolved = await resolveForTask(projectId, key);
    seen.set(key.toLowerCase(), resolved);
    return resolved;
  };
}

export async function pullTasks(
  ctx: PullContext,
  statuses: Map<string, PipelineStatus>,
  userMap: Map<number, number>,
  options: PullOptions = {},
) {
  if (!can(ctx.settings, 'tasks', 'read')) return;
  const records = await fetchScoped(ctx, 'Task', TASK_FIELDS, options);
  // A task the site no longer returns has been put in the trash there.
  await trashMissing(ctx, 'Task', records, options);
  const shotLinks = await mapSgToLocal(ctx.connection.id, 'shot');
  const assetLinks = await mapSgToLocal(ctx.connection.id, 'asset');
  const taskLinks = await mapSgToLocal(ctx.connection.id, 'task');
  const departmentOf = departmentResolver(ctx.connection.projectId);

  for (const record of records) {
    const name = asString(record.content) ?? sgDisplayName(record);
    const entityRef = asEntityRef(record.entity);
    const shotId = entityRef?.type === 'Shot' ? (shotLinks.get(entityRef.id)?.localId ?? null) : null;
    const assetId = entityRef?.type === 'Asset' ? (assetLinks.get(entityRef.id)?.localId ?? null) : null;

    if (!shotId && !assetId) {
      ctx.journal.count('tasks', 'skipped');
      await ctx.journal.log(
        'warn',
        'shotgrid.log.taskWithoutParent',
        { name, entity: entityRef?.type ?? 'aucune' },
        { sgType: 'Task', sgId: record.id },
      );
      continue;
    }

    const stepRef = asEntityRef(record.step);
    const stepName = stepRef?.name ?? asString(record.step);
    const statusCode = asString(record.sg_status_list);
    const status = statusCode ? statuses.get(statusCode) : undefined;
    const taskStatus = statusPatch(statusCode, statuses);
    await noteUnknownStatus(ctx, 'task', taskStatus.unknownCode, name);
    const assignees = asEntityRefs(record.task_assignees);
    const assigneeId =
      assignees.map((a) => userMap.get(a.id)).find((id): id is number => Boolean(id)) ?? null;

    const link = taskLinks.get(record.id);
    const existing = link ? await prisma.task.findUnique({ where: { id: link.localId } }) : null;

    // The site's step becomes a local department, relation included: writing only the string left `departmentId` empty on ALL the tasks of a project driven
    // from ShotGrid, and the assignment by department — which queries the relation — refused tasks that do exist.
    const department = await departmentOf(stepName);

    const data = {
      name,
      type: sgStepToTaskType(stepName),
      ...department,
      shotId,
      assetId: shotId ? null : assetId,
      assigneeId,
      startDate: asDate(record.start_date),
      dueDate: asDate(record.due_date),
      ...taskStatus.patch,
      // The historical enum follows the pipeline status for as long as it exists (`legacyStatus`).
      ...(status?.legacyStatus ? { status: status.legacyStatus } : {}),
    };

    let savedId: number;
    if (existing) {
      const localStatus = existing.pipelineStatusId
        ? ((await prisma.pipelineStatus.findUnique({ where: { id: existing.pipelineStatusId } }))?.code ??
          null)
        : null;
      const verdict = await arbitrateConflict(ctx, {
        localUpdatedAt: existing.updatedAt,
        linkSyncedAt: link?.syncedAt,
        localType: 'task',
        localId: existing.id,
        sgType: 'Task',
        sgId: record.id,
        name,
        field: 'status',
        reviewValue: localStatus,
        remoteValue: statusCode,
      });
      if (verdict === 'keep') {
        await enqueuePush(ctx.connection.projectId, { type: 'task-status', taskId: existing.id });
      }
      await prisma.task.update({ where: { id: existing.id }, data: withoutStatus(data, verdict) });
      savedId = existing.id;
      ctx.journal.count('tasks', 'updated');
    } else {
      const created = await prisma.task.create({ data });
      savedId = created.id;
      ctx.journal.count('tasks', 'created');
    }
    touch(ctx, 'task', savedId, { shotId: data.shotId ?? null, assetId: data.assetId ?? null });

    const linkData: TaskLinkData = {
      durationMinutes: asNumber(record.duration),
      stepName,
      sgStatusCode: statusCode,
      sgAssignees: assignees.map((a) => ({ id: a.id, name: a.name ?? `#${a.id}`, email: null })),
    };
    await upsertLink({
      connectionId: ctx.connection.id,
      localType: 'task',
      localId: savedId,
      sgType: 'Task',
      sgId: record.id,
      sgUpdatedAt: asDate(record.updated_at),
      data: linkData,
    });
  }
}

/**
 * Entities removed on the ShotGrid side: put in the trash, never deleted.
 * The associated work (comments, versions, history) stays viewable, and a removal made by mistake on the ShotGrid side is repaired without loss.
 *
 * `scope` bounds the identifiers examined, and that is what makes the function usable on a targeted pass. Without it, it could only run on a complete pass — the only
 * situation where "absent from the batch received" means "removed from the site". A removal event, for its part, names ONE entity: the absence of that identifier is safe
 * information, the absence of the others is not.
 */
export async function trashRemoved(
  ctx: PullContext,
  sgType: 'Shot' | 'Sequence' | 'Asset' | 'Task',
  aliveSgIds: Set<number>,
  scope?: readonly number[],
): Promise<void> {
  const localType = sgType.toLowerCase() as 'shot' | 'sequence' | 'asset' | 'task';
  const links = await mapSgToLocal(ctx.connection.id, localType);
  for (const sgId of scope ?? links.keys()) {
    const link = links.get(sgId);
    // Targeted identifier that was never imported: nothing to put in the trash.
    if (!link || aliveSgIds.has(sgId)) continue;

    const table =
      sgType === 'Shot'
        ? prisma.shot
        : sgType === 'Sequence'
          ? prisma.sequence
          : sgType === 'Asset'
            ? prisma.asset
            : prisma.task;
    const target = (await (table as { findUnique: (a: unknown) => Promise<unknown> }).findUnique({
      where: { id: link.localId },
    })) as { id: number } | null;

    // Target already gone: the link designates nothing any more. Keeping it would replay this removal — and its message — at every synchronization, indefinitely.
    if (!target) {
      await removeLink(ctx.connection.id, sgType, sgId);
      continue;
    }

    if (sgType === 'Task') {
      if (!(await retireTask(ctx, link.localId, sgId))) continue;
      // The task has gone for good: nothing left to attach.
      await removeLink(ctx.connection.id, sgType, sgId);
    } else {
      // The link survives the trashing: restoring on the ShotGrid side must bring back the entity as it was, with its history, not manufacture a copy.
      await (table as { update: (a: unknown) => Promise<unknown> })
        .update({ where: { id: link.localId }, data: { deletedAt: new Date() } })
        .catch(
          ignoreFailure('[shotgrid] trash of a remotely retired entity failed', {
            localType,
            localId: link.localId,
          }),
        );
    }
    ctx.journal.count(`${localType}s`, 'skipped');
    await ctx.journal.log(
      'info',
      'shotgrid.log.trashedRemotely',
      { sgType, sgId },
      { sgType, sgId, localType, localId: link.localId },
    );
  }
}

/**
 * Removal of a task put in the trash on the ShotGrid side.
 *
 * A task has no soft deletion: deleting it takes its versions with it in cascade, and so the review work attached to it. Only empty tasks are therefore removed;
 * a task carrying versions stays in place and the journal says so, leaving it to a human to decide what to do with this work become orphaned.
 *
 * Returns `true` if the task was actually removed.
 */
async function retireTask(ctx: PullContext, localId: number, sgId: number): Promise<boolean> {
  const versions = await prisma.version.count({ where: { taskId: localId } });
  if (versions > 0) {
    await ctx.journal.log(
      'warn',
      'shotgrid.log.trashedTaskKept',
      { sgId, count: versions },
      { sgType: 'Task', sgId, localType: 'task', localId },
    );
    return false;
  }
  await prisma.task
    .delete({ where: { id: localId } })
    .catch(ignoreFailure('[shotgrid] retired task delete failed', { taskId: localId }));
  return true;
}

export async function existsRemotely(ctx: PullContext, sgType: string, sgId: number): Promise<boolean> {
  const record = await ctx.client.findById(sgType, sgId, ['id', 'project']);
  if (!record) return false;
  return belongsToProject(record, ctx.scope).ok;
}

export { findBySg };
export type { PullContext };
