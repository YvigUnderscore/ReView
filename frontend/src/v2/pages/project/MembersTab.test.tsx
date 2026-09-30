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
 * L'onglet Membres : on y assigne un rôle ET un département.
 *
 * Le rôle par projet existait (38.E) ; le département, lui, n'avait aucun écran, alors que
 * la relation et la route existaient depuis la vague B. Trois choses sont figées ici.
 *
 * 1. **Un artiste porte plusieurs départements.** Les cases se cochent indépendamment.
 * 2. **Chaque bascule est envoyée seule** (`{add}` / `{remove}`), jamais la liste entière :
 *    l'écran ne montre que le vocabulaire d'un projet, envoyer son état effacerait les
 *    départements que la personne tient d'ailleurs.
 * 3. Le rôle et le département se règlent au même endroit, au clic droit.
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
  it('montre les départements de la personne sur la ligne', async () => {
    renderWithProviders(<MembersTab projectId={PROJECT} />, {
      api: routes([{ id: 10, key: 'COMP', name: 'Compositing', color: null }]),
    });
    expect(await screen.findByText('Compositing')).toBeTruthy();
  });

  it('dit « aucun département » plutôt que de laisser un blanc', async () => {
    renderWithProviders(<MembersTab projectId={PROJECT} />, { api: routes() });
    expect(await screen.findByText(t('members.noDepartment'))).toBeTruthy();
  });

  it('coche un département et n’envoie QUE celui-là', async () => {
    const { api } = renderWithProviders(<MembersTab projectId={PROJECT} />, { api: routes() });
    openContextMenu(await screen.findByText('Alice Artist'));
    await openSubmenu(t('departments.menu'));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Lighting' }));

    await waitFor(() => {
      expect(api.called(`PATCH /api/projects/${PROJECT}/members/5/departments`)).toHaveLength(1);
    });
    const [call] = api.called(`PATCH /api/projects/${PROJECT}/members/5/departments`);
    // `{add: [11]}` et rien d'autre : une liste complète effacerait les départements que
    // la personne tient d'un autre projet, que cet écran n'affiche même pas.
    expect(call.body).toEqual({ add: [11] });
  });

  it('décoche un département en le nommant au retrait', async () => {
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

  it('assigne le rôle projet depuis le même menu', async () => {
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

  it('n’offre aucun menu à qui ne gère pas le projet', async () => {
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
    // Sans entrée, `EntityContextMenu` ne monte pas de menu du tout : rien à ouvrir.
    expect(screen.queryByRole('menuitem')).toBeNull();
  });
});
