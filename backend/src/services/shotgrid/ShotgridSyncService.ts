// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { emitToProject } from '../SocketService';
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
import { pullVersions, pullPublishedFiles } from './ShotgridVersionSync';
import { pullNotes } from './ShotgridNoteSync';
import { pullPlaylists } from './ShotgridPlaylistSync';
import { fetchSiteStatuses, syncPipelineStatuses, syncVersionStatuses } from './ShotgridStatusSync';
import { can, parseSettings } from './shotgridSettings';
import { projectFilter } from './shotgridProjectGuard';
import { asString } from './shotgridMapper';

/**
 * Orchestration des synchronisations ShotGrid.
 *
 * Trois entrées pour un seul chemin de traitement : la synchronisation complète (à la
 * demande), la réconciliation (fenêtre temporelle, rattrape ce qu'une coupure a fait
 * manquer) et le traitement ciblé d'un événement. Les trois passent par le même
 * import, ce qui évite d'avoir un chemin « rapide » moins sûr que l'autre.
 */

export interface SyncOptions {
  kind?: SyncKind;
  since?: Date | null;
  triggeredById?: number | null;
  onlySgIds?: { sgType: string; sgId: number }[];
  /** Import des médias (coûteux) — désactivable pour une passe de structure seule. */
  withMedia?: boolean;
}

export interface SyncResult {
  runId: number;
  /**
   * `deferred` : la demande n'a pas été exécutée tout de suite, elle est en attente
   * derrière la synchronisation en cours. Elle n'est pas perdue — c'est justement ce
   * que l'ancien `ok` laissait croire.
   */
  status: 'ok' | 'partial' | 'error' | 'deferred';
  stats: Record<string, unknown>;
}

/** Une seule synchronisation à la fois par connexion : deux passes concurrentes se marcheraient dessus. */
const running = new Set<number>();

/**
 * Demandes arrivées pendant qu'une synchronisation tournait (D-ShotGrid).
 *
 * Elles étaient **jetées** : `runSync` rendait `{ status: 'ok', skipped: 'already_running' }`
 * avant même d'ouvrir un journal. Chaque webhook devenant un job distinct et le worker
 * tournant à deux, dix changements de statut simultanés sur le site en perdaient environ
 * la moitié — sans erreur, sans trace, et sans que BullMQ rejoue quoi que ce soit. C'est
 * très exactement « une partie des statuts ne remonte pas ».
 *
 * On les fusionne donc et on les rejoue à la fin de la passe en cours. La fusion est
 * conservatrice : deux demandes ciblées s'additionnent, et dès qu'une demande porte sur
 * tout le projet, la passe rejouée porte sur tout le projet.
 */
const pending = new Map<number, SyncOptions>();

/** Fusionne deux demandes en une seule, sans jamais rétrécir la portée. */
export function mergeSyncOptions(a: SyncOptions, b: SyncOptions): SyncOptions {
  // Une demande sans `onlySgIds` balaie tout : elle absorbe les demandes ciblées.
  const targeted = a.onlySgIds && b.onlySgIds ? [...a.onlySgIds, ...b.onlySgIds] : undefined;
  const unique = targeted
    ? targeted.filter((t, i) => targeted.findIndex((o) => o.sgType === t.sgType && o.sgId === t.sgId) === i)
    : undefined;
  return {
    kind: a.kind === 'full' || b.kind === 'full' ? 'full' : (b.kind ?? a.kind),
    // La fenêtre la plus large l'emporte : rattraper trop est sans danger, trop peu perd.
    since: a.since && b.since ? new Date(Math.min(a.since.getTime(), b.since.getTime())) : null,
    triggeredById: b.triggeredById ?? a.triggeredById,
    onlySgIds: unique,
    withMedia: a.withMedia || b.withMedia,
  };
}

export async function runSync(projectId: number, options: SyncOptions = {}): Promise<SyncResult> {
  const kind = options.kind ?? 'full';
  let ctx: ConnectionContext;
  try {
    ctx = await openConnection(projectId);
  } catch (err) {
    logger.warn({ projectId, err }, 'Connexion ShotGrid indisponible');
    throw err;
  }

  if (!ctx.connection.active) {
    return { runId: 0, status: 'ok', stats: { skipped: 'connection_inactive' } };
  }
  if (running.has(ctx.connection.id)) {
    // La demande attend son tour au lieu d'être jetée. Le statut le dit : l'appelant
    // HTTP ne doit pas afficher « synchronisé » pour un travail qui n'a pas eu lieu.
    const existing = pending.get(ctx.connection.id);
    pending.set(ctx.connection.id, existing ? mergeSyncOptions(existing, options) : options);
    return { runId: 0, status: 'deferred', stats: { deferred: 'already_running' } };
  }
  running.add(ctx.connection.id);

  const journal = await SyncJournal.start(ctx.connection.id, kind, options.triggeredById);
  await markStatus(ctx.connection.id, 'syncing', null);
  const startedAt = new Date();

  const pullCtx: PullContext = {
    ...ctx,
    journal,
    scope: { sgProjectId: ctx.connection.sgProjectId, sgProjectName: ctx.connection.sgProjectName },
  };
  const pullOptions: PullOptions = { since: options.since ?? null, onlySgIds: options.onlySgIds };

  try {
    await journal.log('info', 'shotgrid.log.runStarted', {
      kind,
      project: ctx.connection.sgProjectName,
      sgProjectId: ctx.connection.sgProjectId,
    });

    // 1. Référentiels de statuts — tout le reste s'y réfère.
    let taskStatuses = new Map<string, import('@prisma/client').PipelineStatus>();
    let shotStatuses = new Map<string, import('@prisma/client').PipelineStatus>();
    let sequenceStatuses = new Map<string, import('@prisma/client').PipelineStatus>();
    if (can(ctx.settings, 'statuses', 'read')) {
      const siteStatuses = await fetchSiteStatuses(ctx.client);
      taskStatuses = await syncPipelineStatuses(ctx.client, 'task', siteStatuses, journal);
      shotStatuses = await syncPipelineStatuses(ctx.client, 'shot', siteStatuses, journal);
      sequenceStatuses = await syncPipelineStatuses(ctx.client, 'sequence', siteStatuses, journal);
      const versionMap = await syncVersionStatuses(
        ctx.client,
        siteStatuses,
        ctx.settings.versionStatusMap,
        journal,
      );
      if (JSON.stringify(versionMap) !== JSON.stringify(ctx.settings.versionStatusMap)) {
        // Les réglages sont relus juste avant d'écrire, et seul le champ concerné est
        // remplacé. Repartir de la copie prise au début de la synchronisation annulait
        // tout ce qu'un humain avait réglé pendant qu'elle tournait — sans trace, et sans
        // que rien ne l'en avertisse.
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
    } else {
      // Lecture du référentiel fermée : on se rabat sur les statuts DÉJÀ importés du site
      // (`projectId: null`, `origin: 'shotgrid'`). Sans ces deux filtres, le repli
      // ramenait aussi le vocabulaire local du studio et celui des autres projets : un
      // code commun comme « ip » suffisait à coller à un plan le statut d'un voisin.
      const importedFromSite = { projectId: null, origin: 'shotgrid' } as const;
      const [t, s, q] = await Promise.all([
        prisma.pipelineStatus.findMany({ where: { ...importedFromSite, scope: 'task' } }),
        prisma.pipelineStatus.findMany({ where: { ...importedFromSite, scope: 'shot' } }),
        prisma.pipelineStatus.findMany({ where: { ...importedFromSite, scope: 'sequence' } }),
      ]);
      taskStatuses = new Map(t.map((x) => [x.code, x]));
      shotStatuses = new Map(s.map((x) => [x.code, x]));
      sequenceStatuses = new Map(q.map((x) => [x.code, x]));
    }

    // 2. Comptes (correspondance par courriel, aucune création).
    const userMap = await buildUserMap(pullCtx);

    // 3. Hiérarchie, dans l'ordre des dépendances.
    await pullSequences(pullCtx, sequenceStatuses, pullOptions);
    await pullShots(pullCtx, shotStatuses, pullOptions);
    await pullAssets(pullCtx, pullOptions);
    await pullTasks(pullCtx, taskStatuses, userMap, pullOptions);

    // 4. Publishes et fichiers de pipeline.
    if (options.withMedia !== false) {
      await pullVersions(pullCtx, { since: options.since ?? null });
      await pullPublishedFiles(pullCtx);
      // 5. Notes et playlists : après les versions, dont les unes et les autres dépendent.
      await pullNotes(pullCtx);
      await pullPlaylists(pullCtx);
    }

    await journal.finish('ok');
    await prisma.shotgridConnection.update({
      where: { id: ctx.connection.id },
      data: { lastSyncAt: startedAt, status: 'ok', statusMessage: null },
    });
    emitToProject(projectId, 'shotgrid:sync', { projectId, runId: journal.runId, status: 'ok' });
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
    emitToProject(projectId, 'shotgrid:sync', { projectId, runId: journal.runId, status: 'error' });
    return { runId: journal.runId, status: 'error', stats: { error: message } };
  } finally {
    running.delete(ctx.connection.id);
    // Rejouer ce qui est arrivé pendant la passe. Sans `await` : l'appelant courant a
    // fini son travail, et le rattrapage ne doit ni allonger sa réponse ni faire échouer
    // son job s'il échoue à son tour.
    const deferred = pending.get(ctx.connection.id);
    if (deferred) {
      pending.delete(ctx.connection.id);
      void runSync(projectId, deferred).catch((err: unknown) => {
        logger.warn({ projectId, err }, 'Synchronisation différée en échec');
      });
    }
  }
}

/**
 * Rattrapage après coupure.
 *
 * ReView peut avoir été arrêté, isolé du réseau, ou avoir manqué des webhooks (ShotGrid
 * abandonne un point de livraison après cent échecs et n'en garde la trace que sept
 * jours). La réconciliation relit tout ce qui a bougé sur une fenêtre large — par
 * défaut trois jours, réglable — et réaligne sans rien demander à personne.
 * ShotGrid fait foi : c'est le registre de production, ReView en est le miroir.
 */
export async function runReconcile(projectId: number, options: { lookbackHours?: number } = {}) {
  const conn = await prisma.shotgridConnection.findUnique({ where: { projectId } });
  if (!conn) return null;
  const settings = parseSettings(conn.settings);
  const hours = options.lookbackHours ?? settings.reconcile.lookbackHours;
  // On repart de la dernière synchronisation réussie, jamais de « maintenant » : si
  // l'instance est restée arrêtée une semaine, la fenêtre doit couvrir cette semaine.
  const from = conn.lastSyncAt ?? new Date(Date.now() - hours * 3600_000);
  const since = new Date(Math.min(from.getTime(), Date.now() - hours * 3600_000));
  return runSync(projectId, { kind: 'reconcile', since });
}

/** Connexions actives — utilisé par les tâches périodiques et le rattrapage au démarrage. */
export async function listActiveConnections() {
  return prisma.shotgridConnection.findMany({
    where: { active: true },
    include: { site: true, project: { select: { id: true, name: true, deletedAt: true } } },
  });
}

/**
 * Inventaire distant, sans rien écrire — base de la page de comparaison.
 * Compté par entité pour repérer d'un coup d'œil ce qui manque d'un côté ou de l'autre.
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

/** Nom du projet distant, pour l'affichage de l'état de connexion. */
export async function remoteProjectName(ctx: ConnectionContext): Promise<string | null> {
  const remote = await ctx.client.findById('Project', ctx.connection.sgProjectId, ['name']);
  return asString(remote?.name);
}
