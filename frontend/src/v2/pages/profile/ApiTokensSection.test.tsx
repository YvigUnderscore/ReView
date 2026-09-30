// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } }));
vi.mock('../../../lib/apiClient', () => ({ api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../lib/queries', () => ({
  useProjectsQuery: () => ({ data: [{ id: 4, name: 'Dune' }] }),
}));
vi.mock('../../components/tokens/tokenApi', () => ({
  useScopeCatalog: () => ({
    data: { scopes: ['versions:read', 'versions:write'], legacy: ['read', 'write'] },
    isPending: false,
    isError: false,
  }),
}));

import ApiTokensSection from './ApiTokensSection';
import { t } from '../../i18n';

const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ApiTokensSection />
    </QueryClientProvider>,
  );
};

const openForm = async () => {
  const view = mount();
  await screen.findByText(t('tokens.empty'));
  fireEvent.click(screen.getByText(t('tokens.new')));
  return view;
};

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ tokens: [] });
  api.post.mockResolvedValue({ token: 'rvk_secret' });
});

afterEach(cleanup);

/**
 * Depuis la vague 1, le serveur exige le mot de passe courant pour émettre un token :
 * l'écran qui ne le demandait pas rendait la création simplement impossible. Ces tests
 * tiennent la ré-authentification et les réglages que l'API accepte (scopes fins,
 * cantonnement, expiration), qui n'étaient jamais envoyés.
 */
describe('ApiTokensSection', () => {
  it('reste replié tant qu’on ne demande pas de token', async () => {
    mount();
    await screen.findByText(t('tokens.empty'));
    expect(screen.queryByText(t('profile.password.current'))).toBeNull();
  });

  it('exige le mot de passe courant avant d’activer la création', async () => {
    const { container } = await openForm();
    fireEvent.change(screen.getByLabelText(t('common.name')), { target: { value: 'ingest' } });
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    const submit = screen.getByText(t('common.create')).closest('button');
    expect(submit?.hasAttribute('disabled')).toBe(true);
    const password = container.querySelector('input[type="password"]');
    fireEvent.change(password!, { target: { value: 'Motdepasse1' } });
    expect(submit?.hasAttribute('disabled')).toBe(false);
  });

  it('envoie scopes fins, cantonnement, expiration et mot de passe', async () => {
    const { container } = await openForm();
    fireEvent.change(screen.getByLabelText(t('common.name')), { target: { value: 'ingest' } });
    fireEvent.click(screen.getAllByRole('checkbox')[1]);
    fireEvent.change(screen.getByLabelText(t('common.project')), { target: { value: '4' } });
    fireEvent.change(screen.getByLabelText(t('tokens.expiry.label')), { target: { value: '30' } });
    fireEvent.change(container.querySelector('input[type="password"]')!, {
      target: { value: 'Motdepasse1' },
    });
    fireEvent.submit(container.querySelector('form')!);
    await vi.waitFor(() => expect(api.post).toHaveBeenCalled());
    const [path, body] = api.post.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe('/api/auth/tokens');
    expect(body.currentPassword).toBe('Motdepasse1');
    expect(body.projectId).toBe(4);
    expect(body.expiresInDays).toBe(30);
    expect((body.scopes as string[]).sort()).toEqual(['versions:read', 'versions:write']);
  });

  it('affiche le secret une fois puis oublie le mot de passe saisi', async () => {
    const { container } = await openForm();
    fireEvent.change(screen.getByLabelText(t('common.name')), { target: { value: 'ingest' } });
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.change(container.querySelector('input[type="password"]')!, {
      target: { value: 'Motdepasse1' },
    });
    fireEvent.submit(container.querySelector('form')!);
    expect(await screen.findByText('rvk_secret')).toBeTruthy();
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });
});
