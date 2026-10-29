// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), post: vi.fn(), del: vi.fn() } }));
vi.mock('@/lib/apiClient', () => ({ api }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import ServiceTokensTab from './ServiceTokensTab';
import { t } from '../../i18n';

const TOKEN = {
  id: 9,
  name: 'Render farm',
  description: 'nightly',
  scopes: ['versions:read', 'versions:write'],
  projectId: 4,
  lastUsedAt: null,
  expiresAt: '2020-01-01T00:00:00.000Z',
  createdAt: '2026-08-01T00:00:00.000Z',
  user: { id: 55, email: 'svc-render-farm@service.review.invalid', role: 'SUPERVISOR' },
  project: { id: 4, name: 'Dune' },
};

const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ServiceTokensTab />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ tokens: [TOKEN] });
});

afterEach(cleanup);

/**
 * The screen answers the two questions one asks in front of a robot: what can it do, and where?
 * Holding account's role, project confinement, expiry — served with the row.
 */
describe('ServiceTokensTab', () => {
  it('shows effective role, confinement and an expired date', async () => {
    mount();
    expect(await screen.findByText('Render farm')).toBeTruthy();
    expect(screen.getByText(t('role.supervisor'))).toBeTruthy();
    expect(screen.getByText('Dune')).toBeTruthy();
    expect(screen.getByText(t('tokens.expired'))).toBeTruthy();
    expect(screen.getByText('versions:read versions:write')).toBeTruthy();
  });

  it('shows the empty state when the studio has no machine identity', async () => {
    api.get.mockResolvedValue({ tokens: [] });
    mount();
    expect(await screen.findByText(t('tokens.service.empty'))).toBeTruthy();
    expect(screen.queryByText(t('tokens.revokeHint'))).toBeNull();
  });

  it('opens the issue form only on request', async () => {
    mount();
    await screen.findByText('Render farm');
    // The dialog is closed: no password field, no issue button on screen.
    expect(screen.queryByText(t('tokens.service.emit'))).toBeNull();
    expect(api.get).toHaveBeenCalledWith('/api/admin/service-tokens');
    expect(api.get).not.toHaveBeenCalledWith('/api/admin/projects');
  });
});
