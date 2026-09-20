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
 * Le contrat de mise en page du tableau plein écran (Phase 50).
 *
 * Trois fautes précises sont fermées ici, et ce sont des classes qui les portaient :
 *  - la colonne était haute de 68 % de la FENÊTRE, si bien que cinq familles empilées
 *    débordaient de trois écrans ;
 *  - chaque famille portait sa PROPRE bande horizontale, donc deux colonnes de deux
 *    familles ne se retrouvaient jamais l'une sous l'autre et chaque bande défilait seule ;
 *  - `overscroll-contain` coupait le chaînage de la molette : prise sur une colonne dense,
 *    elle ne faisait plus rien du tout une fois la pile au bout.
 *
 * Un test de classes est un test de contrat : il ne dit pas que l'écran est beau, il dit que
 * ces trois fautes n'ont pas été réintroduites — ce qu'aucune capture ne garantirait dans six
 * mois.
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

describe('mise en page du tableau', () => {
  it('ne porte aucune bande horizontale : c’est la page qui en tient une seule', () => {
    const view = mount();
    expect(view.container.querySelectorAll('[class*="overflow-x-auto"]')).toHaveLength(0);
  });

  it('borne la pile de cartes sur la hauteur reçue, jamais sur celle de la fenêtre', () => {
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

  it('repliée, la famille ne montre plus aucune colonne mais compte encore ses cartes', () => {
    const view = mount(true);
    expect(view.container.querySelectorAll('[class*="overflow-y-auto"]')).toHaveLength(0);
    expect(view.container.textContent).toContain('2');
  });
});
