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
 * L'entité Episode de ShotGrid.
 *
 * ShotGrid connaît un niveau `Episode` au-dessus de `Sequence` (champ `sg_episode` sur
 * la séquence). ReView vient de l'acquérir : ce module fait la correspondance.
 *
 * **Les invariants de sûreté du connecteur s'appliquent sans exception** : un site
 * héberge tous les projets du studio, donc toute requête porte le filtre de projet
 * (`projectFilter`) ET toute entité reçue est revérifiée (`belongsToProject`). Écrire
 * dans le mauvais projet ne se rattrape pas — la ceinture (le filtre) peut être oubliée
 * dans un appel, les bretelles (la vérification) sont le dernier rempart.
 *
 * L'import ne s'exécute que si le niveau est activé sur le projet ReView : rapatrier des
 * épisodes dans un projet qui n'en montre aucun créerait des lignes invisibles, que
 * personne ne pourrait ni voir ni corriger.
 *
 * La correspondance passe par `ShotgridLink` avec `localType = 'episode'`, posée par les
 * assistants partagés de `shotgridLinks.ts` comme pour toutes les autres entités.
 */

const LOCAL_TYPE = 'episode';
const SG_TYPE = 'Episode';

/** Champs lus sur l'entité distante — jamais `*` : on ne rapatrie que ce qu'on écrit. */
export const EPISODE_FIELDS = ['code', 'description', 'sg_status_list', 'project', 'updated_at'];

/** Champ de la Sequence ShotGrid qui porte son épisode. */
export const SG_SEQUENCE_EPISODE_FIELD = 'sg_episode';

/**
 * Champs lus sur la Sequence distante pour le seul rattachement.
 *
 * `sg_episode` n'est demandé QUE par cette passe, et cette passe ne tourne que sur un
 * projet où le niveau est activé : un site qui ne connaît pas le champ — un studio sans
 * série — n'est jamais interrogé dessus, et l'import ordinaire des séquences reste
 * exactement ce qu'il était.
 */
const SEQUENCE_EPISODE_FIELDS = ['project', 'updated_at', SG_SEQUENCE_EPISODE_FIELD];

/** Le niveau Épisode est-il activé côté ReView sur le projet lié ? */
async function episodesEnabled(projectId: number): Promise<boolean> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { episodesEnabled: true },
  });
  return project?.episodesEnabled ?? false;
}

// ───────────────────────────── Verrou de création ─────────────────────────────

/** Erreur porteuse du lien de création distant — le client en fait un bouton. */
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
 * Refuse la création locale d'un épisode quand le projet est piloté depuis ShotGrid.
 *
 * Même règle que pour une séquence ou un plan, mais avec le bon formulaire distant :
 * `CreatableKind` de `ShotgridGuardService` ne connaît pas encore « episode », et
 * emprunter son entrée « sequence » renverrait le studio vers le mauvais écran.
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
 * Code local d'un épisode ShotGrid. Le site laisse `code` vide plus souvent qu'on ne
 * croit ; le repli est stable et unique, donc rejouable sans créer de doublon.
 */
export function episodeCode(record: SgRecord): string {
  return asString(record.code) ?? `EP${record.id}`;
}

// ───────────────────────────── Import ─────────────────────────────

/** Ce dont l'import a besoin — sous-ensemble structurel du contexte de `pullSequences`. */
export interface EpisodePullContext extends ConnectionContext {
  journal: SyncJournal;
  scope: ProjectScope;
}

export interface EpisodePullOptions {
  since?: Date | null;
  onlySgIds?: { sgType: string; sgId: number }[];
}

/**
 * Écarte toute entité qui n'appartient pas au projet lié.
 *
 * Ce contrôle ne devrait jamais rien attraper puisque la requête est filtrée — c'est
 * précisément pourquoi il est là.
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
 * Importe les épisodes du projet lié.
 *
 * Deux verrous avant la moindre écriture : le domaine `hierarchy` doit être ouvert en
 * lecture, et le niveau Épisode doit être activé côté ReView. Sans le second, la
 * synchronisation créerait des lignes qu'aucun écran ne montre.
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
  // `order` se déduit du rang dans le lot : il n'a de sens qu'en passe complète, sinon
  // une relecture ciblée remonterait l'épisode en tête de liste pour tout le monde.
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
 * Rattache les séquences déjà importées à leur épisode.
 *
 * À appeler APRÈS `pullEpisodes` et l'import des séquences : le rattachement lit la
 * correspondance des deux côtés. Une séquence dont l'épisode distant n'est pas lié — il
 * n'a pas été importé, ou il appartient à un autre projet — est laissée détachée plutôt
 * que rattachée au hasard.
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
    // La séquence doit appartenir au projet lié : la carte des liens vient de la
    // connexion, mais l'écriture, elle, se fait par identifiant local — on le borne.
    const { count } = await prisma.sequence.updateMany({
      where: { id: localSequenceId, projectId: ctx.connection.projectId },
      data: { episodeId },
    });
    updated += count;
  }
  return updated;
}

/**
 * La passe complète du rattachement : relire les séquences distantes pour le seul champ
 * `sg_episode`, puis les rattacher.
 *
 * Elle est séparée de `pullSequences` à dessein. L'import ordinaire des séquences ne
 * demande pas `sg_episode` — un site sans série n'a pas forcément ce champ, et le
 * réclamer ferait échouer la synchronisation de tout le monde pour un niveau que
 * personne n'a activé. Ici, la requête ne part que si le projet a allumé le niveau.
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
  // Même ceinture et mêmes bretelles que pour les épisodes : la requête porte le filtre
  // de projet, et chaque entité reçue est revérifiée avant la moindre écriture.
  const records = await keepInProject(fetched, ctx);
  const sequenceLinks = await mapSgToLocal(ctx.connection.id, 'sequence');
  return linkSequencesToEpisodes(ctx, records, sequenceLinks);
}
