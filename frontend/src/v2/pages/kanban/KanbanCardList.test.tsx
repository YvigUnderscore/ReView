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
 * La colonne dense (vague 2 — échelle).
 *
 * Une colonne de long-métrage compte des centaines de cartes ; elle en montait soixante
 * puis renonçait. Ce qui est vérifié ici : la petite colonne n'a pas changé, la grande ne
 * monte que sa fenêtre sans mentir sur son volume, on atteint la millième carte en
 * faisant défiler, la carte tenue à la souris reste montée même sortie de la fenêtre, et
 * le menu contextuel n'est reconstruit que s'il a changé.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * happy-dom ne fait aucune mise en page : sans tailles, la pile mesurerait zéro pixel et
 * le virtualiseur ne monterait rien. On lui donne une colonne de 700 px et des cartes de
 * 64 px, ce que mesure le navigateur.
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

/** Identifiants des tâches effectivement montées, dans l'ordre du DOM. */
const mountedIds = (el: HTMLElement) =>
  [...el.querySelectorAll('a[href^="/tasks/"]')].map((a) => Number(a.getAttribute('href')?.slice(7)));

describe('KanbanCardList — colonne peu chargée', () => {
  it('monte toutes ses cartes, dans l’ordre, sans machinerie de virtualisation', () => {
    const el = render(makeTasks(VIRTUALIZE_FROM));
    expect(mountedIds(el)).toEqual(makeTasks(VIRTUALIZE_FROM).map((t) => t.id));
    expect(el.querySelectorAll('[data-index]')).toHaveLength(0);
  });

  it('enveloppe chaque carte de son menu contextuel quand il y a des entrées', () => {
    const withMenu = render(makeTasks(5), { menuFor: statusMenu });
    expect(withMenu.querySelectorAll('[aria-label="Actions menu"]')).toHaveLength(5);
  });

  it('n’enveloppe rien quand le menu est vide (lecteur sans droit d’écriture)', () => {
    const withoutMenu = render(makeTasks(5), { menuFor: () => [] });
    expect(withoutMenu.querySelectorAll('[aria-label="Actions menu"]')).toHaveLength(0);
    expect(mountedIds(withoutMenu)).toHaveLength(5);
  });
});

describe('KanbanCardList — colonne dense', () => {
  const tasks = makeTasks(400);

  it('ne monte que la fenêtre visible, sans mentir sur le volume', () => {
    const el = render(tasks);
    const mounted = mountedIds(el);
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThan(40);
    expect(mounted[0]).toBe(1);
    // La cale porte la hauteur de toute la pile : l'ascenseur dit la vérité.
    const spacer = el.querySelector('div[style*="height"]');
    expect(spacer?.getAttribute('style')).toContain(`height: ${400 * CARD_ESTIMATE}px`);
  });

  it('atteint les cartes du fond, que l’ancien plafond de soixante rendait inaccessibles', () => {
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

  it('garde montée la carte tenue à la souris, même sortie de la fenêtre', () => {
    // La zone de dépôt est la colonne, pas la carte : ce qui se perdrait sans ça, c'est
    // l'aperçu suivi par le curseur et le grisé de la carte d'origine.
    const el = render(tasks, { activeTaskId: 380 });
    const mounted = mountedIds(el);
    expect(mounted[0]).toBe(1);
    expect(mounted).toContain(380);
    expect(mounted.length).toBeLessThan(40);
  });
});

describe('KanbanCardList — mémoïsation', () => {
  it('ne re-rend pas une carte dont rien n’a changé', () => {
    // Le rendu d'une carte se compte à la lecture de son libellé : `KanbanCardBody` lit
    // `name` une fois par rendu. Sans mémoïsation, la moindre frappe dans la recherche
    // rejouerait les vingt cartes montées de chacune des quinze colonnes.
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

    // Rien n'a bougé : la pile entière est court-circuitée.
    render(tasks, { menuFor: statusMenu });
    expect(reads).toBe(first);

    // Une voisine change de statut (déplacement optimiste, clic droit) : la liste se
    // rend, mais la carte restée identique ne se rend pas.
    const moved = tasks.map((task) => (task.id === 2 ? { ...task, status: 'IN_PROGRESS' as const } : task));
    render(moved, { menuFor: statusMenu });
    expect(reads).toBe(first);
    expect(mountedIds(host as HTMLElement)).toEqual([1, 2, 3]);
  });

  it('ne reconstruit pas les menus quand rien n’a changé, et les reconstruit sinon', () => {
    const tasks = makeTasks(8);
    let built = 0;
    const menuFor = (task: BoardTask) => {
      built += 1;
      return statusMenu(task);
    };
    render(tasks, { menuFor });
    const first = built;
    expect(first).toBe(8);

    // Même tâches, même constructeur : les cartes ne se rendent pas du tout.
    render(tasks, { menuFor });
    expect(built).toBe(first);

    // Constructeur neuf (droits obtenus, référentiel changé, langue changée) : les menus
    // repartent — la mémoïsation ne doit pas figer un menu périmé.
    const other = (task: BoardTask) => {
      built += 1;
      return statusMenu(task);
    };
    render(tasks, { menuFor: other });
    expect(built).toBe(first + 8);
  });
});
