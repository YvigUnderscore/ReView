// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { TaskStatus, type PipelineStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { badRequest, conflict, notFound } from '../lib/errors';

/**
 * Statuts de pipeline personnalisables (tâches et plans).
 *
 * L'énumération `TaskStatus` reste en base : les colonnes du kanban, les statistiques
 * et l'API v1 s'y appuient. Chaque statut personnalisé porte donc son équivalent
 * (`legacyStatus`), écrit en parallèle. Un studio sans ShotGrid garde exactement ses
 * six statuts d'origine ; un studio connecté voit ceux de son site.
 */

/**
 * Les quatre périmètres qui portent un statut.
 *
 * ShotGrid tient une liste **par entité** (`sg_status_list` sur Task, Shot, Sequence et
 * Asset), et elles ne coïncident pas : quatre valeurs sur une séquence, quinze sur un
 * plan. Les confondre proposait à l'écran des états que le site refusait à l'écriture —
 * et l'asset, lui, empruntait le vocabulaire des tâches faute d'en avoir un.
 */
export type Scope = 'task' | 'shot' | 'sequence' | 'asset';

/** Les périmètres proposés dans les écrans de réglage, dans l'ordre du pipe. */
export const SCOPES: readonly Scope[] = ['task', 'shot', 'sequence', 'asset'];

export interface StatusInput {
  scope: Scope;
  code: string;
  name: string;
  color: string;
  order?: number;
  isDone?: boolean;
  isDefault?: boolean;
  legacyStatus?: TaskStatus | null;
}

// `order` seul laisse des égalités que Postgres ne départage pas : deux statuts de même
// rang sortiraient dans un ordre variable d'un appel à l'autre, et le « premier » servant
// de repli changerait sans raison. Le code tranche.
const ORDER_BY = [{ scope: 'asc' as const }, { order: 'asc' as const }, { code: 'asc' as const }];

export async function list(scope?: Scope): Promise<PipelineStatus[]> {
  return prisma.pipelineStatus.findMany({
    where: scope ? { scope } : undefined,
    orderBy: ORDER_BY,
  });
}

/**
 * Statuts à proposer sur un projet donné.
 *
 * Trois niveaux, du plus précis au plus général :
 *   1. le vocabulaire propre au projet, s'il en a un (B2) ;
 *   2. sinon celui du studio, filtré par origine — un projet relié parle le vocabulaire de
 *      son site et lui seul, un projet autonome ne doit jamais se voir proposer les statuts
 *      importés d'un site auquel il n'est pas relié ;
 *   3. en dernier recours, et **seulement pour un projet relié** dont on n'a pas encore lu
 *      les statuts, le vocabulaire local : mieux vaut ça qu'une liste vide.
 *
 * Le troisième niveau ne joue jamais dans l'autre sens. C'est ce qui manquait : le repli
 * précédent servait les statuts ShotGrid à des projets autonomes.
 */
export async function listForProject(projectId: number, scope?: Scope): Promise<PipelineStatus[]> {
  const where = scope ? { scope } : {};
  const own = await prisma.pipelineStatus.findMany({ where: { projectId, ...where }, orderBy: ORDER_BY });
  if (own.length > 0) return own;

  const connection = await prisma.shotgridConnection.findUnique({ where: { projectId } });
  const origin = connection?.active ? 'shotgrid' : 'local';
  const studio = await prisma.pipelineStatus.findMany({
    where: { projectId: null, origin, ...where },
    orderBy: ORDER_BY,
  });
  if (studio.length > 0 || !connection?.active) return studio;

  return prisma.pipelineStatus.findMany({
    where: { projectId: null, origin: 'local', ...where },
    orderBy: ORDER_BY,
  });
}

/**
 * Le statut à poser pour une valeur de l'énumération, dans le vocabulaire du projet.
 *
 * Le kanban envoie encore l'énumération à six valeurs. La résolution cherchait « le premier
 * statut du référentiel entier qui porte cet enum », tous projets et toutes origines
 * confondus : un plan « On Hold » redescendait en « Waiting to Start », et le résultat
 * repartait vers le site ShotGrid du studio. La recherche est désormais bornée au
 * vocabulaire réellement offert au projet.
 */
export async function resolveByLegacy(
  projectId: number,
  scope: Scope,
  legacyStatus: TaskStatus,
): Promise<PipelineStatus | null> {
  const candidates = await listForProject(projectId, scope);
  return candidates.find((s) => s.legacyStatus === legacyStatus) ?? null;
}

/**
 * Vérifie qu'un statut est bien de ceux qu'on peut poser sur une entité de ce projet (C3).
 *
 * Même garde que pour les tâches, étendue aux plans et aux séquences dont le PATCH
 * n'acceptait tout simplement pas le statut : la valeur ne pouvait venir que de la
 * synchronisation ShotGrid, et un studio autonome n'avait aucun moyen de la changer.
 * `null` efface le statut, ce qui est toujours permis.
 */
export async function assertBelongsToProject(
  projectId: number,
  scope: Scope,
  statusId: number | null,
): Promise<number | null> {
  if (statusId === null) return null;
  const offered = await listForProject(projectId, scope);
  const found = offered.find((s) => s.id === statusId);
  if (!found) throw badRequest('Unknown pipeline status for this project');
  return found.id;
}

export async function create(input: StatusInput, projectId: number | null = null): Promise<PipelineStatus> {
  const code = normaliseCode(input.code);
  const existing = await prisma.pipelineStatus.findFirst({
    where: { projectId, scope: input.scope, code, origin: 'local' },
  });
  if (existing) throw conflict('A status already uses this code in this scope');
  if (input.isDefault) await clearDefault(input.scope, projectId);
  return prisma.pipelineStatus.create({
    data: {
      projectId,
      scope: input.scope,
      code,
      name: input.name,
      color: input.color,
      order: input.order ?? (await nextOrder(input.scope, projectId)),
      isDone: input.isDone ?? false,
      isDefault: input.isDefault ?? false,
      legacyStatus: input.legacyStatus ?? TaskStatus.TODO,
    },
  });
}

export async function update(id: number, input: Partial<StatusInput>): Promise<PipelineStatus> {
  const status = await prisma.pipelineStatus.findUnique({ where: { id } });
  if (!status) throw notFound('Status not found');
  if (input.isDefault) await clearDefault(status.scope as Scope, status.projectId);
  return prisma.pipelineStatus.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.color !== undefined ? { color: input.color } : {}),
      ...(input.order !== undefined ? { order: input.order } : {}),
      ...(input.isDone !== undefined ? { isDone: input.isDone } : {}),
      ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      ...(input.legacyStatus !== undefined ? { legacyStatus: input.legacyStatus } : {}),
    },
  });
}

/**
 * Supprime un statut inutilisé. Un statut porté par des tâches ou des plans ne
 * disparaît pas : les entités concernées perdraient leur état sans que personne
 * n'ait décidé lequel leur donner à la place.
 */
export async function remove(id: number): Promise<void> {
  const status = await prisma.pipelineStatus.findUnique({ where: { id } });
  if (!status) throw notFound('Status not found');
  const [tasks, shots] = await Promise.all([
    prisma.task.count({ where: { pipelineStatusId: id } }),
    prisma.shot.count({ where: { pipelineStatusId: id } }),
  ]);
  if (tasks + shots > 0) throw conflict(`This status is used by ${tasks + shots} item(s) — replace it first`);
  const remaining = await prisma.pipelineStatus.count({ where: { scope: status.scope } });
  if (remaining <= 1) throw badRequest('The last status of a scope cannot be deleted');
  await prisma.pipelineStatus.delete({ where: { id } });
}

export async function reorder(scope: Scope, ids: number[]): Promise<PipelineStatus[]> {
  await prisma.$transaction(
    ids.map((id, index) => prisma.pipelineStatus.update({ where: { id }, data: { order: index } })),
  );
  return list(scope);
}

function normaliseCode(code: string): string {
  return code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .slice(0, 40);
}

async function nextOrder(scope: Scope, projectId: number | null): Promise<number> {
  const last = await prisma.pipelineStatus.findFirst({
    where: { scope, projectId },
    orderBy: { order: 'desc' },
  });
  return (last?.order ?? -1) + 1;
}

/** Le statut par défaut est unique par périmètre ET par portée : un projet a le sien. */
async function clearDefault(scope: Scope, projectId: number | null): Promise<void> {
  await prisma.pipelineStatus.updateMany({
    where: { scope, projectId, isDefault: true },
    data: { isDefault: false },
  });
}
