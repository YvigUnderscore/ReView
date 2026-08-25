// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { prisma } from '../lib/prisma';
import { badRequest, notFound } from '../lib/errors';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertProjectManage, canContribute, effectiveProjectRole } from '../lib/projectRoles';
import type { SessionUser } from '../lib/shotgridAccess';
import { emitToProject } from './SocketService';
import { avatarUrl } from '../lib/userView';

/**
 * Qui est sur ce plan, cette séquence, cet asset.
 *
 * L'assignation existait déjà, mais uniquement sur les **tâches** : « donne cet asset à
 * Alice » se traduisait en « pose Alice sur chacune de ses tâches » (`AssignmentService`).
 * C'est la donnée juste du pipeline, et elle reste. Mais elle ne sait pas dire « cette
 * séquence est suivie par Bruno » quand Bruno n'a aucune tâche dessus — le superviseur de
 * séquence, la production, le lead qui couvre trois plans. Une production énonce
 * couramment cette responsabilité-là ; ReView ne savait pas l'écrire.
 *
 * Les deux coexistent donc et ne se remplacent pas : la tâche porte le travail, l'entité
 * porte la responsabilité. Les écrans les affichent ensemble, la tâche en premier.
 */

export const ASSIGNEE_KINDS = ['episode', 'sequence', 'shot', 'asset'] as const;
export type AssigneeKind = (typeof ASSIGNEE_KINDS)[number];

/** Ce qu'une carte a besoin de savoir d'un assigné : de quoi l'afficher, rien de plus. */
export const ASSIGNEE_SELECT = {
  id: true,
  name: true,
  firstName: true,
  lastName: true,
  username: true,
  email: true,
  avatarKey: true,
  jobTitle: true,
} as const;

/** Une personne lue en base : la clé objet de sa photo, pas encore signée. */
interface RawAssignee {
  id: number;
  name: string | null;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  email: string;
  avatarKey: string | null;
  jobTitle: string | null;
}

/**
 * La même, telle que l'API la rend : photo signée.
 *
 * Les listes de plans et d'assets rendent déjà `avatarUrl` ; rendre `avatarKey` ici
 * aurait donné deux formes pour la même personne selon qu'on lit une liste ou qu'on
 * vient d'écrire — et l'écran aurait affiché la pastille à initiales juste après
 * l'assignation, puis la vraie photo au rechargement.
 */
export type AssigneeView = Omit<RawAssignee, 'avatarKey'> & { avatarUrl: string | null };

/** Signe les photos d'un lot, une fois par personne. */
async function signed(people: RawAssignee[]): Promise<AssigneeView[]> {
  return Promise.all(
    people.map(async ({ avatarKey, ...person }) => ({
      ...person,
      avatarUrl: await avatarUrl(avatarKey),
    })),
  );
}

/** Le projet de l'entité porteuse, et son existence. */
async function resolveProject(kind: AssigneeKind, id: number): Promise<number> {
  const row = await findEntity(kind, id);
  if (!row) throw notFound('Entity not found');
  return row.projectId;
}

async function findEntity(kind: AssigneeKind, id: number): Promise<{ projectId: number } | null> {
  const where = { id, deletedAt: null };
  const select = { projectId: true };
  switch (kind) {
    case 'episode':
      return prisma.episode.findFirst({ where, select });
    case 'sequence':
      return prisma.sequence.findFirst({ where, select });
    case 'shot':
      return prisma.shot.findFirst({ where, select });
    case 'asset':
      return prisma.asset.findFirst({ where, select });
  }
}

/**
 * Qui peut recevoir une responsabilité.
 *
 * Mêmes refus que pour une tâche (`AssignmentService.assertAssignable`) et pour les mêmes
 * raisons : un compte de service n'ouvre pas Maya, un client commente sans livrer, et
 * quelqu'un qui n'est pas membre du projet serait averti d'un travail qu'il ne peut pas
 * ouvrir. Les deux chemins d'assignation doivent refuser les mêmes personnes, sinon
 * l'un devient la porte de service de l'autre.
 */
async function assertAssignable(projectId: number, userIds: number[]): Promise<void> {
  if (userIds.length === 0) return;
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, role: true, isService: true, disabledAt: true },
  });
  if (users.length !== userIds.length) throw notFound('User not found');
  for (const user of users) {
    if (user.isService) throw badRequest('A service account cannot be assigned work', 'NOT_ASSIGNABLE');
    if (user.disabledAt) throw badRequest('This account is disabled', 'NOT_ASSIGNABLE');
    const role = await effectiveProjectRole(user.id, user.role, projectId);
    if (!canContribute(role))
      throw badRequest('This person cannot be assigned work on this project', 'NOT_ASSIGNABLE');
  }
}

/**
 * Remplace la liste des personnes responsables d'une entité.
 *
 * `set` plutôt qu'`connect` : l'appelant envoie la liste qu'il veut voir, et deux
 * enregistrements concurrents ne peuvent pas laisser un assigné fantôme que personne
 * n'a choisi.
 */
export async function setAssignees(
  actor: SessionUser,
  kind: AssigneeKind,
  id: number,
  userIds: number[],
): Promise<AssigneeView[]> {
  const projectId = await resolveProject(kind, id);
  await assertProjectWritable(projectId);
  await assertProjectManage(actor.id, actor.role, projectId);
  const unique = [...new Set(userIds)];
  await assertAssignable(projectId, unique);

  const data = { assignees: { set: unique.map((userId) => ({ id: userId })) } };
  const include = { assignees: { select: ASSIGNEE_SELECT, orderBy: { id: 'asc' as const } } };
  const updated = await writeAssignees(kind, id, data, include);
  emitToProject(projectId, `${kind}:update`, { id });
  return signed(updated);
}

async function writeAssignees(
  kind: AssigneeKind,
  id: number,
  data: { assignees: { set: { id: number }[] } },
  include: { assignees: { select: typeof ASSIGNEE_SELECT; orderBy: { id: 'asc' } } },
): Promise<RawAssignee[]> {
  switch (kind) {
    case 'episode':
      return (await prisma.episode.update({ where: { id }, data, include })).assignees;
    case 'sequence':
      return (await prisma.sequence.update({ where: { id }, data, include })).assignees;
    case 'shot':
      return (await prisma.shot.update({ where: { id }, data, include })).assignees;
    case 'asset':
      return (await prisma.asset.update({ where: { id }, data, include })).assignees;
  }
}

/**
 * Toutes les personnes d'un périmètre, l'entité et ses enfants compris.
 *
 * C'est ce que l'en-tête d'une page de séquence montre : « qui travaille là-dessus »
 * n'a pas de sens s'il s'arrête à la séquence elle-même — le travail est sur ses plans,
 * et sur les tâches de ses plans. Trois sources donc, fusionnées et dédoublonnées, avec
 * l'origine de chacune pour que l'écran puisse la dire.
 */
export interface ScopeAssignee extends RawAssignee {
  /** `direct` = posé sur l'entité ; `child` = sur un enfant ; `task` = sur une tâche. */
  origins: ('direct' | 'child' | 'task')[];
  /** Nombre d'éléments qui rattachent cette personne au périmètre (pour trier). */
  count: number;
}

export async function scopeAssignees(
  kind: AssigneeKind,
  id: number,
): Promise<(AssigneeView & { origins: ScopeAssignee['origins']; count: number })[]> {
  const collected = new Map<number, ScopeAssignee>();
  const add = (user: RawAssignee, origin: 'direct' | 'child' | 'task') => {
    const existing = collected.get(user.id);
    if (existing) {
      if (!existing.origins.includes(origin)) existing.origins.push(origin);
      existing.count += 1;
      return;
    }
    collected.set(user.id, { ...user, origins: [origin], count: 1 });
  };

  for (const user of await directAssignees(kind, id)) add(user, 'direct');
  for (const user of await childAssignees(kind, id)) add(user, 'child');
  for (const user of await taskAssignees(kind, id)) add(user, 'task');

  // Les responsables directs d'abord, puis le plus impliqué : c'est l'ordre dans lequel on
  // cherche quelqu'un quand on ouvre une séquence.
  const ordered = [...collected.values()].sort((a, b) => {
    const direct = Number(b.origins.includes('direct')) - Number(a.origins.includes('direct'));
    return direct !== 0 ? direct : b.count - a.count;
  });
  const photos = await signed(ordered);
  return ordered.map((person, index) => ({
    ...photos[index]!,
    origins: person.origins,
    count: person.count,
  }));
}

async function directAssignees(kind: AssigneeKind, id: number): Promise<RawAssignee[]> {
  const select = { assignees: { select: ASSIGNEE_SELECT } };
  switch (kind) {
    case 'episode':
      return (await prisma.episode.findUnique({ where: { id }, select }))?.assignees ?? [];
    case 'sequence':
      return (await prisma.sequence.findUnique({ where: { id }, select }))?.assignees ?? [];
    case 'shot':
      return (await prisma.shot.findUnique({ where: { id }, select }))?.assignees ?? [];
    case 'asset':
      return (await prisma.asset.findUnique({ where: { id }, select }))?.assignees ?? [];
  }
}

/** Les responsables posés sur les enfants — un plan n'en a pas, un asset non plus. */
async function childAssignees(kind: AssigneeKind, id: number): Promise<RawAssignee[]> {
  if (kind === 'shot' || kind === 'asset') return [];
  const shots = await prisma.shot.findMany({
    where:
      kind === 'episode'
        ? { sequence: { episodeId: id }, deletedAt: null, hiddenAt: null }
        : { sequenceId: id, deletedAt: null, hiddenAt: null },
    select: { assignees: { select: ASSIGNEE_SELECT } },
  });
  const sequences =
    kind === 'episode'
      ? await prisma.sequence.findMany({
          where: { episodeId: id, deletedAt: null, hiddenAt: null },
          select: { assignees: { select: ASSIGNEE_SELECT } },
        })
      : [];
  return [...shots, ...sequences].flatMap((row) => row.assignees);
}

/** Les assignés des tâches du périmètre : le travail réel, celui qui a un statut. */
async function taskAssignees(kind: AssigneeKind, id: number): Promise<RawAssignee[]> {
  const where =
    kind === 'asset'
      ? { assetId: id }
      : kind === 'shot'
        ? { shotId: id }
        : kind === 'sequence'
          ? { shot: { sequenceId: id, deletedAt: null, hiddenAt: null } }
          : { shot: { sequence: { episodeId: id }, deletedAt: null, hiddenAt: null } };
  const tasks = await prisma.task.findMany({
    where: { ...where, assigneeId: { not: null } },
    select: { assignee: { select: ASSIGNEE_SELECT } },
  });
  return tasks.map((t) => t.assignee).filter((u): u is RawAssignee => u !== null);
}
