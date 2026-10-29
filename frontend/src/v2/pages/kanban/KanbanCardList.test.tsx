// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { DndContext } from '@dnd-kit/core';
import KanbanCardList from './KanbanCardList';
import { CARD_ESTIMATE, VIRTUALIZE_FROM } from './kanbanVirtual';
import type { MenuEntry } from '../../lib/menuSpec';
import type { BoardTask } from './kanbanTypes';

/**
 * The dense column (wave 2, scale).
 *
 * A feature-film column holds hundreds of cards; it used to mount sixty and then give up. What is
 * verified here: the small column is unchanged, the large one mounts only its window without
 * misrepresenting its volume, the thousandth card is reachable by scrolling, the card held by the
 * mouse stays mounted even when out of the window, and the context menu is rebuilt only when it
 * has changed.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * happy-dom performs no layout: without sizes, the stack would measure zero pixels and the
 * virtualizer would mount nothing. We give it a 700 px column and 64 px cards, which is what the
 * browser measures.
 */
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

const makeTasks = (n: number): BoardTask[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    name: `task ${i + 1}`,
    type: 'COMPOSITING',
    status: 'TODO',
    pipelineStatusId: null,
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

const statusMenu = (task: BoardTask): MenuEntry[] => [
  { kind: 'action', id: 'open', label: `open ${task.id}`, onSelect: () => {} },
];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(
  tasks: BoardTask[],
  options: { menuFor?: (t: BoardTask) => MenuEntry[]; activeTaskId?: number } = {},
) {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  const current = root;
  act(() => {
    current?.render(
      <MemoryRouter>
        <DndContext>
          <KanbanCardList
            tasks={tasks}
            menuFor={options.menuFor}
            activeTaskId={options.activeTaskId ?? null}
          />
        </DndContext>
      </MemoryRouter>,
    );
  });
  return host;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** Identifiers of the tasks actually mounted, in DOM order. */
const mountedIds = (el: HTMLElement) =>
  [...el.querySelectorAll('a[href^="/tasks/"]')].map((a) => Number(a.getAttribute('href')?.slice(7)));

describe('KanbanCardList — lightly loaded column', () => {
  it('mounts all its cards, in order, with no virtualization machinery', () => {
    const el = render(makeTasks(VIRTUALIZE_FROM));
    expect(mountedIds(el)).toEqual(makeTasks(VIRTUALIZE_FROM).map((t) => t.id));
    expect(el.querySelectorAll('[data-index]')).toHaveLength(0);
  });

  it('wraps each card in its context menu when there are entries', () => {
    const withMenu = render(makeTasks(5), { menuFor: statusMenu });
    expect(withMenu.querySelectorAll('[aria-label="Actions menu"]')).toHaveLength(5);
  });

  it('wraps nothing when the menu is empty (reader without write rights)', () => {
    const withoutMenu = render(makeTasks(5), { menuFor: () => [] });
    expect(withoutMenu.querySelectorAll('[aria-label="Actions menu"]')).toHaveLength(0);
    expect(mountedIds(withoutMenu)).toHaveLength(5);
  });
});

describe('KanbanCardList — dense column', () => {
  const tasks = makeTasks(400);

  it('mounts only the visible window, without misrepresenting the volume', () => {
    const el = render(tasks);
    const mounted = mountedIds(el);
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(40);
    expect(mounted[0]).toBe(1);
    // The spacer carries the height of the whole stack: the scrollbar tells the truth.
    const spacer = el.querySelector('div[style*="height"]');
    expect(spacer?.getAttribute('style')).toContain(`height: ${400 * CARD_ESTIMATE}px`);
  });

  it('reaches the cards at the bottom, which the old ceiling of sixty made unreachable', () => {
    const el = render(tasks);
    expect(mountedIds(el)).not.toContain(300);
    const scroller = el.firstElementChild as HTMLElement;
    act(() => {
      scroller.scrollTop = 299 * CARD_ESTIMATE;
      scroller.dispatchEvent(new Event('scroll'));
    });
    const mounted = mountedIds(el);
    expect(mounted).toContain(300);
    expect(mounted).not.toContain(1);
  });

  it('keeps the card held by the mouse mounted, even when out of the window', () => {
    // The drop zone is the column, not the card: what would be lost without this is the preview
    // followed by the cursor and the greyed-out original card.
    const el = render(tasks, { activeTaskId: 380 });
    const mounted = mountedIds(el);
    expect(mounted[0]).toBe(1);
    expect(mounted).toContain(380);
    expect(mounted.length).toBeLessThan(40);
  });
});

describe('KanbanCardList — memoization', () => {
  it('does not re-render a card whose content has not changed', () => {
    // A card's rendering is counted by reading its label: `KanbanCardBody` reads `name` once per
    // render. Without memoization, the slightest keystroke in the search would replay the twenty
    // mounted cards of each of the fifteen columns.
    const tasks = makeTasks(3);
    const [watched] = tasks;
    const label = watched.name;
    let reads = 0;
    Object.defineProperty(watched, 'name', {
      configurable: true,
      get: () => {
        reads += 1;
        return label;
      },
    });

    render(tasks, { menuFor: statusMenu });
    const first = reads;
    expect(first).toBeGreaterThan(0);

    // Nothing has moved: the whole stack is short-circuited.
    render(tasks, { menuFor: statusMenu });
    expect(reads).toBe(first);

    // A neighbour changes status (optimistic move, right-click): the list renders, but the card
    // left identical does not.
    const moved = tasks.map((task) => (task.id === 2 ? { ...task, status: 'IN_PROGRESS' as const } : task));
    render(moved, { menuFor: statusMenu });
    expect(reads).toBe(first);
    expect(mountedIds(host as HTMLElement)).toEqual([1, 2, 3]);
  });

  it('does not rebuild the menus when nothing changed, and rebuilds them otherwise', () => {
    const tasks = makeTasks(8);
    let built = 0;
    const menuFor = (task: BoardTask) => {
      built += 1;
      return statusMenu(task);
    };
    render(tasks, { menuFor });
    const first = built;
    expect(first).toBe(8);

    // Same tasks, same builder: the cards do not render at all.
    render(tasks, { menuFor });
    expect(built).toBe(first);

    // New builder (rights obtained, reference data or language changed): the menus restart, since
    // memoization must not freeze a stale menu.
    const other = (task: BoardTask) => {
      built += 1;
      return statusMenu(task);
    };
    render(tasks, { menuFor: other });
    expect(built).toBe(first + 8);
  });
});
