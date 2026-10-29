// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { openConnection, markStatus, type ConnectionContext } from './ShotgridConfigService';
import { ShotgridApiError } from './ShotgridClient';
import { SyncJournal, type SyncKind } from './ShotgridSyncJournal';
import {
  buildUserMap,
  pullAssets,
  pullSequences,
  pullShots,
  pullTasks,
  type PullContext,
  type PullOptions,
} from './ShotgridPullService';
import { pullEpisodes, pullSequenceEpisodes } from './ShotgridEpisodes';
import { findBySg } from './shotgridLinks';
import { pullVersions, pullPublishedFiles } from './ShotgridVersionSync';
import { pullNotes } from './ShotgridNoteSync';
import { pullPlaylists } from './ShotgridPlaylistSync';
import { fetchSiteStatuses, syncPipelineStatuses, syncVersionStatuses } from './ShotgridStatusSync';
import { can, parseSettings } from './shotgridSettings';
import { belongsToProject, projectFilter } from './shotgridProjectGuard';
import { asString } from './shotgridMapper';
import { mergePasses, resolvePasses, sgIdsOfType, type SyncPass } from './ShotgridSyncPasses';
import { flushTouched, TouchedEntities } from './ShotgridTouched';

/**
 * Orchestration of ShotGrid synchronizations.
 *
 * Three entry points for a single processing path: the full synchronization (on demand), the reconciliation (time window, catches what an outage made it miss),
 * and the targeted processing of an event. All three go through the same import, which avoids having a "fast" path less safe than the other.
 */

export interface SyncOptions {
  kind?: SyncKind;
  since?: Date | null;
  triggeredById?: number | null;
  onlySgIds?: { sgType: string; sgId: number }[];
  /** Media import (costly) — can be disabled for a structure-only pass. */
  withMedia?: boolean;
  /**
   * Passes to run. When absent, the list is deduced from the targeted entities, otherwise everything runs. This is what lets a Note event re-read only the notes —
   * and be re-read at all.
   */
  passes?: SyncPass[];
}

export interface SyncResult {
  runId: number;
  /**
   * `deferred`: the request was not executed right away, it is waiting behind the synchronization in progress. It is not lost — which is precisely what the former
   * `ok` let one believe.
   */
  status: 'ok' | 'partial' | 'error' | 'deferred';
  stats: Record<string, unknown>;
}

/** Only one synchronization at a time per connection: two concurrent passes would trample each other. */
const running = new Set<number>();

/**
 * The same lock, but set per project and BEFORE the connection is opened.
 *
 * `running` is indexed by connection, and the connection identifier is only known after an `await`: it is this window that let a whole burst through. This second lock
 * closes it; the per-connection one stays, covering the case of two projects sharing one connection.
 */
const runningProjects = new Set<number>();
const pendingProjects = new Map<number, SyncOptions>();

/**
 * Requests that arrived while a synchronization was running (D-ShotGrid).
 *
 * They used to be **dropped**: `runSync` returned `{ status: 'ok', skipped: 'already_running' }` before even opening a journal. Each webhook becoming a distinct job and the
 * worker running two at a time, ten simultaneous status changes on the site lost roughly half of them — without error, without trace, and without BullMQ replaying anything.
 * That is exactly "some of the statuses do not come back up".
 *
 * They are therefore merged and replayed at the end of the current pass. The merge is conservative: two targeted requests add up, and as soon as one request concerns the whole
 * project, the replayed pass concerns the whole project.
 */
const pending = new Map<number, SyncOptions>();

/** Merges two requests into one, never narrowing the scope. */
export function mergeSyncOptions(a: SyncOptions, b: SyncOptions): SyncOptions {
  // A request without `onlySgIds` sweeps everything: it absorbs the targeted requests.
  const targeted = a.onlySgIds && b.onlySgIds ? [...a.onlySgIds, ...b.onlySgIds] : undefined;
  const unique = targeted
    ? targeted.filter((t, i) => targeted.findIndex((o) => o.sgType === t.sgType && o.sgId === t.sgId) === i)
    : undefined;
  return {
    kind: a.kind === 'full' || b.kind === 'full' ? 'full' : (b.kind ?? a.kind),
    // The widest window wins: over-catching is harmless, under-catching loses data.
    since: a.since && b.since ? new Date(Math.min(a.since.getTime(), b.since.getTime())) : null,
    triggeredById: b.triggeredById ?? a.triggeredById,
    onlySgIds: unique,
    withMedia: a.withMedia || b.withMedia,
    // Same rule as for entities: the union, and a request without a list (hence "everything") absorbs the other. Merging a Note and a Version event must re-read both.
    passes: mergePasses(a.passes, b.passes),
  };
}

/**
 * Versions to re-read among those an event designates.
 *
 * Passing the identifiers to `pullVersions` makes the studio's status filter fall away — it is treated there as the sign of a manual selection. That would fetch the media of
 * all the WIPs of a site where the studio has precisely chosen to follow only the versions in review. The filter is therefore replayed here, and we take the opportunity to
 * recheck the project: an identifier received by webhook proves nothing.
 *
 * A version already linked always passes: the filter decides what we import, not what we keep following.
 */
export async function importableVersionIds(
  ctx: PullContext,
  onlySgIds: readonly { sgType: string; sgId: number }[],
): Promise<number[]> {
  const statusFilter = ctx.settings.media.statusFilter;
  const kept: number[] = [];
  for (const sgId of sgIdsOfType(onlySgIds, 'Version')) {
    if (await findBySg(ctx.connection.id, 'Version', sgId)) {
      kept.push(sgId);
      continue;
    }
    const record = await ctx.client.findById('Version', sgId, ['id', 'sg_status_list', 'project']);
    if (!record) continue;

    const verdict = belongsToProject(record, ctx.scope);
    if (!verdict.ok) {
      ctx.journal.count('guard', 'skipped');
      await ctx.journal.log(
        'error',
        'shotgrid.log.wrongProject',
        {
          sgType: 'Version',
          sgId,
          expected: ctx.scope.sgProjectId,
          found: verdict.foundProjectId ?? null,
        },
        { sgType: 'Version', sgId },
      );
      continue;
    }

    const statusCode = asString(record.sg_status_list);
    if (statusFilter.length > 0 && statusCode && !statusFilter.includes(statusCode)) {
      ctx.journal.count('versions', 'skipped');
      continue;
    }
    kept.push(sgId);
  }
  return kept;
}

export async function runSync(projectId: number, options: SyncOptions = {}): Promise<SyncResult> {
  const kind = options.kind ?? 'full';

  /*
   * Lock taken BEFORE any wait.
   *
   * `openConnection` is asynchronous: when it preceded the `running.has` test, a burst of ShotGrid events entered the function in full, waited for the connection, and
   * found the lock still free — each then set it in turn. The studio's journal showed it unambiguously: fifteen synchronizations in eleven seconds, each updating the same 47 entities.
   *
   * The per-project lock suffices here: a connection serves only one project, and two projects of the same site may synchronize in parallel without getting in each other's way.
   */
  if (runningProjects.has(projectId)) {
    const existing = pendingProjects.get(projectId);
    pendingProjects.set(projectId, existing ? mergeSyncOptions(existing, options) : options);
    return { runId: 0, status: 'deferred', stats: { deferred: 'already_running' } };
  }
  runningProjects.add(projectId);

  let ctx: ConnectionContext;
  try {
    ctx = await openConnection(projectId);
  } catch (err) {
    runningProjects.delete(projectId);
    logger.warn({ projectId, err }, 'Connexion ShotGrid indisponible');
    throw err;
  }

  if (!ctx.connection.active) {
    runningProjects.delete(projectId);
    return { runId: 0, status: 'ok', stats: { skipped: 'connection_inactive' } };
  }
  if (running.has(ctx.connection.id)) {
    runningProjects.delete(projectId);
    // The request waits its turn instead of being dropped. The status says so: the HTTP caller must not display "synchronized" for work that did not take place.
    const existing = pending.get(ctx.connection.id);
    pending.set(ctx.connection.id, existing ? mergeSyncOptions(existing, options) : options);
    return { runId: 0, status: 'deferred', stats: { deferred: 'already_running' } };
  }
  running.add(ctx.connection.id);

  const journal = await SyncJournal.start(ctx.connection.id, kind, options.triggeredById);
  await markStatus(ctx.connection.id, 'syncing', null);
  const startedAt = new Date();

  // An event must only touch what it designates: the collector retains the realigned entities, and the decision to emit is taken at the end of the pass.
  const touched = new TouchedEntities();
  const pullCtx: PullContext = {
    ...ctx,
    journal,
    scope: { sgProjectId: ctx.connection.sgProjectId, sgProjectName: ctx.connection.sgProjectName },
    touched,
  };
  const pullOptions: PullOptions = { since: options.since ?? null, onlySgIds: options.onlySgIds };
  const passes = resolvePasses(options);
  const wants = (pass: SyncPass): boolean => passes.has(pass);
  // Targeted request: a pass none of whose identifiers is cited has nothing to do — letting it go without a filter means replaying the whole project for one entity.
  const targeted = (options.onlySgIds?.length ?? 0) > 0;

  try {
    await journal.log('info', 'shotgrid.log.runStarted', {
      kind,
      project: ctx.connection.sgProjectName,
      sgProjectId: ctx.connection.sgProjectId,
    });

    // 1. Status references — everything else refers to them.
    let taskStatuses = new Map<string, import('@prisma/client').PipelineStatus>();
    let shotStatuses = new Map<string, import('@prisma/client').PipelineStatus>();
    let sequenceStatuses = new Map<string, import('@prisma/client').PipelineStatus>();
    let assetStatuses = new Map<string, import('@prisma/client').PipelineStatus>();
    // A pass that reads no `sg_status_list` (notes, playlists, versions) does without the reference: neither remote read nor database fallback.
    const readStatuses = wants('statuses');
    if (readStatuses && can(ctx.settings, 'statuses', 'read')) {
      const siteStatuses = await fetchSiteStatuses(ctx.client);
      taskStatuses = await syncPipelineStatuses(ctx.client, 'task', siteStatuses, journal);
      shotStatuses = await syncPipelineStatuses(ctx.client, 'shot', siteStatuses, journal);
      sequenceStatuses = await syncPipelineStatuses(ctx.client, 'sequence', siteStatuses, journal);
      // The asset has its own list on the site side: it borrowed the tasks' one, so it displayed states no asset can carry.
      assetStatuses = await syncPipelineStatuses(ctx.client, 'asset', siteStatuses, journal);
      const versionMap = await syncVersionStatuses(
        ctx.client,
        siteStatuses,
        ctx.settings.versionStatusMap,
        journal,
      );
      if (JSON.stringify(versionMap) !== JSON.stringify(ctx.settings.versionStatusMap)) {
        // The settings are re-read just before writing, and only the concerned field is replaced. Starting again from the copy taken at the start of the synchronization
        // cancelled everything a human had set while it was running — without a trace, and without anything warning of it.
        await prisma.$transaction(async (tx) => {
          const fresh = await tx.shotgridConnection.findUnique({
            where: { id: ctx.connection.id },
            select: { settings: true },
          });
          await tx.shotgridConnection.update({
            where: { id: ctx.connection.id },
            data: {
              settings: { ...((fresh?.settings as object) ?? {}), versionStatusMap: versionMap } as never,
            },
          });
        });
        ctx.settings.versionStatusMap = versionMap;
        pullCtx.settings.versionStatusMap = versionMap;
      }
    } else if (readStatuses) {
      // Reference read closed: we fall back on the statuses ALREADY imported from the site (`projectId: null`, `origin: 'shotgrid'`). Without these two filters, the
      // fallback also picked up the studio's local vocabulary and that of other projects: a common code such as "ip" was enough to stick a neighbour's status onto a shot.
      const importedFromSite = { projectId: null, origin: 'shotgrid' } as const;
      const [t, s, q, a] = await Promise.all([
        prisma.pipelineStatus.findMany({ where: { ...importedFromSite, scope: 'task' } }),
        prisma.pipelineStatus.findMany({ where: { ...importedFromSite, scope: 'shot' } }),
        prisma.pipelineStatus.findMany({ where: { ...importedFromSite, scope: 'sequence' } }),
        prisma.pipelineStatus.findMany({ where: { ...importedFromSite, scope: 'asset' } }),
      ]);
      taskStatuses = new Map(t.map((x) => [x.code, x]));
      shotStatuses = new Map(s.map((x) => [x.code, x]));
      sequenceStatuses = new Map(q.map((x) => [x.code, x]));
      assetStatuses = new Map(a.map((x) => [x.code, x]));
    }

    // 2. Accounts (matching by e-mail, no creation).
    const userMap = wants('users') ? await buildUserMap(pullCtx) : new Map<number, number>();

    // 3. Hierarchy, in dependency order. Episodes come first: the attachment of sequences reads their match. On a project where the level is off — the default case — the
    // two calls return control without asking the site for anything.
    if (wants('episodes')) await pullEpisodes(pullCtx, sequenceStatuses, pullOptions);
    if (wants('sequences')) await pullSequences(pullCtx, sequenceStatuses, pullOptions);
    if (wants('episodes')) await pullSequenceEpisodes(pullCtx, pullOptions);
    if (wants('shots')) await pullShots(pullCtx, shotStatuses, pullOptions);
    if (wants('assets')) await pullAssets(pullCtx, assetStatuses, pullOptions);
    if (wants('tasks')) await pullTasks(pullCtx, taskStatuses, userMap, pullOptions);

    // 4. Versions. A targeted request finally passes its identifiers: without them, a single Version event re-read every version of the project.
    if (wants('versions')) {
      const versionIds = targeted ? await importableVersionIds(pullCtx, options.onlySgIds ?? []) : [];
      // Targeted with no version retained: nothing to re-read. Calling `pullVersions` with an empty list would restart the full sweep — the opposite of what we seek.
      if (!targeted || versionIds.length > 0) {
        await pullVersions(pullCtx, {
          since: options.since ?? null,
          ...(targeted ? { onlySgIds: versionIds } : {}),
        });
      }
    }
    // `PublishedFile` has no targeted read: it is a sweep of five thousand records.
    // It only belongs in a non-targeted pass.
    if (wants('publishedFiles') && !targeted) await pullPublishedFiles(pullCtx);

    // 5. Notes and playlists: after the versions, on which both depend.
    const noteIds = sgIdsOfType(options.onlySgIds, 'Note');
    if (wants('notes') && (!targeted || noteIds.length > 0)) {
      await pullNotes(pullCtx, targeted ? { onlySgIds: noteIds } : {});
    }
    const playlistIds = sgIdsOfType(options.onlySgIds, 'Playlist');
    if (wants('playlists') && (!targeted || playlistIds.length > 0)) {
      await pullPlaylists(pullCtx, targeted ? { onlySgIds: playlistIds } : {});
    }

    await journal.finish('ok');
    await prisma.shotgridConnection.update({
      where: { id: ctx.connection.id },
      data: { lastSyncAt: startedAt, status: 'ok', statusMessage: null },
    });
    flushTouched(projectId, journal.runId, 'ok', touched);
    const run = await prisma.shotgridSyncRun.findUnique({ where: { id: journal.runId } });
    return {
      runId: journal.runId,
      status: (run?.status as SyncResult['status']) ?? 'ok',
      stats: (run?.stats as Record<string, unknown>) ?? {},
    };
  } catch (err) {
    await journal.fail(err);
    const message = err instanceof Error ? err.message : String(err);
    await markStatus(
      ctx.connection.id,
      err instanceof ShotgridApiError && err.isAuth ? 'auth_error' : 'error',
      message,
    );
    // An interrupted pass still realigned part of the project: the summary goes out anyway, otherwise the screens would stay on the previous state.
    flushTouched(projectId, journal.runId, 'error', touched);
    return { runId: journal.runId, status: 'error', stats: { error: message } };
  } finally {
    running.delete(ctx.connection.id);
    runningProjects.delete(projectId);
    const deferredProject = pendingProjects.get(projectId);
    if (deferredProject) {
      pendingProjects.delete(projectId);
      void runSync(projectId, deferredProject).catch((err: unknown) => {
        logger.warn({ projectId, err }, 'Deferred sync failed');
      });
    }
    // Replays what arrived during the pass. Without `await`: the current caller has finished its work, and the catch-up must neither lengthen its response
    // nor make its job fail if it fails in turn.
    const deferred = pending.get(ctx.connection.id);
    if (deferred) {
      pending.delete(ctx.connection.id);
      void runSync(projectId, deferred).catch((err: unknown) => {
        logger.warn({ projectId, err }, 'Deferred sync failed');
      });
    }
  }
}

/**
 * Catch-up after an outage.
 *
 * ReView may have been stopped, isolated from the network, or missed webhooks (ShotGrid gives up on a delivery endpoint after a hundred failures and keeps the trace of it
 * for seven days only). Reconciliation re-reads everything that has moved over a wide window — three days by default, adjustable — and realigns without asking anyone.
 * ShotGrid is authoritative: it is the production registry, ReView is its mirror.
 */
export async function runReconcile(projectId: number, options: { lookbackHours?: number } = {}) {
  const conn = await prisma.shotgridConnection.findUnique({ where: { projectId } });
  if (!conn) return null;
  const settings = parseSettings(conn.settings);
  const hours = options.lookbackHours ?? settings.reconcile.lookbackHours;
  // We restart from the last successful synchronization, never from "now": if the instance stayed stopped for a week, the window must cover that week.
  const from = conn.lastSyncAt ?? new Date(Date.now() - hours * 3600_000);
  const since = new Date(Math.min(from.getTime(), Date.now() - hours * 3600_000));
  return runSync(projectId, { kind: 'reconcile', since });
}

/** Active connections — used by the periodic tasks and the catch-up at startup. */
export async function listActiveConnections() {
  return prisma.shotgridConnection.findMany({
    where: { active: true },
    include: { site: true, project: { select: { id: true, name: true, deletedAt: true } } },
  });
}

/**
 * Remote inventory, writing nothing — the basis of the comparison page.
 * Counted per entity so as to spot at a glance what is missing on one side or the other.
 */
export async function remoteCounts(ctx: ConnectionContext): Promise<Record<string, number>> {
  const filters = [projectFilter(ctx.connection.sgProjectId)];
  const entities = ['Sequence', 'Shot', 'Asset', 'Task', 'Version'];
  const out: Record<string, number> = {};
  for (const entity of entities) {
    const records = await ctx.client.search(entity, { fields: ['id'], filters, maxRecords: 10000 });
    out[entity] = records.length;
  }
  return out;
}

/** Name of the remote project, for displaying the connection status. */
export async function remoteProjectName(ctx: ConnectionContext): Promise<string | null> {
  const remote = await ctx.client.findById('Project', ctx.connection.sgProjectId, ['name']);
  return asString(remote?.name);
}
