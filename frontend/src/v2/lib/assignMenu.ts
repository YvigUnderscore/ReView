// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MessageKey } from '../i18n';
import type { MenuRadioItem } from './menuSpec';

/**
 * Construction du sous-menu « Assigner » — logique pure, sans React ni réseau.
 *
 * Le geste s'énonce « assigner Alice à cet asset », mais ce qui s'écrit est l'assignation
 * d'une **tâche** : un asset n'a pas de responsable, chacune de ses étapes en a un. Le menu
 * reflète donc le pipeline — un niveau par département, puis les personnes.
 */

export const UNASSIGNED = 'none';

export interface AssignDepartment {
  id: number;
  name: string;
  /** Vrai si l'entité porte déjà une tâche pour ce département. */
  hasTask: boolean;
  /** Personne actuellement sur cette tâche, s'il y en a une. */
  assigneeId: number | null;
}

export interface AssignMember {
  id: number;
  name: string;
}

export interface AssignGroup {
  departmentId: number;
  label: string;
  /** Vrai quand le geste est impossible : projet piloté depuis ShotGrid, tâche absente. */
  disabled: boolean;
  items: MenuRadioItem[];
  value: string;
}

/**
 * Un groupe par département assignable.
 *
 * Sur un projet piloté depuis ShotGrid, les départements sans tâche sont montrés mais
 * désactivés : la tâche doit naître là-bas, et masquer l'entrée laisserait croire que
 * l'étape n'existe pas — alors que le pipe la prévoit.
 */
export function assignGroups(
  departments: AssignDepartment[],
  members: AssignMember[],
  options: { linked: boolean; t: (key: MessageKey) => string },
): AssignGroup[] {
  return departments.map((department) => ({
    departmentId: department.id,
    label: department.name,
    disabled: options.linked && !department.hasTask,
    value: department.assigneeId != null ? String(department.assigneeId) : UNASSIGNED,
    items: [
      ...members.map((member) => ({
        id: `assign-${department.id}-${member.id}`,
        value: String(member.id),
        label: member.name,
      })),
      {
        id: `assign-${department.id}-none`,
        value: UNASSIGNED,
        label: options.t('assign.unassigned'),
      },
    ],
  }));
}

/** Le corps envoyé au serveur pour un choix donné. */
export function assignBody(
  departmentId: number,
  value: string,
): { userId: number | null; departmentIds: number[] } {
  return {
    userId: value === UNASSIGNED ? null : Number(value),
    departmentIds: [departmentId],
  };
}

/**
 * Les départements d'une entité, vus depuis ses tâches.
 *
 * Une entité peut porter une tâche dans un département qu'elle ne « déclare » pas : le
 * pipe évolue, les tâches restent. Les deux sources sont donc réunies, sans doublon.
 */
export function departmentsOf(
  declared: { id: number; name: string }[],
  tasks: {
    departmentId: number | null;
    departmentRef?: { id: number; name: string } | null;
    assignee: { id: number } | null;
  }[],
): AssignDepartment[] {
  const byId = new Map<number, AssignDepartment>();
  for (const d of declared) {
    byId.set(d.id, { id: d.id, name: d.name, hasTask: false, assigneeId: null });
  }
  for (const task of tasks) {
    if (task.departmentId == null) continue;
    let existing = byId.get(task.departmentId);
    // Une tâche peut vivre dans une étape que l'entité ne déclare pas : le pipe évolue,
    // les tâches restent. L'omettre priverait le menu de la seule étape réellement en
    // cours sur l'entité.
    if (!existing && task.departmentRef) {
      existing = {
        id: task.departmentRef.id,
        name: task.departmentRef.name,
        hasTask: false,
        assigneeId: null,
      };
      byId.set(existing.id, existing);
    }
    if (existing) {
      existing.hasTask = true;
      // Plusieurs tâches dans le même département : la première assignée fait foi pour
      // la coche — le menu montre un état, il ne prétend pas résumer toutes les tâches.
      existing.assigneeId ??= task.assignee?.id ?? null;
    }
  }
  return [...byId.values()];
}
