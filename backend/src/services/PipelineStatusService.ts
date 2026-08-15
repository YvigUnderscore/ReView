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

export type Scope = 'task' | 'shot';

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
    orderBy: [{ scope: 'asc' }, { order: 'asc' }],
  });
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

/** Statut par défaut d'un périmètre — proposé à la création d'une tâche. */
export async function defaultFor(scope: Scope): Promise<PipelineStatus | null> {
  return (
    (await prisma.pipelineStatus.findFirst({ where: { scope, isDefault: true } })) ??
    (await prisma.pipelineStatus.findFirst({ where: { scope }, orderBy: { order: 'asc' } }))
  );
}

/**
 * Valeurs à écrire pour poser un statut de tâche : le référentiel et l'énumération
 * avancent ensemble. Passer par cette fonction évite qu'un appelant n'en oublie une.
 */
export async function taskStatusData(
  pipelineStatusId: number | null | undefined,
): Promise<{ pipelineStatusId: number | null; status?: TaskStatus }> {
  if (!pipelineStatusId) return { pipelineStatusId: null };
  const status = await prisma.pipelineStatus.findUnique({ where: { id: pipelineStatusId } });
  if (!status) throw badRequest('Statut de pipeline inconnu');
  return { pipelineStatusId: status.id, status: status.legacyStatus ?? TaskStatus.TODO };
}

/** Correspondance inverse : quel statut personnalisé représente cette valeur d'énumération ? */
export async function fromLegacy(scope: Scope, legacy: TaskStatus): Promise<PipelineStatus | null> {
  return prisma.pipelineStatus.findFirst({
    where: { scope, legacyStatus: legacy },
    orderBy: { order: 'asc' },
  });
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
