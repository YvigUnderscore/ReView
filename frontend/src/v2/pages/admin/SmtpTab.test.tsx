// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
// `useAuth` (importé par l'onglet) enregistre son gestionnaire de session au chargement du
// module : le mock doit porter cet export, sinon l'import de l'onglet échoue avant tout test.
vi.mock('../../../lib/apiClient', () => ({ api, setSessionExpiredHandler: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import SmtpTab from './SmtpTab';
import { t } from '../../i18n';

const CONFIG = {
  host: 'smtp.studio.local',
  port: 587,
  secure: false,
  user: 'review@studio.local',
  from: 'ReView <no-reply@studio.local>',
  hasPassword: true,
  allowInsecure: false,
  envOverride: false,
};

const mount = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <SmtpTab />
    </QueryClientProvider>,
  );
};

/** La case « envoi non chiffré », désignée par son libellé traduit. */
const insecureBox = () => screen.getByLabelText<HTMLInputElement>(t('smtp.allowInsecure'));

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ smtp: CONFIG });
  api.put.mockResolvedValue({ smtp: CONFIG });
});

afterEach(cleanup);

/**
 * `allowInsecure` retire STARTTLS du transport : sans représentation à l'écran, le réglage
 * n'existait que pour qui écrit dans la base à la main, et un studio dont le relais n'annonce
 * pas STARTTLS n'avait aucun recours. L'écran doit le montrer, dire ce qu'il coûte, et
 * l'envoyer — dans les deux sens.
 */
describe('SmtpTab — envoi non chiffré (allowInsecure)', () => {
  it('affiche la case et énonce l’exposition qu’elle accepte', async () => {
    mount();
    expect(await screen.findByText(t('smtp.allowInsecure'))).toBeTruthy();
    // La conséquence est écrite à l'écran, pas seulement dans la documentation.
    expect(screen.getByText(t('smtp.allowInsecureHint'))).toBeTruthy();
  });

  it('reflète le réglage enregistré', async () => {
    api.get.mockResolvedValue({ smtp: { ...CONFIG, allowInsecure: true } });
    mount();
    await waitFor(() => expect(insecureBox().checked).toBe(true));
  });

  it('transmet l’autorisation quand on la coche', async () => {
    mount();
    await waitFor(() => expect(insecureBox()).toBeTruthy());
    fireEvent.click(insecureBox());
    fireEvent.click(screen.getByText(t('common.save')));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0]?.[1]).toMatchObject({ allowInsecure: true });
  });

  it('transmet le retour en sécurité quand on la décoche seule', async () => {
    api.get.mockResolvedValue({ smtp: { ...CONFIG, allowInsecure: true } });
    mount();
    await waitFor(() => expect(insecureBox().checked).toBe(true));
    fireEvent.click(insecureBox());
    fireEvent.click(screen.getByText(t('common.save')));
    // Le service conserve la valeur en place quand le champ est absent du corps : un
    // `allowInsecure` omis aurait laissé le relais en clair malgré la case décochée.
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0]?.[1]).toMatchObject({ allowInsecure: false });
  });
});
