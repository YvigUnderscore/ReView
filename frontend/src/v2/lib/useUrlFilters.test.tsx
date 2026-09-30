// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useUrlFilters } from './useUrlFilters';

/**
 * Les filtres d'une liste vivaient en `useState` : appliquer « Waiting to Start » puis
 * partager le lien ouvrait la liste entière chez le destinataire, et un simple F5 effaçait
 * le tri qu'on venait de poser. La page projet avait pourtant déjà fait — et documenté —
 * le choix inverse pour son onglet courant.
 */
function Harness({ prefix }: { prefix?: string }) {
  const [filters, setFilters] = useUrlFilters(prefix);
  const { search } = useLocation();
  return (
    <div>
      <output data-testid="status">{filters.status}</output>
      <output data-testid="text">{filters.text}</output>
      <output data-testid="search">{search}</output>
      <button onClick={() => setFilters({ ...filters, status: 'wtg' })}>filtrer</button>
      <button onClick={() => setFilters({ ...filters, status: '' })}>effacer</button>
    </div>
  );
}

const mount = (initial = '/projects/1', prefix?: string) =>
  render(
    <MemoryRouter initialEntries={[initial]}>
      <Harness prefix={prefix} />
    </MemoryRouter>,
  );

describe('useUrlFilters', () => {
  it('lit les filtres depuis l’URL au montage — un lien partagé rouvre le même écran', () => {
    mount('/projects/1?status=wtg&text=sh010');
    expect(screen.getByTestId('status').textContent).toBe('wtg');
    expect(screen.getByTestId('text').textContent).toBe('sh010');
  });

  it('écrit le filtre appliqué dans l’URL', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'filtrer' }));
    expect(screen.getByTestId('search').textContent).toContain('status=wtg');
  });

  it('retire le paramètre quand le filtre est vidé : pas d’URL encombrée', async () => {
    const user = userEvent.setup();
    mount('/projects/1?status=wtg');
    await user.click(screen.getByRole('button', { name: 'effacer' }));
    expect(screen.getByTestId('search').textContent).not.toContain('status');
  });

  it('préserve les paramètres étrangers, dont l’onglet courant de la page projet', async () => {
    const user = userEvent.setup();
    mount('/projects/1?tab=shots');
    await user.click(screen.getByRole('button', { name: 'filtrer' }));
    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).toContain('tab=shots');
    expect(search).toContain('status=wtg');
  });

  it('préfixe les paramètres : deux listes d’une même page ne s’écrasent pas', async () => {
    const user = userEvent.setup();
    mount('/projects/1', 'assets');
    await user.click(screen.getByRole('button', { name: 'filtrer' }));
    expect(screen.getByTestId('search').textContent).toContain('assets_status=wtg');
  });

  it('ignore un préfixe étranger', () => {
    mount('/projects/1?shots_status=wtg', 'assets');
    expect(screen.getByTestId('status').textContent).toBe('');
  });
});
