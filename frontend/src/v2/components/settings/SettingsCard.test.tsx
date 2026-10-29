// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsCard } from './SettingsCard';
import { SettingsSearchBar, SettingsSearchEmpty, SettingsSearchProvider } from './SettingsSearch';
import { t } from '../../i18n';

/**
 * The settings card and its search.
 *
 * Three properties no pure module can assert: a card placed outside a provider still displays (it must be usable in a
 * dialog), the search hides what does not match, and the "no settings" message only appears when really nothing remains,
 * otherwise the page would wrongly look empty.
 */
function Page() {
  return (
    <SettingsSearchProvider>
      <SettingsSearchBar />
      <SettingsCard title="Burn-ins" hint="Template studio" keywords={['filigrane', 'watermark']}>
        <p>corps burn-ins</p>
      </SettingsCard>
      <SettingsCard title="Stockage" keywords={['quota']} footnote="note de bas de panneau">
        <p>corps stockage</p>
      </SettingsCard>
      <SettingsSearchEmpty />
    </SettingsSearchProvider>
  );
}

const chercher = async (texte: string) => {
  const user = userEvent.setup();
  await user.clear(screen.getByLabelText(t('admin.search.placeholder')));
  if (texte) await user.type(screen.getByLabelText(t('admin.search.placeholder')), texte);
};

describe('SettingsCard', () => {
  it('renders its title, its help and its footer note', () => {
    render(<Page />);
    expect(screen.getByText('Burn-ins')).toBeTruthy();
    expect(screen.getByText('Template studio')).toBeTruthy();
    expect(screen.getByText('note de bas de panneau')).toBeTruthy();
  });

  it('displays outside a provider: search is an option, not a dependency', () => {
    render(
      <SettingsCard title="Isolée">
        <p>corps isolé</p>
      </SettingsCard>,
    );
    expect(screen.getByText('corps isolé')).toBeTruthy();
  });

  it('is found by a keyword that the title does not carry', async () => {
    render(<Page />);
    await chercher('filigrane');
    expect(screen.getByText('Burn-ins')).toBeTruthy();
    expect(screen.queryByText('Stockage')).toBeNull();
  });

  it('is also found through its help and its note', async () => {
    render(<Page />);
    await chercher('template');
    expect(screen.getByText('Burn-ins')).toBeTruthy();
    await chercher('bas de panneau');
    expect(screen.getByText('Stockage')).toBeTruthy();
    expect(screen.queryByText('Burn-ins')).toBeNull();
  });

  it('says "no settings" only when really nothing remains', async () => {
    render(<Page />);
    expect(screen.queryByText(t('admin.search.empty'))).toBeNull();
    await chercher('quota');
    expect(screen.queryByText(t('admin.search.empty'))).toBeNull();
    await chercher('zzzz');
    expect(screen.getByText(t('admin.search.empty'))).toBeTruthy();
  });

  it('renders everything again when the search is cleared', async () => {
    render(<Page />);
    await chercher('quota');
    expect(screen.queryByText('Burn-ins')).toBeNull();
    await chercher('');
    expect(screen.getByText('Burn-ins')).toBeTruthy();
    expect(screen.getByText('Stockage')).toBeTruthy();
  });
});
