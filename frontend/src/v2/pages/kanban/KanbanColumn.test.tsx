// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { DndContext, useDndContext } from '@dnd-kit/core';
import KanbanColumn from './KanbanColumn';
import { CARD_ESTIMATE } from './kanbanVirtual';
import type { Column } from './kanbanColumns';
import type { BoardTask } from './kanbanTypes';

/**
 * La colonne dense reste une cible de dépôt (vague 2 — échelle).
 *
 * C'est le point délicat de la virtualisation : ne plus monter les cartes ne doit pas
 * faire disparaître la colonne du contexte de glisser-déposer, sinon un board de
 * long-métrage n'accepterait plus aucun dépôt. Et le compteur d'en-tête doit continuer
 * d'annoncer la colonne entière, pas la fenêtre montée.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const VIEWPORT = 700;
const heightOf = (el: Element) => (el.hasAttribute('data-index') ? CARD_ESTIMATE : VIEWPORT);
Element.prototype.getBoundingClientRect = function stubbedRect(this: Element) {
  const height = heightOf(this);
  return { x: 0, y: 0, top: 0, left: 0, right: 256, bottom: height, width: 256, height } as DOMRect;
};
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
  configurable: true,
  get(this: HTMLElement) {
    return heightOf(this);
  },
});
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 256 });

const column: Column = {
  id: '42',
  label: 'On Hold',
  statusId: 42,
  legacyStatus: 'TODO',
  color: '#8899aa',
  family: 'todo',
};

const makeTasks = (n: number): BoardTask[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `task ${i + 1}`,
    type: 'COMPOSITING',
    status: 'TODO',
    pipelineStatusId: 42,
    department: null,
    departmentId: null,
    assignee: null,
    dueDate: null,
    versionCount: 0,
    parentKind: 'shot',
    parentId: i + 1,
    parentLabel: `SH${i + 1}`,
    sequenceId: null,
  }));

/** Rapporte les zones de dépôt que dnd-kit connaît réellement. */
function DroppableProbe({ onRead }: { onRead: (ids: string[]) => void }) {
  const { droppableContainers } = useDndContext();
  onRead([...droppableContainers].map(([id]) => String(id)));
  return null;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(tasks: BoardTask[]) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  let droppables: string[] = [];
  act(() => {
    root?.render(
      <MemoryRouter>
        <DndContext>
          <KanbanColumn column={column} tasks={tasks} />
          <DroppableProbe
            onRead={(ids) => {
              droppables = ids;
            }}
          />
        </DndContext>
      </MemoryRouter>,
    );
  });
  return { host, droppables: () => droppables };
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('KanbanColumn', () => {
  it('reste une zone de dépôt quand ses mille cartes ne sont plus montées', () => {
    const view = render(makeTasks(1000));
    expect(view.droppables()).toContain('42');
    expect(view.host.querySelectorAll('a[href^="/tasks/"]').length).toBeLessThan(40);
  });

  it('annonce la colonne entière, pas la fenêtre montée', () => {
    const view = render(makeTasks(1000));
    expect(view.host.textContent).toContain('1000');
    expect(view.host.textContent).toContain('On Hold');
  });

  it('monte tout et reste déposable quand la colonne est courte', () => {
    const view = render(makeTasks(4));
    expect(view.droppables()).toContain('42');
    expect(view.host.querySelectorAll('a[href^="/tasks/"]')).toHaveLength(4);
  });
});
