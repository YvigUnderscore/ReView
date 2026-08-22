// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn() } }));
vi.mock('../../../lib/apiClient', () => ({ api }));

import AboutPanel from './AboutPanel';
import { t } from '../../i18n';

const VERSION = {
  version: '2.3.0',
  commit: 'a1b2c3d4e5f6',
  builtAt: '2026-08-22T09:30:00.000Z',
  node: 'v22.14.0',
  source: 'https://git.studio.tld/review',
};

const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AboutPanel />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue(VERSION);
});
afterEach(cleanup);

describe('AboutPanel', () => {
  it('affiche la version, le commit et le runtime de l’instance', async () => {
    mount();
    expect(await screen.findByText('2.3.0 (a1b2c3d4e5f6)')).toBeTruthy();
    expect(screen.getByText('v22.14.0')).toBeTruthy();
    expect(api.get).toHaveBeenCalledWith('/api/version');
  });

  it('dit « inconnue » plutôt que d’afficher une date vide', async () => {
    api.get.mockResolvedValue({ ...VERSION, builtAt: null });
    mount();
    expect(await screen.findByText(t('about.builtAtUnknown'))).toBeTruthy();
  });
});
