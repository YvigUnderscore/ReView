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
  /**
   * Passes à exécuter. Absente, la liste se déduit des entités ciblées, sinon tout est
   * exécuté. C'est ce qui permet à un événement Note de ne relire que les notes — et
   * d'être relu tout court.
   */
  passes?: SyncPass[];
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
    // Même règle que pour les entités : l'union, et une demande sans liste (donc « tout »)
    // absorbe l'autre. Fusionner deux événements Note et Version doit relire les deux.
    passes: mergePasses(a.passes, b.passes),
  };
}

/**
 * Versions à relire parmi celles qu'un événement désigne.
 *
 * Transmettre les identifiants à `pullVersions` fait sauter le filtre de statuts du
 * studio — il y est traité comme le signe d'une sélection manuelle. Ce serait rapatrier
 * les médias de tous les WIP d'un site dont le studio a précisément choisi de ne suivre
 * que les versions en review. On rejoue donc le filtre ici, et on en profite pour
 * revérifier le projet : un identifiant reçu par webhook ne prouve rien.
 *
 * Une version déjà liée passe toujours : le filtre décide de ce qu'on importe, pas de ce
 * qu'on continue de suivre.
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

  // Un événement ne doit toucher que ce qu'il désigne : le collecteur retient les
  // entités réalignées et la décision d'émettre est prise en fin de passe.
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
  // Demande ciblée : une passe dont aucun identifiant n'est cité n'a rien à faire — la
  // laisser partir sans filtre, c'est rejouer le projet entier pour une entité.
  const targeted = (options.onlySgIds?.length ?? 0) > 0;

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
    let assetStatuses = new Map<string, import('@prisma/client').PipelineStatus>();
    // Une passe qui ne lit aucun `sg_status_list` (notes, playlists, versions) se passe
    // du référentiel : ni lecture distante, ni repli en base.
    const readStatuses = wants('statuses');
    if (readStatuses && can(ctx.settings, 'statuses', 'read')) {
      const siteStatuses = await fetchSiteStatuses(ctx.client);
      taskStatuses = await syncPipelineStatuses(ctx.client, 'task', siteStatuses, journal);
      shotStatuses = await syncPipelineStatuses(ctx.client, 'shot', siteStatuses, journal);
      sequenceStatuses = await syncPipelineStatuses(ctx.client, 'sequence', siteStatuses, journal);
      // L'asset a sa propre liste côté site : il empruntait celle des tâches, donc il
      // affichait des états qu'aucun asset ne peut porter.
      assetStatuses = await syncPipelineStatuses(ctx.client, 'asset', siteStatuses, journal);
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
    } else if (readStatuses) {
      // Lecture du référentiel fermée : on se rabat sur les statuts DÉJÀ importés du site
      // (`projectId: null`, `origin: 'shotgrid'`). Sans ces deux filtres, le repli
      // ramenait aussi le vocabulaire local du studio et celui des autres projets : un
      // code commun comme « ip » suffisait à coller à un plan le statut d'un voisin.
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

    // 2. Comptes (correspondance par courriel, aucune création).
    const userMap = wants('users') ? await buildUserMap(pullCtx) : new Map<number, number>();

    // 3. Hiérarchie, dans l'ordre des dépendances. Les épisodes viennent en tête : le
    // rattachement des séquences lit leur correspondance. Sur un projet où le niveau est
    // éteint — le cas par défaut — les deux appels rendent la main sans rien demander au
    // site.
    if (wants('episodes')) await pullEpisodes(pullCtx, sequenceStatuses, pullOptions);
    if (wants('sequences')) await pullSequences(pullCtx, sequenceStatuses, pullOptions);
    if (wants('episodes')) await pullSequenceEpisodes(pullCtx, pullOptions);
    if (wants('shots')) await pullShots(pullCtx, shotStatuses, pullOptions);
    if (wants('assets')) await pullAssets(pullCtx, assetStatuses, pullOptions);
    if (wants('tasks')) await pullTasks(pullCtx, taskStatuses, userMap, pullOptions);

    // 4. Versions. Une demande ciblée transmet enfin ses identifiants : sans eux, un seul
    // événement Version relisait toutes les versions du projet.
    if (wants('versions')) {
      const versionIds = targeted ? await importableVersionIds(pullCtx, options.onlySgIds ?? []) : [];
      // Ciblée sans version retenue : rien à relire. Appeler `pullVersions` avec une
      // liste vide relancerait le balayage complet — l'inverse de ce qu'on cherche.
      if (!targeted || versionIds.length > 0) {
        await pullVersions(pullCtx, {
          since: options.since ?? null,
          ...(targeted ? { onlySgIds: versionIds } : {}),
        });
      }
    }
    // `PublishedFile` n'a pas de lecture ciblée : c'est un balayage de cinq mille
    // enregistrements. Il n'a sa place que sur une passe non ciblée.
    if (wants('publishedFiles') && !targeted) await pullPublishedFiles(pullCtx);

    // 5. Notes et playlists : après les versions, dont les unes et les autres dépendent.
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
    // Une passe interrompue a tout de même réaligné une partie du projet : le résumé
    // part quand même, sans quoi les écrans resteraient sur l'état d'avant.
    flushTouched(projectId, journal.runId, 'error', touched);
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
