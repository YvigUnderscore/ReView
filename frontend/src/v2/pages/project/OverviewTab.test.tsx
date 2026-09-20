// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import OverviewTab from './OverviewTab';
import { page, renderWithProviders } from '../../../test/renderWithProviders';
import type { MockResolver } from '../../../test/apiMock';
import { t } from '../../i18n';

/**
 * La vue d'ensemble composable, montée comme l'application la monte.
 *
 * Trois promesses sont vérifiées ici, et elles ne valent que bout en bout : la disposition
 * d'une personne est bien **enregistrée** (une requête part, avec la bonne clé), qui n'a
 * rien réglé reçoit bien le **défaut de son rôle**, et masquer un bloc le fait bien
 * **disparaître**. Les trois passeraient sur des fonctions pures sans rien prouver de
 * l'écran.
 */

const PROJECT = 12;
const COUNTS = { sequences: 3, shots: 40, assets: 7 };

/** Tout ce que les blocs demandent — vide : ce qu'on observe, c'est leur présence. */
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
      // Le serveur fusionne et renvoie le sac complet : le bouchon fait de même, sans quoi
      // le cache local ne refléterait pas ce qui vient d'être écrit.
      'PATCH /api/users/me/preferences': (req) => ({ preferences: req.body }),
    },
  });

const widget = (id: string) => document.querySelector(`section[data-widget="${id}"]`);
const widgets = () =>
  [...document.querySelectorAll('section[data-widget]')].map((el) => el.getAttribute('data-widget'));

describe('OverviewTab — disposition par rôle', () => {
  it('sert à un artiste le défaut réglé pour son rôle', async () => {
    mount({ role: 'ARTIST', defaults: { ARTIST: { order: ['myTasks', 'activity'], hidden: ['counts'] } } });
    await waitFor(() => expect(widget('myTasks')).not.toBeNull());
    expect(widgets()[0]).toBe('myTasks');
    expect(widget('counts')).toBeNull();
  });

  it('retombe sur la disposition livrée quand l’administration n’a rien réglé', async () => {
    mount({ role: 'ARTIST' });
    await waitFor(() => expect(widget('myTasks')).not.toBeNull());
    // Défaut produit de l'artiste : son travail en tête, les tâches du projet masquées.
    expect(widgets()[0]).toBe('myTasks');
    expect(widget('tasks')).toBeNull();
  });

  it('n’expose jamais à un artiste un bloc réservé, même si le rôle en cite un', async () => {
    // Le serveur refuserait ces lectures (`requireProjectManage`) : le bloc ne doit pas
    // exister pour lui, sinon la page s'ouvre sur deux messages d'erreur.
    mount({ role: 'ARTIST', defaults: { ARTIST: { order: ['attention', 'retakes', 'activity'] } } });
    await waitFor(() => expect(widget('activity')).not.toBeNull());
    expect(widget('attention')).toBeNull();
    expect(widget('retakes')).toBeNull();
  });

  it('ouvre au superviseur ce qui bloque', async () => {
    mount({ role: 'SUPERVISOR' });
    await waitFor(() => expect(widget('attention')).not.toBeNull());
    expect(widgets()[0]).toBe('attention');
  });
});

describe('OverviewTab — personnalisation', () => {
  it('fait primer la disposition de la personne sur le défaut de son rôle', async () => {
    mount({
      role: 'ARTIST',
      preferences: { projectOverview: { hidden: ['myTasks'] } },
      defaults: { ARTIST: { order: ['myTasks', 'activity', 'latestMedia'] } },
    });
    // On attend le masquage lui-même : avant l'arrivée des préférences, la page rend la
    // disposition du rôle, et guetter un bloc qu'elle contient déjà ne prouverait rien.
    await waitFor(() => expect(widget('myTasks')).toBeNull());
    // L'ordre du rôle survit au masquage : la page ne se réarrange pas toute seule.
    expect(widgets()[0]).toBe('activity');
  });

  it('enregistre le masquage d’un bloc et le fait disparaître', async () => {
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

  it('rend sa page au défaut du rôle sans rien enregistrer d’autre qu’un effacement', async () => {
    const { api, user } = mount({
      role: 'ARTIST',
      preferences: { projectOverview: { hidden: ['activity'] } },
      defaults: { ARTIST: { order: ['activity', 'myTasks'] } },
    });
    await waitFor(() => expect(widget('activity')).toBeNull());
    expect(widget('myTasks')).not.toBeNull();

    await user.click(screen.getByRole('button', { name: t('overview.customise') }));
    // Le geste vit au clic droit sur le FOND de page : celui d'un bloc ouvre le menu du
    // bloc, qui ne propose que ce qui le concerne.
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
