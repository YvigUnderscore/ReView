// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { DndContext } from '@dnd-kit/core';
import { cleanup, render } from '@testing-library/react';
import KanbanFamily from './KanbanFamily';
import type { FamilyGroup } from './kanbanColumns';
import type { BoardTask } from './kanbanTypes';

/**
 * The layout contract of the full-screen board (Phase 50).
 *
 * Three precise defects are closed here, and they were carried by classes:
 *  - the column was 68% of the WINDOW high, so five stacked families overflowed by three screens;
 *  - each family had its OWN horizontal strip, so two columns from two families never ended up
 *    one beneath the other, and each strip scrolled on its own;
 *  - `overscroll-contain` cut the wheel chaining: on a dense column it did nothing at all once
 *    the stack was at its end.
 *
 * A class test is a contract test: it does not say the screen is beautiful, it says that these
 * three defects were not reintroduced, which no screenshot would guarantee six months later.
 */

const group: FamilyGroup = {
  key: 'todo',
  columns: [
    { id: '1', label: 'Waiting to Start', statusId: 1, legacyStatus: 'TODO', color: null, family: 'todo' },
    { id: '2', label: 'On Hold', statusId: 2, legacyStatus: 'TODO', color: null, family: 'todo' },
  ],
};

const task = (id: number): BoardTask => ({
  id,
  name: `task ${id}`,
  type: 'COMPOSITING',
  status: 'TODO',
  pipelineStatusId: 1,
  department: null,
  departmentId: null,
  assignee: null,
  dueDate: null,
  versionCount: 0,
  parentKind: 'shot',
  parentId: id,
  parentLabel: `SH${id}`,
  sequenceId: null,
});

const mount = (collapsed = false) =>
  render(
    <MemoryRouter>
      <DndContext>
        <KanbanFamily
          group={group}
          tasksByColumn={new Map([['1', [task(1), task(2)]]])}
          collapsed={collapsed}
          onToggle={() => undefined}
        />
      </DndContext>
    </MemoryRouter>,
  );

afterEach(cleanup);

describe('board layout', () => {
  it('carries no horizontal strip: it is the page that keeps a single one', () => {
    const view = mount();
    expect(view.container.querySelectorAll('[class*="overflow-x-auto"]')).toHaveLength(0);
  });

  it('bounds the card stack on the height received, never on the window height', () => {
    const view = mount();
    const scrollers = [...view.container.querySelectorAll('[class*="overflow-y-auto"]')];
    expect(scrollers).toHaveLength(2);
    for (const scroller of scrollers) {
      expect(scroller.className).toContain('flex-1');
      expect(scroller.className).toContain('min-h-0');
      expect(scroller.className).not.toContain('vh]');
      expect(scroller.className).not.toContain('overscroll-contain');
    }
  });

  it('when folded, the family no longer shows any column but still counts its cards', () => {
    const view = mount(true);
    expect(view.container.querySelectorAll('[class*="overflow-y-auto"]')).toHaveLength(0);
    expect(view.container.textContent).toContain('2');
  });
});
