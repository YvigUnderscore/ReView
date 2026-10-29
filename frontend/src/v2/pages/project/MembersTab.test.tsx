// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import MembersTab from './MembersTab';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { openContextMenu, openSubmenu, clickMenuRadio } from '../../../test/menu';
import { t } from '../../i18n';
import type { MockResolver } from '../../../test/apiMock';

/**
 * The members tab: a role AND a department are assigned here.
 *
 * The per-project role existed (38.E). The department, however, had no screen, although the
 * relation and the route had existed since wave B. Three things are fixed here.
 *
 * 1. **An artist holds several departments.** The boxes are ticked independently.
 * 2. **Each toggle is sent on its own** (`{add}` / `{remove}`), never the whole list: the screen
 *    only shows the vocabulary of one project, and sending its state would erase the departments
 *    the person holds elsewhere.
 * 3. The role and the department are set in the same place, on right-click.
 */
const PROJECT = 7;

const DEPARTMENTS = [
  { id: 10, studioId: 1, projectId: null, key: 'COMP', name: 'Compositing', order: 0, color: null },
  { id: 11, studioId: 1, projectId: null, key: 'LGT', name: 'Lighting', order: 1, color: null },
];

const member = (departments: { id: number; key: string; name: string; color: string | null }[]) => ({
  id: 1,
  role: null,
  user: {
    id: 5,
    name: 'Alice Artist',
    email: 'alice@studio.test',
    role: 'ARTIST',
    username: null,
    avatarUrl: null,
    departments,
  },
});

const routes = (
  departments: { id: number; key: string; name: string; color: string | null }[] = [],
): Record<string, MockResolver> => ({
  [`GET /api/projects/${PROJECT}`]: { project: { myRole: 'ADMIN', memberships: [member(departments)] } },
  [`GET /api/projects/${PROJECT}/departments`]: { departments: DEPARTMENTS },
  [`GET /api/shotgrid/projects/${PROJECT}/connection`]: { connection: null },
  [`PATCH /api/projects/${PROJECT}/members/5/departments`]: { departments: [] },
  [`POST /api/projects/${PROJECT}/members`]: { membership: { id: 1 } },
});

describe('MembersTab', () => {
  it('shows the departments of the person on the row', async () => {
    renderWithProviders(<MembersTab projectId={PROJECT} />, {
      api: routes([{ id: 10, key: 'COMP', name: 'Compositing', color: null }]),
    });
    expect(await screen.findByText('Compositing')).toBeTruthy();
  });

  it('says "no department" rather than leaving a blank', async () => {
    renderWithProviders(<MembersTab projectId={PROJECT} />, { api: routes() });
    expect(await screen.findByText(t('members.noDepartment'))).toBeTruthy();
  });

  it('ticks a department and sends ONLY that one', async () => {
    const { api } = renderWithProviders(<MembersTab projectId={PROJECT} />, { api: routes() });
    openContextMenu(await screen.findByText('Alice Artist'));
    await openSubmenu(t('departments.menu'));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Lighting' }));

    await waitFor(() => {
      expect(api.called(`PATCH /api/projects/${PROJECT}/members/5/departments`)).toHaveLength(1);
    });
    const [call] = api.called(`PATCH /api/projects/${PROJECT}/members/5/departments`);
    // `{add: [11]}` and nothing else: a full list would erase the departments the person holds on
    // another project, which this screen does not even show.
    expect(call.body).toEqual({ add: [11] });
  });

  it('unticks a department by naming it on removal', async () => {
    const { api } = renderWithProviders(<MembersTab projectId={PROJECT} />, {
      api: routes([{ id: 10, key: 'COMP', name: 'Compositing', color: null }]),
    });
    openContextMenu(await screen.findByText('Alice Artist'));
    await openSubmenu(t('departments.menu'));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Compositing' }));

    await waitFor(() => {
      expect(api.called(`PATCH /api/projects/${PROJECT}/members/5/departments`)).toHaveLength(1);
    });
    const [call] = api.called(`PATCH /api/projects/${PROJECT}/members/5/departments`);
    expect(call.body).toEqual({ remove: [10] });
  });

  it('assigns the project role from the same menu', async () => {
    const { api } = renderWithProviders(<MembersTab projectId={PROJECT} />, { api: routes() });
    openContextMenu(await screen.findByText('Alice Artist'));
    await openSubmenu(t('members.roleOnProject'));
    await clickMenuRadio(t('members.role.supervisor'));

    await waitFor(() => {
      expect(api.called(`POST /api/projects/${PROJECT}/members`)).toHaveLength(1);
    });
    expect(api.called(`POST /api/projects/${PROJECT}/members`)[0].body).toEqual({
      userId: 5,
      role: 'SUPERVISOR',
    });
  });

  it('offers no menu to someone who does not manage the project', async () => {
    renderWithProviders(<MembersTab projectId={PROJECT} />, {
      api: {
        ...routes(),
        [`GET /api/projects/${PROJECT}`]: {
          project: { myRole: 'ARTIST', memberships: [member([])] },
        },
      },
      user: { role: 'ARTIST' },
    });
    openContextMenu(await screen.findByText('Alice Artist'));
    // Without entries, `EntityContextMenu` does not mount a menu at all: nothing to open.
    expect(screen.queryByRole('menuitem')).toBeNull();
  });
});
