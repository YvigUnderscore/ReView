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
  it('gathers the declared steps and those carried by the tasks', () => {
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

  it('ignores a task without a department', () => {
    const departments = departmentsOf(
      [{ id: 1, name: 'Modeling' }],
      [{ departmentId: null, assignee: null }],
    );
    expect(departments[0].hasTask).toBe(false);
  });

  it('keeps the first assignee when several tasks share the step', () => {
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

  it('ticks the person already on the task', () => {
    const [modeling] = assignGroups(departments, members, { linked: false, t });
    expect(modeling.value).toBe('3');
    // Each person, plus the removal.
    expect(modeling.items).toHaveLength(3);
    expect(modeling.items.at(-1)?.value).toBe(UNASSIGNED);
  });

  it('does not enable a step without a task on a project driven from ShotGrid', () => {
    // The task must be born on the site; hiding the step would suggest the pipeline
    // does not plan it.
    const [, compositing] = assignGroups(departments, members, { linked: true, t });
    expect(compositing.disabled).toBe(true);
    const [modeling] = assignGroups(departments, members, { linked: true, t });
    expect(modeling.disabled).toBe(false);
  });

  it('leaves everything active off a linked project — the missing task will be created', () => {
    const groups = assignGroups(departments, members, { linked: false, t });
    expect(groups.every((g) => !g.disabled)).toBe(true);
  });
});

describe('assignBody', () => {
  it('targets the chosen department', () => {
    expect(assignBody(2, '4')).toEqual({ userId: 4, departmentIds: [2] });
  });

  it('translates the removal into a null assignee', () => {
    expect(assignBody(2, UNASSIGNED)).toEqual({ userId: null, departmentIds: [2] });
  });
});
