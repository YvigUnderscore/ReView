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

/** Les trois périmètres qui portent un statut. Seuls les deux premiers sont éditables. */
export type Scope = 'task' | 'shot' | 'sequence';

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

export async function list(scope?: Scope): Promise<PipelineStatus[]> {
  return prisma.pipelineStatus.findMany({
    where: scope ? { scope } : undefined,
    // `order` seul laisse des égalités que Postgres ne départage pas : deux statuts de
    // même rang sortiraient dans un ordre variable d'un appel à l'autre, et le « premier »
    // servant de repli changerait sans raison. Le code tranche.
    orderBy: [{ scope: 'asc' }, { order: 'asc' }, { code: 'asc' }],
  });
}

/**
 * Statuts à proposer sur un projet donné.
 *
 * Un projet relié à ShotGrid parle le vocabulaire de son site, et lui seul : proposer en
 * plus nos six statuts d'origine invite à poser un statut que le site refusera. Un projet
 * non relié fait l'inverse — les statuts importés d'un site ne le concernent pas.
 *
 * C'est le même motif que `ReviewDecisionService.listStatusesForProject` applique déjà aux
 * décisions de review : le référentiel reste commun au studio, la liste offerte dépend du
 * projet.
 */
export async function listForProject(projectId: number, scope?: Scope): Promise<PipelineStatus[]> {
  const all = await list(scope);
  const connection = await prisma.shotgridConnection.findUnique({ where: { projectId } });
  const wanted = connection?.active ? 'shotgrid' : 'local';
  const kept = all.filter((s) => s.origin === wanted);
  // Un site dont on n'a pas encore lu les statuts ne doit pas laisser l'utilisateur
  // devant une liste vide : mieux vaut le vocabulaire local que rien du tout.
  return kept.length > 0 ? kept : all;
}

export async function create(input: StatusInput): Promise<PipelineStatus> {
  const code = normaliseCode(input.code);
  const existing = await prisma.pipelineStatus.findUnique({
    where: { scope_code: { scope: input.scope, code } },
  });
  if (existing) throw conflict('Un statut porte déjà ce code dans ce périmètre');
  if (input.isDefault) await clearDefault(input.scope);
  return prisma.pipelineStatus.create({
    data: {
      scope: input.scope,
      code,
      name: input.name,
      color: input.color,
      order: input.order ?? (await nextOrder(input.scope)),
      isDone: input.isDone ?? false,
      isDefault: input.isDefault ?? false,
      legacyStatus: input.legacyStatus ?? TaskStatus.TODO,
    },
  });
}

export async function update(id: number, input: Partial<StatusInput>): Promise<PipelineStatus> {
  const status = await prisma.pipelineStatus.findUnique({ where: { id } });
  if (!status) throw notFound('Statut introuvable');
  if (input.isDefault) await clearDefault(status.scope as Scope);
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
  if (!status) throw notFound('Statut introuvable');
  const [tasks, shots] = await Promise.all([
    prisma.task.count({ where: { pipelineStatusId: id } }),
    prisma.shot.count({ where: { pipelineStatusId: id } }),
  ]);
  if (tasks + shots > 0)
    throw conflict(`Statut utilisé par ${tasks + shots} élément(s) — le remplacer d’abord`);
  const remaining = await prisma.pipelineStatus.count({ where: { scope: status.scope } });
  if (remaining <= 1) throw badRequest('Le dernier statut d’un périmètre ne peut pas être supprimé');
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

async function nextOrder(scope: Scope): Promise<number> {
  const last = await prisma.pipelineStatus.findFirst({ where: { scope }, orderBy: { order: 'desc' } });
  return (last?.order ?? -1) + 1;
}

async function clearDefault(scope: Scope): Promise<void> {
  await prisma.pipelineStatus.updateMany({ where: { scope, isDefault: true }, data: { isDefault: false } });
}
