// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsCard } from './SettingsCard';
import { SettingsSearchBar, SettingsSearchEmpty, SettingsSearchProvider } from './SettingsSearch';
import { t } from '../../i18n';

/**
 * La carte de réglages et sa recherche.
 *
 * Trois propriétés qu'aucun module pur ne peut affirmer : une carte posée hors fournisseur
 * s'affiche quand même (elle doit pouvoir servir dans un dialogue), la recherche masque ce
 * qui ne répond pas, et le message « aucun réglage » ne sort que quand il ne reste
 * réellement rien — sinon la page paraîtrait vide à tort.
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
  it('rend son titre, son aide et sa note de bas de panneau', () => {
    render(<Page />);
    expect(screen.getByText('Burn-ins')).toBeTruthy();
    expect(screen.getByText('Template studio')).toBeTruthy();
    expect(screen.getByText('note de bas de panneau')).toBeTruthy();
  });

  it('s’affiche hors fournisseur — la recherche est une option, pas une dépendance', () => {
    render(
      <SettingsCard title="Isolée">
        <p>corps isolé</p>
      </SettingsCard>,
    );
    expect(screen.getByText('corps isolé')).toBeTruthy();
  });

  it('se trouve par un mot-clé que le titre ne porte pas', async () => {
    render(<Page />);
    await chercher('filigrane');
    expect(screen.getByText('Burn-ins')).toBeTruthy();
    expect(screen.queryByText('Stockage')).toBeNull();
  });

  it('se trouve aussi par son aide et par sa note', async () => {
    render(<Page />);
    await chercher('template');
    expect(screen.getByText('Burn-ins')).toBeTruthy();
    await chercher('bas de panneau');
    expect(screen.getByText('Stockage')).toBeTruthy();
    expect(screen.queryByText('Burn-ins')).toBeNull();
  });

  it('ne dit « aucun réglage » que lorsqu’il ne reste vraiment rien', async () => {
    render(<Page />);
    expect(screen.queryByText(t('admin.search.empty'))).toBeNull();
    await chercher('quota');
    expect(screen.queryByText(t('admin.search.empty'))).toBeNull();
    await chercher('zzzz');
    expect(screen.getByText(t('admin.search.empty'))).toBeTruthy();
  });

  it('rend tout à nouveau quand la recherche se vide', async () => {
    render(<Page />);
    await chercher('quota');
    expect(screen.queryByText('Burn-ins')).toBeNull();
    await chercher('');
    expect(screen.getByText('Burn-ins')).toBeTruthy();
    expect(screen.getByText('Stockage')).toBeTruthy();
  });
});
