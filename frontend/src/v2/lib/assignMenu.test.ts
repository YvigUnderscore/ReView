// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import type { MessageKey } from '../i18n';
import { UNASSIGNED, assignBody, assignGroups, departmentsOf } from './assignMenu';

const t = (key: MessageKey) => key;
const members = [
  { id: 3, name: 'Alice' },
  { id: 4, name: 'Bob' },
];

describe('departmentsOf', () => {
  it('réunit les étapes déclarées et celles portées par les tâches', () => {
    const departments = departmentsOf(
      [
        { id: 1, name: 'Modeling' },
        { id: 2, name: 'Compositing' },
      ],
      [{ departmentId: 2, assignee: { id: 3 } }],
    );
    expect(departments).toEqual([
      { id: 1, name: 'Modeling', hasTask: false, assigneeId: null },
      { id: 2, name: 'Compositing', hasTask: true, assigneeId: 3 },
    ]);
  });

  it('ignore une tâche sans département', () => {
    const departments = departmentsOf(
      [{ id: 1, name: 'Modeling' }],
      [{ departmentId: null, assignee: null }],
    );
    expect(departments[0].hasTask).toBe(false);
  });

  it('garde le premier assigné quand plusieurs tâches partagent l’étape', () => {
    const departments = departmentsOf(
      [{ id: 1, name: 'Modeling' }],
      [
        { departmentId: 1, assignee: { id: 3 } },
        { departmentId: 1, assignee: { id: 4 } },
      ],
    );
    expect(departments[0].assigneeId).toBe(3);
  });
});

describe('assignGroups', () => {
  const departments = [
    { id: 1, name: 'Modeling', hasTask: true, assigneeId: 3 },
    { id: 2, name: 'Compositing', hasTask: false, assigneeId: null },
  ];

  it('coche la personne déjà sur la tâche', () => {
    const [modeling] = assignGroups(departments, members, { linked: false, t });
    expect(modeling.value).toBe('3');
    // Chaque personne, plus le retrait.
    expect(modeling.items).toHaveLength(3);
    expect(modeling.items.at(-1)?.value).toBe(UNASSIGNED);
  });

  it('n’active pas une étape sans tâche sur un projet piloté depuis ShotGrid', () => {
    // La tâche doit naître sur le site ; masquer l'étape laisserait croire que le pipe
    // ne la prévoit pas.
    const [, compositing] = assignGroups(departments, members, { linked: true, t });
    expect(compositing.disabled).toBe(true);
    const [modeling] = assignGroups(departments, members, { linked: true, t });
    expect(modeling.disabled).toBe(false);
  });

  it('laisse tout actif hors projet relié — la tâche manquante sera créée', () => {
    const groups = assignGroups(departments, members, { linked: false, t });
    expect(groups.every((g) => !g.disabled)).toBe(true);
  });
});

describe('assignBody', () => {
  it('cible le département choisi', () => {
    expect(assignBody(2, '4')).toEqual({ userId: 4, departmentIds: [2] });
  });

  it('traduit le retrait en assigné nul', () => {
    expect(assignBody(2, UNASSIGNED)).toEqual({ userId: null, departmentIds: [2] });
  });
});
