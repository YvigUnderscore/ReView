// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { get: vi.fn(), put: vi.fn(), post: vi.fn() } }));
// `useAuth` (imported by the tab) registers its session handler when the
// module loads: the mock must export it, otherwise the tab's import fails before any test runs.
vi.mock('@/lib/apiClient', () => ({ api, setSessionExpiredHandler: vi.fn() }));
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

/** The "unencrypted send" checkbox, found by its translated label. */
const insecureBox = () => screen.getByLabelText<HTMLInputElement>(t('smtp.allowInsecure'));

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockResolvedValue({ smtp: CONFIG });
  api.put.mockResolvedValue({ smtp: CONFIG });
});

afterEach(cleanup);

/**
 * `allowInsecure` removes STARTTLS from the transport: with no on-screen representation, the setting
 * only existed for whoever writes to the database by hand, and a studio whose relay does not advertise
 * STARTTLS had no recourse. The screen must show it, say what it costs, and
 * send it — in both directions.
 */
describe('SmtpTab — unencrypted sending (allowInsecure)', () => {
  it('shows the checkbox and states the exposure it accepts', async () => {
    mount();
    expect(await screen.findByText(t('smtp.allowInsecure'))).toBeTruthy();
    // The consequence is written on screen, not only in the documentation.
    expect(screen.getByText(t('smtp.allowInsecureHint'))).toBeTruthy();
  });

  it('reflects the saved setting', async () => {
    api.get.mockResolvedValue({ smtp: { ...CONFIG, allowInsecure: true } });
    mount();
    await waitFor(() => expect(insecureBox().checked).toBe(true));
  });

  it('sends the authorisation when ticked', async () => {
    mount();
    await waitFor(() => expect(insecureBox()).toBeTruthy());
    fireEvent.click(insecureBox());
    fireEvent.click(screen.getByText(t('common.save')));
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0]?.[1]).toMatchObject({ allowInsecure: true });
  });

  it('sends the return to safety when unticked on its own', async () => {
    api.get.mockResolvedValue({ smtp: { ...CONFIG, allowInsecure: true } });
    mount();
    await waitFor(() => expect(insecureBox().checked).toBe(true));
    fireEvent.click(insecureBox());
    fireEvent.click(screen.getByText(t('common.save')));
    // The service keeps the value in place when the field is absent from the body: an
    // omitted `allowInsecure` would have left the relay in plain text despite the unticked box.
    await waitFor(() => expect(api.put).toHaveBeenCalled());
    expect(api.put.mock.calls[0]?.[1]).toMatchObject({ allowInsecure: false });
  });
});
