// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import {
  canWriteTask,
  parseTaskPolicy,
  writableDepartments,
  type TaskWriteContext,
} from './taskDepartmentPolicy';

/** Un artiste d'animation (département 1), sous la politique restreinte. */
const artist = (over: Partial<TaskWriteContext> = {}): TaskWriteContext => ({
  policy: 'department',
  isManager: false,
  userDepartmentIds: [1],
  taskDepartmentId: 1,
  isAssignee: false,
  ...over,
});

describe('parseTaskPolicy', () => {
  it('retombe sur « ouvert » — ce que ReView faisait avant que la règle existe', () => {
    expect(parseTaskPolicy(null)).toBe('open');
    expect(parseTaskPolicy('n’importe quoi')).toBe('open');
    expect(parseTaskPolicy('department')).toBe('department');
  });
});

describe('canWriteTask', () => {
  it('laisse écrire sur une tâche de son département', () => {
    expect(canWriteTask(artist())).toBe(true);
  });

  it('refuse une tâche d’un autre département', () => {
    expect(canWriteTask(artist({ taskDepartmentId: 2 }))).toBe(false);
  });

  it('laisse écrire sur une tâche qu’on lui a confiée, quel qu’en soit le département', () => {
    // « Si leur département OU leur profil n'a pas la task » : l'assignation suffit.
    expect(canWriteTask(artist({ taskDepartmentId: 2, isAssignee: true }))).toBe(true);
  });

  it('laisse une tâche sans département ouverte — sinon elle serait immodifiable', () => {
    // C'est le cas d'une tâche née d'un retour de review.
    expect(canWriteTask(artist({ taskDepartmentId: null }))).toBe(true);
  });

  it('n’entrave jamais un gestionnaire : intervenir partout est son métier', () => {
    expect(canWriteTask(artist({ isManager: true, taskDepartmentId: 9 }))).toBe(true);
  });

  it("n'élargit rien en mode ouvert : la règle historique — l'assigné, et lui seul", () => {
    // L'ouvrir ici donnerait à tout artiste la main sur toutes les tâches du projet.
    expect(canWriteTask(artist({ policy: 'open', taskDepartmentId: 9 }))).toBe(false);
    expect(canWriteTask(artist({ policy: 'open', taskDepartmentId: 9, isAssignee: true }))).toBe(true);
  });

  it('refuse quelqu’un sans aucun département', () => {
    expect(canWriteTask(artist({ userDepartmentIds: [] }))).toBe(false);
  });
});

describe('writableDepartments', () => {
  const pipe = [{ id: 1 }, { id: 2 }, { id: 3 }];

  it('réduit la liste aux étapes de la personne — la lisibilité promise', () => {
    expect(
      writableDepartments(pipe, { policy: 'department', isManager: false, userDepartmentIds: [2] }),
    ).toEqual([2]);
  });

  it('rend le pipe entier à un gestionnaire', () => {
    expect(
      writableDepartments(pipe, { policy: 'department', isManager: true, userDepartmentIds: [2] }),
    ).toEqual([1, 2, 3]);
  });

  it('rend le pipe entier quand la politique est ouverte', () => {
    expect(writableDepartments(pipe, { policy: 'open', isManager: false, userDepartmentIds: [] })).toEqual([
      1, 2, 3,
    ]);
  });
});
