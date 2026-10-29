// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import HomeGrid from './HomeGrid';
import type { HomeWidgetsPref } from './homeWidgets';
import type { DashboardActivityItem, DashboardData, DashboardProject } from './homeTypes';
import { t } from '../../i18n';

/**
 * The resizable home page (batch 13): "I want the same resize settings, window settings, etc.
 * as the project overview".
 *
 * What these cases lock down is the complete gesture chain: the handle sets both axes, the chosen
 * size goes into a preference (a single write), the grid carries the footprint, and the content
 * follows it. A home page composed **before** this batch reads back without losing anything.
 */

const project = (id: number): DashboardProject => ({
  id,
  name: `Projet ${String(id)}`,
  thumbnailUrl: null,
  totalTasks: 4,
  approvedTasks: 2,
});

const event = (i: number): DashboardActivityItem => ({
  type: 'media',
  at: `2026-09-20T1${String(i % 10)}:00:00.000Z`,
  label: `Média ${String(i)}`,
  location: 'SEQ010 / SH020',
  author: 'Ada',
  taskId: null,
  mediaId: i,
});

const data: DashboardData = {
  latestReviews: [],
  activity: Array.from({ length: 15 }, (_, i) => event(i + 1)),
  myTasks: [],
  recentProjects: [1, 2, 3, 4, 5].map(project),
  stats: {
    projects: 5,
    mediaInReview: 3,
    comments: 12,
    mediaInReview7d: 1,
    comments7d: 2,
    myRetakes: 0,
    awaitingMyReview: 0,
  },
};

const mount = (pref: HomeWidgetsPref | undefined, editing = false) => {
  const onPref = vi.fn();
  const result = renderWithProviders(
    <HomeGrid
      data={data}
      pref={pref}
      editing={editing}
      onPref={onPref}
      onHide={() => {}}
      onEnterEdit={() => {}}
    />,
  );
  return { ...result, onPref };
};

const sectionOf = (id: string) => document.querySelector<HTMLElement>(`section[data-widget="${id}"]`);
const handleOf = (id: string) =>
  document.querySelector<HTMLElement>(
    `section[data-widget="${id}"] button[title="${t('overview.widget.resizeHint')}"]`,
  );
/** Project tiles actually shown: the "all projects" link is not one. */
const projectTiles = () =>
  Array.from(sectionOf('projects')?.querySelectorAll('a') ?? [])
    .map((a) => a.getAttribute('href') ?? '')
    .filter((href) => href.startsWith('/projects/'));

const rowsOf = (id: string) =>
  sectionOf(id)
    ?.className.split(' ')
    .find((c) => c.startsWith('row-span-'));

describe('HomeGrid — block footprint', () => {
  it('lays out rows that pack, instead of blocks aligned to the top', () => {
    // A short block opened a hole beneath it that its neighbour could not fill: `items-start`
    // produced it, and `grid-flow-row-dense` closes it.
    mount(undefined);
    const grid = sectionOf('stats')?.parentElement;
    expect(grid?.className).toContain('grid-flow-row-dense');
    expect(grid?.className).toContain('auto-rows-[5rem]');
    expect(grid?.className).not.toContain('items-start');
  });

  it('renders the default height of each block', () => {
    mount(undefined);
    expect(rowsOf('stats')).toBe('row-span-2');
    expect(rowsOf('activity')).toBe('row-span-4');
  });

  it('renders the saved height', () => {
    mount({ settings: { activity: { span: 8, rows: 6 } } });
    expect(rowsOf('activity')).toBe('row-span-6');
    expect(sectionOf('activity')?.className).toContain('xl:col-span-8');
  });

  it('reads back a home page composed BEFORE the rows', () => {
    // The old scale is translated on read: nobody loses the tall block they had set, and the
    // preference is not rewritten for all that.
    const { onPref } = mount({ settings: { activity: { height: 'tall' }, stats: { height: 'short' } } });
    expect(rowsOf('activity')).toBe('row-span-5');
    expect(rowsOf('stats')).toBe('row-span-2');
    expect(onPref).not.toHaveBeenCalled();
  });
});

describe('HomeGrid — the handle saves', () => {
  it('sets width and height, in a single preference write', () => {
    const { onPref } = mount(undefined, true);
    const handle = handleOf('activity');
    expect(handle).not.toBeNull();
    if (!handle) return;

    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(onPref).toHaveBeenCalledWith({ settings: { activity: { span: 6, rows: 5 } } });

    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    // Widths offered to this block: 3, 4, 6, 8. The one after 6 is 8.
    expect(onPref).toHaveBeenLastCalledWith({ settings: { activity: { span: 8, rows: 4 } } });
    expect(onPref).toHaveBeenCalledTimes(2);
  });

  it('shows no handle outside composition mode', () => {
    mount(undefined);
    expect(handleOf('activity')).toBeNull();
  });
});

describe('HomeGrid — content follows the size', () => {
  it('shows more activity in a taller block', () => {
    // Three rows: this is the floor of the size model, where an overflowing list is better than
    // an empty block.
    mount({ settings: { activity: { rows: 2 } } });
    expect(sectionOf('activity')?.querySelectorAll('a').length).toBe(3);
  });

  it('shows the whole feed when the block has the room', () => {
    mount({ settings: { activity: { rows: 6 } } });
    expect(sectionOf('activity')?.querySelectorAll('a').length).toBe(data.activity.length);
  });

  it('shows more projects in a taller grid', () => {
    mount({ settings: { projects: { rows: 4 } } });
    // Four tiles fit in four rows; "All projects", at the top of the block, leads to the rest.
    expect(projectTiles()).toHaveLength(4);
    expect(screen.getByText(t('reviews.filter.allProjects'))).toBeInTheDocument();
  });

  it('shows all projects when the grid is tall enough', () => {
    mount({ settings: { projects: { rows: 6 } } });
    expect(projectTiles()).toHaveLength(data.recentProjects.length);
  });
});
