// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import ProductionGrid from './ProductionGrid';
import { httpError, type MockRequest, type MockResolver } from '../../../../test/apiMock';
import { renderWithProviders } from '../../../../test/renderWithProviders';
import { t } from '../../../i18n';
import { COL_W_MIN, columnWidth } from './gridLayout';
import type { GridCell, GridRow, ProjectGrid } from './gridWire';

/**
 * L'écran que la grille remplace était jugé incompréhensible. Ce fichier verrouille les
 * quatre raisons pour lesquelles il l'était, et qu'elle corrige :
 *
 * - les colonnes portaient des clés techniques triées alphabétiquement, alors qu'un
 *   référentiel de départements ordonné existe ;
 * - une case vide pouvait aussi bien vouloir dire « à faire » que « rien à faire ici » ;
 * - les couleurs de statut n'étaient nommées nulle part : la case écrit désormais le nom
 *   de son statut, et garde sa couleur ;
 * - la maille séquence était le seul niveau offert, sans jamais descendre au plan.
 */

/**
 * happy-dom ne fait aucune mise en page : sans tailles, la table mesurerait zéro pixel et
 * le virtualiseur ne monterait aucune ligne. On lui donne la fenêtre qu'un navigateur
 * mesure — même procédé que la colonne de kanban, qui se virtualise déjà.
 */
const VIEWPORT = 700;
Element.prototype.getBoundingClientRect = function stubbedRect(this: Element) {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 900,
    bottom: VIEWPORT,
    width: 900,
    height: VIEWPORT,
  } as DOMRect;
};
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => VIEWPORT });
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 900 });

const PROJECT = 7;

const cell = (departmentKey: string, over: Partial<GridCell> = {}): GridCell => ({
  departmentKey,
  taskId: null,
  status: null,
  assignee: null,
  versionCount: 0,
  lastActivityAt: null,
  dueDate: null,
  scheduled: true,
  ...over,
});

const ROWS: GridRow[] = [
  {
    shotId: 1,
    code: 'SH010',
    name: 'Arrivée du train',
    sequenceId: 10,
    sequenceCode: 'SQ010',
    episodeId: null,
    episodeCode: null,
    status: { id: 5, code: 'ip', name: 'In progress', color: '#3355ff' },
    cells: [
      cell('anim', {
        taskId: 101,
        status: { id: 1, code: 'apr', name: 'Approved', color: '#22cc55', family: 'done' },
        assignee: { id: 2, name: 'Bob Artist' },
        versionCount: 3,
        lastActivityAt: '2026-09-10T10:00:00.000Z',
        dueDate: '2026-09-30T00:00:00.000Z',
      }),
      cell('comp'),
      cell('light', { scheduled: false }),
    ],
  },
  {
    shotId: 2,
    code: 'SH020',
    name: 'Sortie d’usine',
    sequenceId: 10,
    sequenceCode: 'SQ010',
    episodeId: null,
    episodeCode: null,
    status: null,
    cells: [
      cell('anim', {
        taskId: 201,
        status: { id: 2, code: 'wip', name: 'In progress', color: null, family: 'progress' },
      }),
      cell('comp', {
        taskId: 202,
        status: { id: 3, code: 'rtk', name: 'Retake', color: null, family: 'blocked' },
      }),
      cell('light', { scheduled: false }),
    ],
  },
];

const GRID: ProjectGrid = {
  departments: [
    { id: 1, key: 'anim', name: 'Animation', color: '#ff8800', order: 1 },
    { id: 2, key: 'comp', name: 'Compositing', color: null, order: 2 },
    { id: 3, key: 'light', name: 'Lighting', color: null, order: 3 },
  ],
  rows: ROWS,
  nextCursor: null,
  total: 2,
};

const api = (grid: MockResolver = GRID): Record<string, MockResolver> => ({
  'GET /api/projects/7': {
    project: {
      id: PROJECT,
      myRole: 'ADMIN',
      memberships: [
        { role: 'ARTIST', user: { id: 2, name: 'Bob Artist', email: 'bob@review.local', role: 'ARTIST' } },
      ],
    },
  },
  'GET /api/projects/7/grid': grid,
  'GET /api/projects/7/departments': { departments: GRID.departments },
  'GET /api/episodes/settings': { settings: { enabled: false } },
  'GET /api/sequences': {
    sequences: [{ id: 10, code: 'SQ010', name: 'Ouverture', order: 1, _count: { shots: 2 } }],
    unsequencedShots: 0,
  },
  'GET /api/pipeline-statuses': { statuses: [] },
});

const render = (grid?: MockResolver) =>
  renderWithProviders(<ProductionGrid projectId={PROJECT} />, { api: api(grid) });

describe('ProductionGrid', () => {
  it('met un plan par ligne, et les départements en colonnes dans l’ordre du pipe', async () => {
    render();
    // Le nom du référentiel, pas la clé technique : « Animation », pas « anim ».
    expect(await screen.findByRole('columnheader', { name: 'Animation' })).toBeTruthy();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([t('production.grid.shot'), 'Animation', 'Compositing', 'Lighting']);
    expect(screen.getByRole('link', { name: 'SH010' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'SH020' })).toBeTruthy();
  });

  it('affiche le statut propre du plan, que l’écran d’avant n’affichait nulle part', async () => {
    render();
    expect(
      await screen.findByRole('button', { name: `${t('production.grid.shotStatus')} · In progress` }),
    ).toBeTruthy();
    // Le plan sans statut le dit, au lieu de laisser la colonne vide.
    expect(
      screen.getByRole('button', {
        name: `${t('production.grid.shotStatus')} · ${t('pipeline.status.none')}`,
      }),
    ).toBeTruthy();
  });

  it('distingue une case « à faire » d’une case hors programme', async () => {
    render();
    await screen.findByRole('link', { name: 'SH010' });
    const idle = screen.getByRole('gridcell', { name: `Compositing · ${t('production.grid.idle')}` });
    const offPlan = screen.getAllByRole('gridcell', {
      name: `Lighting · ${t('production.grid.unscheduled')}`,
    });
    expect(offPlan).toHaveLength(2);
    // Aucune des deux n'écrit de nom : elles n'ont pas de statut, et c'est ce vide qui les
    // sépare d'une case engagée. Elles restent distinguées par leur marque et leur libellé.
    expect(idle.textContent).toBe('');
    expect(offPlan[0].textContent).toBe('');
    expect(idle.getAttribute('title')).not.toBe(offPlan[0].getAttribute('title'));
  });

  it('écrit le nom du statut DANS la case, sans rien demander au survol', async () => {
    render();
    const done = await screen.findByRole('button', { name: /Approved/ });
    // `textContent`, pas l'étiquette : c'est ce que l'œil lit sans survoler ni tabuler.
    expect(done.textContent).toContain('Approved');
    expect(screen.getByRole('button', { name: /Retake/ }).textContent).toContain('Retake');
  });

  it('garde la couleur du référentiel à côté du nom — on ajoute, on ne remplace pas', async () => {
    render();
    const done = await screen.findByRole('button', { name: /Approved/ });
    // La pastille est le premier élément stylé de la case ; la teinte est celle du statut.
    const dot = done.querySelector('span[style]');
    expect(dot?.getAttribute('style')).toMatch(/#22cc55|rgb\(34, ?204, ?85\)/i);
  });

  it('traduit l’enum figé dans la case quand le studio n’a aucun référentiel', async () => {
    const noRefRow: GridRow = {
      ...ROWS[0],
      shotId: 3,
      code: 'SH030',
      cells: [
        cell('anim', {
          taskId: 301,
          // Ce que sert le serveur sans référentiel : nom vide, enum dans le code.
          status: { id: null, code: 'PENDING_REVIEW', name: '', color: null, family: 'review' },
        }),
      ],
    };
    render({ ...GRID, rows: [noRefRow], total: 1 });
    const label = t('task.status.toReview');
    const button = await screen.findByRole('button', { name: new RegExp(label) });
    expect(button.textContent).toContain(label);
    // Et jamais l'identifiant lui-même, qui n'est pas un mot d'interface.
    expect(button.textContent).not.toContain('PENDING_REVIEW');
  });

  it('taille la colonne sur le nom le plus long servi, sans la laisser grossir sans fin', async () => {
    render();
    const header = await screen.findByRole('columnheader', { name: 'Animation' });
    // « In progress », le plus long des statuts de la page.
    const width = columnWidth('In progress'.length);
    expect(header.style.width).toBe(`${width}px`);
    // Et le bouton de la case porte cette largeur EN PIXELS : le menu contextuel interpose
    // un `<div>` sans largeur, où un `w-full` se résoudrait en « largeur du contenu » et
    // laisserait le nom déborder la colonne.
    expect(screen.getByRole('button', { name: /Approved/ }).style.width).toBe(`${width - 1}px`);
  });

  it('ne prend pas un pixel de plus qu’avant quand tous les noms sont courts', async () => {
    const short = (over: Partial<GridCell>): GridCell => ({
      ...cell('anim', over),
      status: { id: 9, code: 'fin', name: 'Final', color: null, family: 'done' },
    });
    render({ ...GRID, rows: [{ ...ROWS[0], cells: [short({ taskId: 401 })] }], total: 1 });
    const header = await screen.findByRole('columnheader', { name: 'Animation' });
    expect(header.style.width).toBe(`${COL_W_MIN}px`);
  });

  it('porte au survol ce que la case ne montre pas : versions, activité, échéance', async () => {
    render();
    const done = await screen.findByRole('button', { name: /Approved/ });
    const label = done.getAttribute('aria-label') ?? '';
    expect(label).toContain('Animation');
    expect(label).toContain('Bob Artist');
    expect(label).toContain(t('production.grid.versions', { count: 3 }));
  });

  it('nomme les familles de statut dans une légende visible', async () => {
    render();
    await screen.findByRole('link', { name: 'SH010' });
    // Portée à la légende : « In progress » et « To do » existent aussi dans le filtre de
    // statut, et c'est bien le point — la couleur seule ne disait rien nulle part.
    const legend = within(screen.getByRole('list'));
    for (const key of ['done', 'progress', 'review', 'blocked', 'todo', 'inactive'] as const) {
      expect(legend.getByText(t(`kanban.family.${key}`))).toBeTruthy();
    }
    expect(legend.getByText(t('production.grid.unscheduled'))).toBeTruthy();
    expect(legend.getByText(t('production.grid.idle'))).toBeTruthy();
  });

  it('replie une sequence sur son agrégat et rend ses plans quand on la déplie', async () => {
    const { user } = render();
    const toggle = await screen.findByRole('button', { name: /SQ010/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // Quatre cases comptées — les deux cases `light`, hors programme, ne comptent pas —
    // dont une seule faite.
    expect(screen.getByText(t('production.grid.tally', { done: 1, total: 4 }))).toBeTruthy();

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'SH010' })).toBeNull();
    // L'agrégat survit au repli : c'est lui qui remplace la matrice d'avancement.
    expect(screen.getByText(t('production.grid.tally', { done: 1, total: 4 }))).toBeTruthy();

    await user.click(toggle);
    expect(screen.getByRole('link', { name: 'SH010' })).toBeTruthy();
  });

  it('masque la colonne qu’aucun plan n’a au programme quand on le demande', async () => {
    const { user } = render();
    await screen.findByRole('columnheader', { name: 'Lighting' });
    await user.click(screen.getByRole('checkbox', { name: t('production.grid.hideEmptyColumns') }));
    expect(screen.queryByRole('columnheader', { name: 'Lighting' })).toBeNull();
    const kept = screen.getByRole('columnheader', { name: 'Compositing' });
    expect(kept).toBeTruthy();
    // La grille se resserre sans que les cases restantes perdent leur nom, et la largeur
    // reste celle du nom le plus long des colonnes ENCORE visibles.
    expect(screen.getByRole('button', { name: /Approved/ }).textContent).toContain('Approved');
    expect(kept.style.width).toBe(`${columnWidth('In progress'.length)}px`);
  });

  it('passe le filtre de département au serveur, et redemande une liste neuve', async () => {
    const seen: string[] = [];
    const { user } = render((req: MockRequest) => {
      seen.push(req.url.searchParams.get('department') ?? '');
      return GRID;
    });
    await screen.findByRole('link', { name: 'SH010' });
    // Le référentiel arrive par sa propre requête : sans cette attente, le filtre serait
    // manipulé avant d'avoir ses options.
    await screen.findByRole('option', { name: 'Compositing' });
    await user.selectOptions(
      screen.getByRole('combobox', { name: t('production.grid.filterDepartment') }),
      'comp',
    );
    await screen.findByRole('link', { name: 'SH010' });
    expect(seen).toContain('comp');
  });

  it('dit combien de plans le projet compte, sans mentir sur la page servie', async () => {
    render({ ...GRID, rows: [ROWS[0]], total: 120, nextCursor: null });
    const footer = await screen.findByText(t('production.grid.total', { count: 120 }));
    expect(footer).toBeTruthy();
  });

  it('montre l’erreur du serveur plutôt qu’une grille vide', async () => {
    render(httpError(403, 'Forbidden'));
    expect(await screen.findByText(/Forbidden/)).toBeTruthy();
  });

  it('rend un mot honnête quand aucun plan ne correspond aux filtres', async () => {
    render({ ...GRID, rows: [], total: 0 });
    expect(await screen.findByText(t('production.grid.empty'))).toBeTruthy();
  });

  it('propose le statut et l’assignation au clic droit d’une case', async () => {
    const { user } = render();
    const done = await screen.findByRole('button', { name: /Approved/ });
    await user.click(done);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText(t('production.grid.assign'))).toBeTruthy();
  });
});
