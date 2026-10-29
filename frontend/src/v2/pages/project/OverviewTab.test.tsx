// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import OverviewTab from './OverviewTab';
import { FALLBACK_GEOMETRY } from '@/v2/components/widgets/widgetSizing';
import { page, renderWithProviders } from '@/test/renderWithProviders';
import type { MockResolver } from '@/test/apiMock';
import { t } from '../../i18n';

/**
 * The composable overview, mounted the way the application mounts it.
 *
 * Three promises are verified here, and they only hold end to end: a person's layout is indeed
 * **saved** (a request goes out, with the right key), someone who set nothing receives the
 * **default of their role**, and hiding a block does make it **disappear**. All three would pass
 * on pure functions while proving nothing about the screen.
 */

const PROJECT = 12;
const COUNTS = { sequences: 3, shots: 40, assets: 7 };

/** Everything the blocks request is empty: what is observed is their presence. */
const BASE_API: Record<string, MockResolver> = {
  'GET /api/projects/12/activity': { recent: [], tasks: [] },
  'GET /api/projects/12/production': { attention: { overdue: [], unassigned: [], waitingReview: [] } },
  'GET /api/projects/12/stats': { totals: {}, shots: [], sequences: [] },
  'GET /api/media': { items: [] },
  'GET /api/dashboard/tasks': page([]),
};

const project = (myRole: string): MockResolver => ({
  project: { id: PROJECT, name: 'Alpha', myRole, memberships: [] },
});

const mount = (options: {
  role: string;
  preferences?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
}) =>
  renderWithProviders(<OverviewTab name="Alpha" projectId={PROJECT} counts={COUNTS} onGo={() => {}} />, {
    user: { role: options.role === 'ADMIN' ? 'ADMIN' : 'ARTIST' },
    api: {
      ...BASE_API,
      'GET /api/projects/:id': project(options.role),
      'GET /api/users/me/preferences': { preferences: options.preferences ?? {} },
      'GET /api/studio/overview-layout': { defaults: options.defaults ?? {} },
      // The server merges and returns the full bag: the stub does the same, otherwise the local
      // cache would not reflect what has just been written.
      'PATCH /api/users/me/preferences': (req) => ({ preferences: req.body }),
    },
  });

const widget = (id: string) => document.querySelector(`section[data-widget="${id}"]`);
const widgets = () =>
  [...document.querySelectorAll('section[data-widget]')].map((el) => el.getAttribute('data-widget'));

/** The handle of a block, named by what it resizes and by its current size. */
const resizeHandle = (name: string, width: number, height: number) =>
  screen.findByRole('button', { name: t('overview.widget.resize', { name, width, height }) });

/** The preference writes sent: the mutation is asynchronous, so we wait for it. */
const writtenPreferences = async (api: ReturnType<typeof mount>['api']) => {
  await waitFor(() => expect(api.called('PATCH /api/users/me/preferences').length).toBeGreaterThan(0));
  return api.called('PATCH /api/users/me/preferences');
};

/** What the page has just saved as settings for the named block. */
const savedSettings = (body: unknown, id: string) =>
  (body as { projectOverview: { settings: Record<string, unknown> } }).projectOverview.settings[id];

describe('OverviewTab — layout by role', () => {
  it('serves an artist the default set for their role', async () => {
    mount({ role: 'ARTIST', defaults: { ARTIST: { order: ['myTasks', 'activity'], hidden: ['counts'] } } });
    await waitFor(() => expect(widget('myTasks')).not.toBeNull());
    expect(widgets()[0]).toBe('myTasks');
    expect(widget('counts')).toBeNull();
  });

  it('falls back to the shipped layout when the administration has set nothing', async () => {
    mount({ role: 'ARTIST' });
    await waitFor(() => expect(widget('myTasks')).not.toBeNull());
    // The artist's product default: their work at the top, the project's tasks hidden.
    expect(widgets()[0]).toBe('myTasks');
    expect(widget('tasks')).toBeNull();
  });

  it('never shows an artist a reserved block, even if the role names one', async () => {
    // The server would refuse these reads (`requireProjectManage`): the block must not exist for
    // them, otherwise the page opens on two error messages.
    mount({ role: 'ARTIST', defaults: { ARTIST: { order: ['attention', 'retakes', 'activity'] } } });
    await waitFor(() => expect(widget('activity')).not.toBeNull());
    expect(widget('attention')).toBeNull();
    expect(widget('retakes')).toBeNull();
  });

  it('opens to the supervisor what is blocking', async () => {
    mount({ role: 'SUPERVISOR' });
    await waitFor(() => expect(widget('attention')).not.toBeNull());
    expect(widgets()[0]).toBe('attention');
  });
});

describe('OverviewTab — customization', () => {
  it('makes the person layout take precedence over the role default', async () => {
    mount({
      role: 'ARTIST',
      preferences: { projectOverview: { hidden: ['myTasks'] } },
      defaults: { ARTIST: { order: ['myTasks', 'activity', 'latestMedia'] } },
    });
    // Wait for the hiding itself: before the preferences arrive, the page renders the role layout,
    // and watching a block it already contains would prove nothing.
    await waitFor(() => expect(widget('myTasks')).toBeNull());
    // The role order survives hiding: the page does not rearrange itself.
    expect(widgets()[0]).toBe('activity');
  });

  it('saves the hiding of a block and makes it disappear', async () => {
    const { api, user } = mount({ role: 'ARTIST', defaults: { ARTIST: { order: ['activity', 'myTasks'] } } });
    await waitFor(() => expect(widget('activity')).not.toBeNull());

    await user.click(screen.getByRole('button', { name: t('overview.customise') }));
    const hide = await screen.findAllByRole('button', {
      name: t('home.widget.hide', { name: t('home.recentActivity') }),
    });
    await user.click(hide[0]);

    await waitFor(() => expect(widget('activity')).toBeNull());
    const written = api.called('PATCH /api/users/me/preferences');
    expect(written).toHaveLength(1);
    expect(written[0].body).toEqual({
      projectOverview: expect.objectContaining({ hidden: ['activity'] }),
    });
  });

  it('restores the role default for the page, saving nothing but a deletion', async () => {
    const { api, user } = mount({
      role: 'ARTIST',
      preferences: { projectOverview: { hidden: ['activity'] } },
      defaults: { ARTIST: { order: ['activity', 'myTasks'] } },
    });
    await waitFor(() => expect(widget('activity')).toBeNull());
    expect(widget('myTasks')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: t('overview.customise') }));
    // The gesture lives on right-click on the page BACKGROUND: that on a block opens the block's
    // menu, which only offers what concerns it.
    await user.pointer({
      keys: '[MouseRight]',
      target: screen.getByText(t('overview.projectDashboard', { name: 'Alpha' })),
    });
    await user.click(await screen.findByText(t('overview.useRoleDefault')));

    const written = api.called('PATCH /api/users/me/preferences');
    expect(written).toHaveLength(1);
    expect(written[0].body).toEqual({ projectOverview: null });
  });
});

/**
 * Resizing with the handle: the gesture the user asked for.
 *
 * What is verified here can only be verified on screen: the handle exists in composition mode, a
 * drag sets BOTH axes, the result is sent as a preference only once, and a layout saved before the
 * heights reads back without being rewritten.
 */
describe('OverviewTab — redimensionnement', () => {
  /** Opens composition mode and renders the handle of the "latest updates" block. */
  const handleOfActivity = async (user: ReturnType<typeof mount>['user']) => {
    await waitFor(() => expect(widget('activity')).not.toBeNull());
    await user.click(screen.getByRole('button', { name: t('overview.customise') }));
    // The artist's product default: six columns, five rows.
    return resizeHandle(t('home.recentActivity'), 6, 5);
  };

  it('sets width AND height in a single drag, and saves only on release', async () => {
    const { api, user } = mount({ role: 'ARTIST' });
    const handle = await handleOfActivity(user);

    fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, {
      clientX: 2 * FALLBACK_GEOMETRY.column,
      clientY: -2 * FALLBACK_GEOMETRY.row,
    });
    // The gesture is not finished: the page shows the target size without having saved anything.
    expect(await resizeHandle(t('home.recentActivity'), 8, 3)).not.toBeNull();
    expect(api.called('PATCH /api/users/me/preferences')).toHaveLength(0);

    fireEvent.pointerUp(window, {
      clientX: 2 * FALLBACK_GEOMETRY.column,
      clientY: -2 * FALLBACK_GEOMETRY.row,
    });

    const written = await writtenPreferences(api);
    expect(written).toHaveLength(1);
    expect(savedSettings(written[0].body, 'activity')).toEqual({ span: 8, rows: 3 });
    expect(widget('activity')?.className).toContain('row-span-3');
  });

  it('bounds the gesture to the sizes the block offers', async () => {
    const { api, user } = mount({ role: 'ARTIST' });
    const handle = await handleOfActivity(user);

    fireEvent.pointerDown(handle, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 5000, clientY: 5000 });
    fireEvent.pointerUp(window, { clientX: 5000, clientY: 5000 });

    // Dragging beyond the screen does not produce a footprint the grid cannot render.
    expect(savedSettings((await writtenPreferences(api))[0].body, 'activity')).toEqual({
      span: 12,
      rows: 6,
    });
  });

  it('is also set with the arrow keys: the handle is a control, not decoration', async () => {
    const { api, user } = mount({ role: 'ARTIST' });
    const handle = await handleOfActivity(user);

    handle.focus();
    fireEvent.keyDown(handle, { key: 'ArrowUp' });

    expect(savedSettings((await writtenPreferences(api))[0].body, 'activity')).toEqual({
      span: 6,
      rows: 4,
    });
  });

  it('offers no handle outside composition mode', async () => {
    mount({ role: 'ARTIST' });
    await waitFor(() => expect(widget('activity')).not.toBeNull());
    expect(
      screen.queryByRole('button', {
        name: t('overview.widget.resize', { name: t('home.recentActivity'), width: 6, height: 5 }),
      }),
    ).toBeNull();
  });

  it('reads back a layout saved before the heights, without rewriting it', async () => {
    const { api } = mount({
      role: 'ARTIST',
      preferences: {
        projectOverview: {
          order: ['activity'],
          hidden: ['myTasks', 'latestMedia', 'progress', 'counts', 'tasks'],
          settings: { activity: { span: 12, height: 'tall' } },
        },
      },
    });
    await waitFor(() => expect(widget('myTasks')).toBeNull());

    // The old scale is translated on READ: the "tall" block is five rows.
    expect(widget('activity')?.className).toContain('row-span-5');
    expect(widget('activity')?.className).toContain('xl:col-span-12');
    expect(api.called('PATCH /api/users/me/preferences')).toHaveLength(0);
  });

  it('lays out a grid that packs its blocks', async () => {
    mount({ role: 'ARTIST' });
    await waitFor(() => expect(widget('activity')).not.toBeNull());
    // The packing is the browser's: without `dense`, the rows a short block leaves free remain
    // empty. This is the defect circled in red on the screenshot.
    const grid = widget('activity')?.parentElement?.className ?? '';
    expect(grid).toContain('grid-flow-row-dense');
    expect(grid).toContain('auto-rows-[5rem]');
  });
});
