// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { Role, TaskStatus } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { AppError, badRequest, notFound } from '../lib/errors';
import { assertProjectWritable } from '../lib/projectGuard';
import { assertProjectManage, canContribute, effectiveProjectRole } from '../lib/projectRoles';
import { sgStepToTaskType } from './shotgrid/shotgridMapper';
import type { SessionUser } from '../lib/shotgridAccess';
import * as DepartmentService from './DepartmentService';
import * as TaskService from './TaskService';

/**
 * Assigner quelqu'un à un asset ou à un plan.
 *
 * Un asset ne porte pas d'assigné, et n'en portera pas : le travail est réparti par
 * étape, et c'est la **tâche** qui a un responsable. ShotGrid le pose de la même façon
 * (`task_assignees` vit sur `Task`), donc lui ajouter un champ propre ferait diverger les
 * deux modèles au premier aller-retour.
 *
 * « Assigner Alice à cet asset » s'écrit donc : pour chaque département visé, poser Alice
 * sur la tâche correspondante — et créer cette tâche si elle manque. Le raccourci est celui
 * du langage courant en production ; la donnée écrite, elle, reste celle du pipeline.
 */

export type AssignHolder = 'asset' | 'shot';

export interface AssignInput {
  holder: AssignHolder;
  id: number;
  /** `null` désassigne. */
  userId: number | null;
  /** Départements visés. Vide = tous ceux que l'entité traverse déjà. */
  departmentIds?: number[];
}

export interface AssignResult {
  /** Tâches réellement modifiées. */
  updated: number;
  /** Tâches créées faute d'exister — jamais sur un projet piloté depuis ShotGrid. */
  created: number;
}

/** Le projet de l'entité porteuse, et son existence. */
async function resolveProject(holder: AssignHolder, id: number): Promise<number> {
  const row =
    holder === 'asset'
      ? await prisma.asset.findFirst({ where: { id, deletedAt: null }, select: { projectId: true } })
      : await prisma.shot.findFirst({ where: { id, deletedAt: null }, select: { projectId: true } });
  if (!row) throw notFound(holder === 'asset' ? 'Asset not found' : 'Shot not found');
  return row.projectId;
}

/**
 * Qui peut recevoir du travail.
 *
 * Trois refus, tous silencieux jusqu'ici parce que rien ne les vérifiait : un compte de
 * service (une identité machine n'ouvre pas Maya), un client (il commente, il ne livre
 * pas), et quelqu'un qui n'est pas membre du projet — l'assigner l'avertirait d'un travail
 * qu'il ne peut même pas ouvrir.
 */
async function assertAssignable(projectId: number, userId: number): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isService: true },
  });
  if (!user) throw notFound('User not found');
  if (user.isService) throw badRequest('A service account cannot be assigned work', 'NOT_ASSIGNABLE');
  const role = await effectiveProjectRole(user.id, user.role, projectId);
  if (!canContribute(role))
    throw badRequest('This person cannot be assigned work on this project', 'NOT_ASSIGNABLE');
}

/** Le projet est-il piloté depuis ShotGrid ? On n'y crée alors aucune tâche. */
async function isDrivenByShotgrid(projectId: number): Promise<boolean> {
  const connection = await prisma.shotgridConnection.findUnique({
    where: { projectId },
    select: { active: true },
  });
  return Boolean(connection?.active);
}

/**
 * Assigne une personne sur l'entité, département par département.
 *
 * Sans département précisé, on vise les tâches existantes de l'entité : c'est le cas
 * courant — « donne cet asset à Alice » veut dire « tout ce qu'il reste à y faire ».
 */
export async function assignEntity(user: SessionUser, input: AssignInput): Promise<AssignResult> {
  const projectId = await resolveProject(input.holder, input.id);
  await assertProjectWritable(projectId);
  await assertProjectManage(user.id, user.role, projectId);
  if (input.userId !== null) await assertAssignable(projectId, input.userId);

  const departmentIds = input.departmentIds ?? [];
  if (departmentIds.length > 0) await DepartmentService.assertDepartmentsOfProject(projectId, departmentIds);

  const where = input.holder === 'asset' ? { assetId: input.id } : { shotId: input.id };
  const tasks = await prisma.task.findMany({
    where: {
      ...where,
      ...(departmentIds.length > 0 ? { departmentId: { in: departmentIds } } : {}),
    },
    select: { id: true, assigneeId: true, departmentId: true },
  });

  let created = 0;
  const targets = tasks.map((t) => t.id);

  // Départements demandés qui n'ont pas encore de tâche : on la crée, sauf si le pipeline
  // est piloté depuis ShotGrid — la tâche doit naître là-bas, sinon la synchronisation
  // suivante en verrait deux.
  const missing = departmentIds.filter((d) => !tasks.some((t) => t.departmentId === d));
  if (missing.length > 0) {
    if (await isDrivenByShotgrid(projectId)) {
      throw badRequest('This project is driven from ShotGrid: create the task there first', 'TASK_MISSING');
    }
    const departments = await DepartmentService.listForProject(projectId);
    for (const departmentId of missing) {
      const department = departments.find((d) => d.id === departmentId);
      if (!department) continue;
      const task = await prisma.task.create({
        data: {
          name: department.name,
          type: sgStepToTaskType(department.key),
          department: department.key,
          departmentId,
          status: TaskStatus.TODO,
          ...where,
        },
        select: { id: true },
      });
      targets.push(task.id);
      created += 1;
    }
  }

  if (targets.length === 0) throw badRequest('Nothing to assign on this entity', 'NO_TASK');

  let updated = 0;
  for (const taskId of targets) {
    const before = tasks.find((t) => t.id === taskId);
    // Rien à faire si la personne est déjà là : éviter la notification et l'envoi vers
    // ShotGrid qu'une écriture inutile déclencherait.
    if (before && before.assigneeId === input.userId) continue;
    await TaskService.setAssignee(user, projectId, taskId, input.userId);
    updated += 1;
  }

  // Un département sur lequel on assigne quelqu'un est un département que l'entité
  // traverse : le rattacher évite d'avoir à le déclarer une seconde fois à la main.
  if (departmentIds.length > 0) {
    await DepartmentService.attachHolderDepartments(input.holder, input.id, departmentIds);
  }

  return { updated, created };
}

/**
 * Même geste sur une sélection. L'accès est revérifié pour chaque entité : une sélection
 * peut traverser plusieurs projets, et un seul contrôle en tête laisserait passer les
 * autres.
 */
export async function assignMany(
  user: SessionUser,
  holder: AssignHolder,
  ids: number[],
  input: Omit<AssignInput, 'holder' | 'id'>,
): Promise<AssignResult & { skipped: number }> {
  let updated = 0;
  let created = 0;
  let skipped = 0;
  for (const id of ids) {
    try {
      const result = await assignEntity(user, { ...input, holder, id });
      updated += result.updated;
      created += result.created;
    } catch (err) {
      // Une entité inaccessible ou sans tâche ne fait pas échouer les autres : sur une
      // sélection de cinquante assets, tout perdre pour un seul serait absurde.
      if (isExpected(err)) skipped += 1;
      else throw err;
    }
  }
  return { updated, created, skipped };
}

/** Les refus attendus d'une entité isolée, qui ne doivent pas condamner la sélection. */
function isExpected(err: unknown): boolean {
  if (!(err instanceof AppError)) return false;
  return err.statusCode === 403 || err.statusCode === 404 || err.statusCode === 400;
}

/** Rôles proposables à l'assignation, pour l'interface. */
export const ASSIGNABLE_ROLES: Role[] = [Role.ADMIN, Role.SUPERVISOR, Role.ARTIST];
