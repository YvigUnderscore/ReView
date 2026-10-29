// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { useUrlFilters } from './useUrlFilters';

/**
 * List filters used to live in `useState`: applying "Waiting to Start" then
 * sharing the link opened the whole list for the recipient, and a simple F5 erased
 * the sort just set. The project page had nevertheless already made — and documented —
 * the opposite choice for its current tab.
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
  it('reads the filters from the URL on mount — a shared link reopens the same screen', () => {
    mount('/projects/1?status=wtg&text=sh010');
    expect(screen.getByTestId('status').textContent).toBe('wtg');
    expect(screen.getByTestId('text').textContent).toBe('sh010');
  });

  it('writes the applied filter into the URL', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: 'filtrer' }));
    expect(screen.getByTestId('search').textContent).toContain('status=wtg');
  });

  it('removes the parameter when the filter is cleared: no cluttered URL', async () => {
    const user = userEvent.setup();
    mount('/projects/1?status=wtg');
    await user.click(screen.getByRole('button', { name: 'effacer' }));
    expect(screen.getByTestId('search').textContent).not.toContain('status');
  });

  it('preserves foreign parameters, including the project page’s current tab', async () => {
    const user = userEvent.setup();
    mount('/projects/1?tab=shots');
    await user.click(screen.getByRole('button', { name: 'filtrer' }));
    const search = screen.getByTestId('search').textContent ?? '';
    expect(search).toContain('tab=shots');
    expect(search).toContain('status=wtg');
  });

  it('prefixes parameters: two lists on the same page do not overwrite each other', async () => {
    const user = userEvent.setup();
    mount('/projects/1', 'assets');
    await user.click(screen.getByRole('button', { name: 'filtrer' }));
    expect(screen.getByTestId('search').textContent).toContain('assets_status=wtg');
  });

  it('ignores a foreign prefix', () => {
    mount('/projects/1?shots_status=wtg', 'assets');
    expect(screen.getByTestId('status').textContent).toBe('');
  });
});
