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
 * The screen the grid replaces was judged incomprehensible. This file locks down the four reasons why it was, and which
 * the grid corrects:
 *
 * - the columns carried technical keys sorted alphabetically, whereas an ordered department reference exists;
 * - an empty cell could just as well mean "to do" as "nothing to do here";
 * - the status colours were named nowhere: the cell now writes the name of its status, and keeps its colour;
 * - the shot level was the only one offered, never going down to the shot.
 */

/**
 * happy-dom does no layout: without sizes, the table would measure zero pixels and the virtualiser would mount no row. We
 * give it the window a browser would measure: same procedure as the kanban column, which is already virtualised.
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
  it('puts one shot per row, and the departments in columns in pipe order', async () => {
    render();
    // The reference name, not the technical key: "Animation", not "anim".
    expect(await screen.findByRole('columnheader', { name: 'Animation' })).toBeTruthy();
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual([t('production.grid.shot'), 'Animation', 'Compositing', 'Lighting']);
    expect(screen.getByRole('link', { name: 'SH010' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'SH020' })).toBeTruthy();
  });

  it("displays the shot's own status, which the earlier screen displayed nowhere", async () => {
    render();
    expect(
      await screen.findByRole('button', { name: `${t('production.grid.shotStatus')} · In progress` }),
    ).toBeTruthy();
    // A shot without a status says so, rather than leaving the column empty.
    expect(
      screen.getByRole('button', {
        name: `${t('production.grid.shotStatus')} · ${t('pipeline.status.none')}`,
      }),
    ).toBeTruthy();
  });

  it('distinguishes a "to do" cell from an off-schedule cell', async () => {
    render();
    await screen.findByRole('link', { name: 'SH010' });
    const idle = screen.getByRole('gridcell', { name: `Compositing · ${t('production.grid.idle')}` });
    const offPlan = screen.getAllByRole('gridcell', {
      name: `Lighting · ${t('production.grid.unscheduled')}`,
    });
    expect(offPlan).toHaveLength(2);
    // Neither of the two writes a name: they have no status, and it is that emptiness which separates them from a
    // committed cell. They remain distinguished by their mark and their label.
    expect(idle.textContent).toBe('');
    expect(offPlan[0].textContent).toBe('');
    expect(idle.getAttribute('title')).not.toBe(offPlan[0].getAttribute('title'));
  });

  it('writes the status name INSIDE the cell, without requiring a hover', async () => {
    render();
    const done = await screen.findByRole('button', { name: /Approved/ });
    // `textContent`, not the label: it is what the eye reads without hovering or tabbing.
    expect(done.textContent).toContain('Approved');
    expect(screen.getByRole('button', { name: /Retake/ }).textContent).toContain('Retake');
  });

  it('keeps the reference colour beside the name: we add, we do not replace', async () => {
    render();
    const done = await screen.findByRole('button', { name: /Approved/ });
    // The dot is the first styled element of the cell; the tint is that of the status.
    const dot = done.querySelector('span[style]');
    expect(dot?.getAttribute('style')).toMatch(/#22cc55|rgb\(34, ?204, ?85\)/i);
  });

  it('translates the frozen enum into the cell when the studio has no reference data', async () => {
    const noRefRow: GridRow = {
      ...ROWS[0],
      shotId: 3,
      code: 'SH030',
      cells: [
        cell('anim', {
          taskId: 301,
          // What the server serves without reference data: an empty name, the enum in the code.
          status: { id: null, code: 'PENDING_REVIEW', name: '', color: null, family: 'review' },
        }),
      ],
    };
    render({ ...GRID, rows: [noRefRow], total: 1 });
    const label = t('task.status.toReview');
    const button = await screen.findByRole('button', { name: new RegExp(label) });
    expect(button.textContent).toContain(label);
    // And never the identifier itself, which is not a UI word.
    expect(button.textContent).not.toContain('PENDING_REVIEW');
  });

  it('sizes the column to the longest name served, without letting it grow endlessly', async () => {
    render();
    const header = await screen.findByRole('columnheader', { name: 'Animation' });
    // "In progress", the longest of the page's statuses.
    const width = columnWidth('In progress'.length);
    expect(header.style.width).toBe(`${width}px`);
    // And the cell's button carries that width IN PIXELS: the context menu interposes a width-less `<div>`, where a
    // `w-full` would resolve to "content width" and let the name overflow the column.
    expect(screen.getByRole('button', { name: /Approved/ }).style.width).toBe(`${width - 1}px`);
  });

  it('takes not one pixel more than before when all the names are short', async () => {
    const short = (over: Partial<GridCell>): GridCell => ({
      ...cell('anim', over),
      status: { id: 9, code: 'fin', name: 'Final', color: null, family: 'done' },
    });
    render({ ...GRID, rows: [{ ...ROWS[0], cells: [short({ taskId: 401 })] }], total: 1 });
    const header = await screen.findByRole('columnheader', { name: 'Animation' });
    expect(header.style.width).toBe(`${COL_W_MIN}px`);
  });

  it('shows on hover what the cell does not display: versions, activity, deadline', async () => {
    render();
    const done = await screen.findByRole('button', { name: /Approved/ });
    const label = done.getAttribute('aria-label') ?? '';
    expect(label).toContain('Animation');
    expect(label).toContain('Bob Artist');
    expect(label).toContain(t('production.grid.versions', { count: 3 }));
  });

  it('names the status families in a visible legend', async () => {
    render();
    await screen.findByRole('link', { name: 'SH010' });
    // Carried over to the legend: "In progress" and "To do" also exist in the status filter, and that is the point:
    // colour alone said nothing anywhere.
    const legend = within(screen.getByRole('list'));
    for (const key of ['done', 'progress', 'review', 'blocked', 'todo', 'inactive'] as const) {
      expect(legend.getByText(t(`kanban.family.${key}`))).toBeTruthy();
    }
    expect(legend.getByText(t('production.grid.unscheduled'))).toBeTruthy();
    expect(legend.getByText(t('production.grid.idle'))).toBeTruthy();
  });

  it('collapses a sequence onto its aggregate, and renders its shots when expanded', async () => {
    const { user } = render();
    const toggle = await screen.findByRole('button', { name: /SQ010/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    // Four cells counted (the two `light` cells, off-schedule, do not count), of which only one is done.
    expect(screen.getByText(t('production.grid.tally', { done: 1, total: 4 }))).toBeTruthy();

    await user.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('link', { name: 'SH010' })).toBeNull();
    // The aggregate survives collapsing: it is what replaces the progress matrix.
    expect(screen.getByText(t('production.grid.tally', { done: 1, total: 4 }))).toBeTruthy();

    await user.click(toggle);
    expect(screen.getByRole('link', { name: 'SH010' })).toBeTruthy();
  });

  it('hides the column that no shot has on its schedule, when asked', async () => {
    const { user } = render();
    await screen.findByRole('columnheader', { name: 'Lighting' });
    await user.click(screen.getByRole('checkbox', { name: t('production.grid.hideEmptyColumns') }));
    expect(screen.queryByRole('columnheader', { name: 'Lighting' })).toBeNull();
    const kept = screen.getByRole('columnheader', { name: 'Compositing' });
    expect(kept).toBeTruthy();
    // The grid tightens without the remaining cells losing their name, and the width stays that of the longest name among
    // the columns STILL visible.
    expect(screen.getByRole('button', { name: /Approved/ }).textContent).toContain('Approved');
    expect(kept.style.width).toBe(`${columnWidth('In progress'.length)}px`);
  });

  it('passes the department filter to the server, and requests a fresh list', async () => {
    const seen: string[] = [];
    const { user } = render((req: MockRequest) => {
      seen.push(req.url.searchParams.get('department') ?? '');
      return GRID;
    });
    await screen.findByRole('link', { name: 'SH010' });
    // The reference arrives through its own request: without this wait, the filter would be handled before having its options.
    await screen.findByRole('option', { name: 'Compositing' });
    await user.selectOptions(
      screen.getByRole('combobox', { name: t('production.grid.filterDepartment') }),
      'comp',
    );
    await screen.findByRole('link', { name: 'SH010' });
    expect(seen).toContain('comp');
  });

  it('says how many shots the project has, without misrepresenting the page served', async () => {
    render({ ...GRID, rows: [ROWS[0]], total: 120, nextCursor: null });
    const footer = await screen.findByText(t('production.grid.total', { count: 120 }));
    expect(footer).toBeTruthy();
  });

  it('shows the server error rather than an empty grid', async () => {
    render(httpError(403, 'Forbidden'));
    expect(await screen.findByText(/Forbidden/)).toBeTruthy();
  });

  it('renders an honest word when no shot matches the filters', async () => {
    render({ ...GRID, rows: [], total: 0 });
    expect(await screen.findByText(t('production.grid.empty'))).toBeTruthy();
  });

  it('offers status and assignment on the right-click of a cell', async () => {
    const { user } = render();
    const done = await screen.findByRole('button', { name: /Approved/ });
    await user.click(done);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText(t('production.grid.assign'))).toBeTruthy();
  });
});
