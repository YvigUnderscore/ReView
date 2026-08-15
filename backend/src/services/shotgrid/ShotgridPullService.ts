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
  type ShotLinkData,
  type TaskLinkData,
} from './shotgridLinks';
import type { SyncJournal } from './ShotgridSyncJournal';
import { can } from './shotgridSettings';

/**
 * Import de la hiérarchie de production depuis ShotGrid.
 *
 * Chaque requête porte le filtre de projet ET chaque entité reçue est revérifiée :
 * ShotGrid héberge tous les projets du studio sur le même site, et un filtre oublié
 * ne se voit pas — il importe simplement le projet du voisin par-dessus le nôtre.
 *
 * L'import est idempotent : re-synchroniser un projet inchangé ne produit aucune
 * écriture. C'est ce qui rend la réconciliation périodique sans risque.
 */

const SEQUENCE_FIELDS = ['code', 'description', 'sg_status_list', 'project', 'updated_at'];
const SHOT_FIELDS = [
  'code',
  'description',
  'sg_sequence',
  'sg_cut_in',
  'sg_cut_out',
  'sg_cut_duration',
  'sg_status_list',
  'project',
  'updated_at',
];
const ASSET_FIELDS = [
  'code',
  'description',
  'sg_asset_type',
  'sg_status_list',
  // Rattachements portés par l'asset côté ShotGrid : c'est de là que sortent les
  // listes « quels assets pour ce plan », et les lire évite de les ressaisir ici.
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
  /** Ne reprendre que ce qui a changé depuis cette date (réconciliation, incrémental). */
  since?: Date | null;
  /** Restreindre à quelques entités distantes (traitement d'un événement). */
  onlySgIds?: { sgType: string; sgId: number }[];
}

interface PullContext extends ConnectionContext {
  journal: SyncJournal;
  scope: ProjectScope;
}

/** Filtres d'une recherche : projet obligatoire, plus la fenêtre temporelle éventuelle. */
function buildFilters(scope: ProjectScope, since?: Date | null): Array<[string, string, unknown]> {
  const filters: Array<[string, string, unknown]> = [projectFilter(scope.sgProjectId)];
  if (since) filters.push(['updated_at', 'greater_than', since.toISOString()]);
  return filters;
}

/**
 * Écarte toute entité qui n'appartient pas au projet lié.
 *
 * Ce contrôle ne devrait jamais rien attraper puisque les requêtes sont filtrées —
 * c'est précisément pourquoi il est là : le jour où un filtre saute, on refuse
 * l'entité au lieu d'écraser le travail d'un autre projet, et on le dit fort.
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

/** Lecture d'un lot d'entités, filtrée et vérifiée. */
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
 * Une entité locale trouvée par son nom peut-elle accueillir cette entité ShotGrid ?
 *
 * Non si elle est déjà la contrepartie d'une autre : un site héberge sans peine quatre
 * séquences nommées « DO_NOT_USE_ », et les fondre sur la même ligne locale n'en
 * importerait qu'une — les trois autres manqueraient à chaque comparaison, sans que rien
 * ne dise pourquoi. Le nom sert donc à adopter ce qui existait avant la liaison, jamais
 * à confondre deux entités distinctes du site.
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
 * Où écrire cette entité du site, et sous quel nom.
 *
 * Trois questions dans l'ordre : a-t-elle déjà une contrepartie locale (le lien) ? sinon,
 * peut-elle adopter une entité de même nom créée avant la liaison ? et surtout : le nom
 * du site est-il libre au moment d'écrire ?
 *
 * Cette dernière question vaut aussi à la mise à jour, pas seulement à la création. La
 * poser trop tard coûte une violation de contrainte d'unicité : une entité déjà
 * désambiguïsée se ferait renommer vers le nom du site à la passe suivante — nom que sa
 * jumelle porte toujours.
 *
 * Les accès à la base sont injectés : cette résolution est une règle, et elle se teste
 * comme telle.
 */
export async function localTarget<T extends { id: number }>(params: {
  connectionId: number;
  localType: LocalType;
  sgId: number;
  /** Nom porté par l'entité côté ShotGrid. */
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

  // Le nom du site s'il est libre ou déjà le nôtre ; sinon le nôtre, suffixé.
  const holder = await params.findByName(sgName);
  const name = !holder || holder.id === existing?.id ? sgName : disambiguatedName(sgName, sgId);
  return { existing, name };
}

/**
 * Le côté ReView a-t-il bougé depuis la dernière synchronisation ?
 * Sert à repérer les conflits : ShotGrid tranche par défaut, mais l'écrasement est
 * journalisé pour rester explicable.
 */
async function noteConflictIfLocalChanged(
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
     * Champ concerné et valeurs en présence — ce que l'arbitre doit voir.
     * `field` est un identifiant stable (`status`…), pas un libellé : c'est le lecteur
     * qui décide de la langue, pas le serveur qui a écrit la ligne.
     */
    field?: string;
    reviewValue?: string | null;
    remoteValue?: string | null;
  },
): Promise<void> {
  const { localUpdatedAt, linkSyncedAt } = params;
  if (!localUpdatedAt || !linkSyncedAt) return;
  if (localUpdatedAt.getTime() <= linkSyncedAt.getTime() + 1000) return;
  ctx.journal.count('conflicts', 'updated');
  await ctx.journal.conflict(
    'shotgrid.log.conflictOverwritten',
    {
      name: params.name,
      policy: ctx.settings.conflictPolicy,
      // Sans ces repères, la ligne de conflit ne dit pas ce qui a divergé ni quand :
      // impossible d'arbitrer en connaissance de cause.
      ...(params.field ? { field: params.field } : {}),
      review: params.reviewValue ?? '—',
      shotgrid: params.remoteValue ?? '—',
      localAt: localUpdatedAt.toISOString(),
    },
    {
      sgType: params.sgType,
      sgId: params.sgId,
      localType: params.localType,
      localId: params.localId,
    },
  );
}

// ───────────────────────────── Séquences ─────────────────────────────

export async function pullSequences(
  ctx: PullContext,
  statuses: Map<string, PipelineStatus> = new Map(),
  options: PullOptions = {},
) {
  if (!can(ctx.settings, 'hierarchy', 'read')) return;
  const records = await fetchScoped(ctx, 'Sequence', SEQUENCE_FIELDS, options);
  // Passe complète : ce que le site ne renvoie plus a été mis à la corbeille là-bas.
  if (!options.since && !options.onlySgIds)
    await trashRemoved(ctx, 'Sequence', new Set(records.map((r) => r.id)));
  const links = await mapSgToLocal(ctx.connection.id, 'sequence');

  for (const [index, record] of records.entries()) {
    const code = asString(record.code) ?? `SQ${record.id}`;
    const statusCode = asString(record.sg_status_list);
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
      order: index,
      projectId: ctx.connection.projectId,
      pipelineStatusId: statusCode ? (statuses.get(statusCode)?.id ?? null) : null,
      deletedAt: null,
    };
    const saved = existing
      ? await prisma.sequence.update({ where: { id: existing.id }, data })
      : await prisma.sequence.create({ data });

    await upsertLink({
      connectionId: ctx.connection.id,
      localType: 'sequence',
      localId: saved.id,
      sgType: 'Sequence',
      sgId: record.id,
      sgUpdatedAt: asDate(record.updated_at),
    });
    ctx.journal.count('sequences', existing ? 'updated' : 'created');
  }
}

// ───────────────────────────── Plans ─────────────────────────────

export async function pullShots(
  ctx: PullContext,
  statuses: Map<string, PipelineStatus>,
  options: PullOptions = {},
) {
  if (!can(ctx.settings, 'hierarchy', 'read')) return;
  const records = await fetchScoped(ctx, 'Shot', SHOT_FIELDS, options);
  if (!options.since && !options.onlySgIds)
    await trashRemoved(ctx, 'Shot', new Set(records.map((r) => r.id)));
  const sequenceLinks = await mapSgToLocal(ctx.connection.id, 'sequence');
  const shotLinks = await mapSgToLocal(ctx.connection.id, 'shot');

  for (const [index, record] of records.entries()) {
    const code = asString(record.code) ?? `SH${record.id}`;
    const sequenceRef = asEntityRef(record.sg_sequence);
    const sequenceId = sequenceRef ? (sequenceLinks.get(sequenceRef.id)?.localId ?? null) : null;
    const statusCode = asString(record.sg_status_list);
    const status = statusCode ? statuses.get(statusCode) : undefined;
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
      order: index,
      pipelineStatusId: status?.id ?? null,
      deletedAt: null,
    };

    let savedId: number;
    if (existing) {
      await noteConflictIfLocalChanged(ctx, {
        localUpdatedAt: null, // Shot n'a pas d'updatedAt : le conflit se joue sur les tâches.
        linkSyncedAt: link?.syncedAt,
        localType: 'shot',
        localId: existing.id,
        sgType: 'Shot',
        sgId: record.id,
        name: code,
      });
      const updated = await prisma.shot.update({ where: { id: existing.id }, data });
      savedId = updated.id;
      ctx.journal.count('shots', 'updated');
    } else {
      const created = await prisma.shot.create({ data });
      savedId = created.id;
      ctx.journal.count('shots', 'created');
    }

    const linkData: ShotLinkData = {
      sgStatusCode: statusCode,
      cutDuration: asNumber(record.sg_cut_duration) ?? cutDuration(cutIn, cutOut),
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

export async function pullAssets(ctx: PullContext, options: PullOptions = {}) {
  if (!can(ctx.settings, 'hierarchy', 'read')) return;
  const records = await fetchScoped(ctx, 'Asset', ASSET_FIELDS, options);
  if (!options.since && !options.onlySgIds)
    await trashRemoved(ctx, 'Asset', new Set(records.map((r) => r.id)));
  const assetLinks = await mapSgToLocal(ctx.connection.id, 'asset');
  // Les plans et sequences ont été importés juste avant : leurs correspondances
  // existent, on peut donc rattacher sans rien créer au passage.
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
    const data = {
      projectId: ctx.connection.projectId,
      name: localName,
      // L'énumération sert aux filtres ; le libellé exact du studio est ce qui s'affiche.
      type: sgAssetType(sgType),
      typeLabel: sgType,
      description: asString(record.description),
      deletedAt: null,
    };
    const saved = existing
      ? await prisma.asset.update({ where: { id: existing.id }, data })
      : await prisma.asset.create({ data });

    // Rattachements : `set` remplace la liste entière plutôt que d'ajouter — c'est ce
    // qui empêche les doublons quand une synchronisation repasse. Seules les entités
    // déjà reliées sont citées : un shot inconnu de ReView n'a rien à rattacher.
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

    const linkData: AssetLinkData = {
      sgAssetType: asString(record.sg_asset_type),
      sgStatusCode: asString(record.sg_status_list),
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
    ctx.journal.count('assets', existing ? 'updated' : 'created');
  }
}

// ───────────────────────────── Tâches ─────────────────────────────

/**
 * Correspondance des comptes par adresse électronique.
 *
 * Aucun compte n'est créé : un artiste ShotGrid sans compte ReView reste affiché par
 * son nom (conservé dans le lien) mais la tâche n'est assignée à personne. Inventer
 * des comptes depuis une synchronisation ouvrirait des accès que personne n'a validés.
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

export async function pullTasks(
  ctx: PullContext,
  statuses: Map<string, PipelineStatus>,
  userMap: Map<number, number>,
  options: PullOptions = {},
) {
  if (!can(ctx.settings, 'tasks', 'read')) return;
  const records = await fetchScoped(ctx, 'Task', TASK_FIELDS, options);
  // Passe complète : une tâche que le site ne renvoie plus y a été mise à la corbeille.
  if (!options.since && !options.onlySgIds)
    await trashRemoved(ctx, 'Task', new Set(records.map((r) => r.id)));
  const shotLinks = await mapSgToLocal(ctx.connection.id, 'shot');
  const assetLinks = await mapSgToLocal(ctx.connection.id, 'asset');
  const taskLinks = await mapSgToLocal(ctx.connection.id, 'task');

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
    const assignees = asEntityRefs(record.task_assignees);
    const assigneeId =
      assignees.map((a) => userMap.get(a.id)).find((id): id is number => Boolean(id)) ?? null;

    const link = taskLinks.get(record.id);
    const existing = link ? await prisma.task.findUnique({ where: { id: link.localId } }) : null;

    const data = {
      name,
      type: sgStepToTaskType(stepName),
      department: stepName ?? null,
      shotId,
      assetId: shotId ? null : assetId,
      assigneeId,
      startDate: asDate(record.start_date),
      dueDate: asDate(record.due_date),
      ...(status ? { pipelineStatusId: status.id, status: status.legacyStatus ?? undefined } : {}),
    };

    let savedId: number;
    if (existing) {
      const localStatus = existing.pipelineStatusId
        ? ((await prisma.pipelineStatus.findUnique({ where: { id: existing.pipelineStatusId } }))?.code ??
          null)
        : null;
      await noteConflictIfLocalChanged(ctx, {
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
      await prisma.task.update({ where: { id: existing.id }, data });
      savedId = existing.id;
      ctx.journal.count('tasks', 'updated');
    } else {
      const created = await prisma.task.create({ data });
      savedId = created.id;
      ctx.journal.count('tasks', 'created');
    }

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
 * Entités retirées côté ShotGrid : mises à la corbeille, jamais supprimées.
 * Le travail associé (commentaires, versions, historique) reste consultable, et un
 * retrait par erreur côté ShotGrid se répare sans perte.
 */
export async function trashRemoved(
  ctx: PullContext,
  sgType: 'Shot' | 'Sequence' | 'Asset' | 'Task',
  aliveSgIds: Set<number>,
): Promise<void> {
  const localType = sgType.toLowerCase() as 'shot' | 'sequence' | 'asset' | 'task';
  const links = await mapSgToLocal(ctx.connection.id, localType);
  for (const [sgId, link] of links) {
    if (aliveSgIds.has(sgId)) continue;

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

    // Cible déjà disparue : le lien ne désigne plus rien. Le garder ferait rejouer ce
    // retrait — et son message — à chaque synchronisation, indéfiniment.
    if (!target) {
      await removeLink(ctx.connection.id, sgType, sgId);
      continue;
    }

    if (sgType === 'Task') {
      if (!(await retireTask(ctx, link.localId, sgId))) continue;
      // La task est partie pour de bon : plus rien à relier.
      await removeLink(ctx.connection.id, sgType, sgId);
    } else {
      // Le lien survit à la mise à la corbeille : restaurer côté ShotGrid doit rendre
      // l'entité telle qu'elle était, avec son historique, pas en fabriquer une copie.
      await (table as { update: (a: unknown) => Promise<unknown> })
        .update({ where: { id: link.localId }, data: { deletedAt: new Date() } })
        .catch(() => undefined);
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
 * Retrait d'une tâche mise à la corbeille côté ShotGrid.
 *
 * Une tâche n'a pas de suppression douce : la supprimer emporte ses versions en cascade,
 * donc le travail de review qui y est attaché. On ne retire donc que les tâches vides ;
 * une tâche qui porte des versions reste en place et le journal le dit, à charge d'un
 * humain de décider quoi faire de ce travail devenu orphelin.
 *
 * Renvoie `true` si la tâche a effectivement été retirée.
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
  await prisma.task.delete({ where: { id: localId } }).catch(() => undefined);
  return true;
}

export async function existsRemotely(ctx: PullContext, sgType: string, sgId: number): Promise<boolean> {
  const record = await ctx.client.findById(sgType, sgId, ['id', 'project']);
  if (!record) return false;
  return belongsToProject(record, ctx.scope).ok;
}

export { findBySg };
export type { PullContext };
