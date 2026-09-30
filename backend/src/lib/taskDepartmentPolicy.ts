// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Qui peut écrire sur une tâche, selon son département.
 *
 * Un studio de trente personnes et douze étapes propose à chaque artiste la totalité du
 * pipe : une liste de douze départements pour quelqu'un qui n'en touche qu'un, et rien
 * n'empêche l'animateur de faire avancer une tâche de compositing par mégarde.
 *
 * La règle est **lisible en une phrase** : un artiste écrit sur les tâches de ses
 * départements, et sur celles qu'on lui a confiées. Il voit toutes les autres — la
 * production a besoin que chacun sache où en sont les étapes voisines, et masquer le
 * travail des autres n'a jamais aidé personne à faire le sien.
 *
 * Les gestionnaires (ADMIN, SUPERVISOR) ne sont pas concernés : leur métier est
 * précisément d'intervenir partout.
 *
 * Logique pure : la décision se teste sans base, et les deux appelants (création et mise à
 * jour) ne peuvent pas diverger.
 */

export const TASK_POLICIES = ['open', 'department'] as const;
export type TaskPolicy = (typeof TASK_POLICIES)[number];

/** Le défaut : ce que faisait ReView avant que la règle existe. */
export const DEFAULT_TASK_POLICY: TaskPolicy = 'open';

export function parseTaskPolicy(raw: string | null | undefined): TaskPolicy {
  return raw === 'department' ? 'department' : DEFAULT_TASK_POLICY;
}

export interface TaskWriteContext {
  policy: TaskPolicy;
  /** Vrai pour un ADMIN ou un SUPERVISOR (rôle effectif sur le projet). */
  isManager: boolean;
  /** Départements de la personne. */
  userDepartmentIds: number[];
  /** Département de la tâche visée — null pour une tâche sans étape. */
  taskDepartmentId: number | null;
  /** La personne est-elle l'assignée de cette tâche ? */
  isAssignee: boolean;
}

/**
 * La personne peut-elle écrire sur cette tâche ?
 *
 * En mode `open`, la règle historique s'applique telle quelle : **seul l'assigné** touche à
 * sa tâche. Le mode `department` l'**élargit** — l'artiste écrit aussi sur les tâches de ses
 * étapes, ce qui est précisément ce qu'un lead d'animation attend de son département.
 *
 * Dans les deux cas, ce qu'un non-gestionnaire peut *changer* reste borné au statut et à la
 * checklist : cette fonction dit à quelles tâches il a accès, pas ce qu'il peut y écrire.
 *
 * Une tâche **sans département** est ouverte sous la politique restreinte : elle
 * n'appartient à aucune étape, donc à personne en particulier, et la refuser à tout le
 * monde la rendrait immodifiable — c'est le cas d'une tâche née d'un retour de review.
 */
export function canWriteTask(ctx: TaskWriteContext): boolean {
  if (ctx.isManager || ctx.isAssignee) return true;
  // Mode ouvert : rien n'est élargi. L'ouvrir ici donnerait à tout artiste la main sur
  // toutes les tâches du projet — l'inverse de ce que la politique cherche à obtenir.
  if (ctx.policy === 'open') return false;
  if (ctx.taskDepartmentId === null) return true;
  return ctx.userDepartmentIds.includes(ctx.taskDepartmentId);
}

/**
 * Les départements dans lesquels la personne peut créer une tâche.
 *
 * C'est ce que l'écran propose — et c'est là que se gagne la lisibilité promise : une liste
 * de deux étapes plutôt que de douze. Un gestionnaire garde le pipe entier.
 */
export function writableDepartments(
  all: { id: number }[],
  ctx: Pick<TaskWriteContext, 'policy' | 'isManager' | 'userDepartmentIds'>,
): number[] {
  if (ctx.policy === 'open' || ctx.isManager) return all.map((d) => d.id);
  return all.filter((d) => ctx.userDepartmentIds.includes(d.id)).map((d) => d.id);
}
