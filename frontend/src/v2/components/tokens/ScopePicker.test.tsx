// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const catalog = { current: { scopes: [] as string[], legacy: [] as string[] } };
const state = { isPending: false, isError: false };

vi.mock('./tokenApi', () => ({
  useScopeCatalog: () => ({ data: catalog.current, ...state }),
}));

import ScopePicker from './ScopePicker';

/**
 * Le sélecteur ne connaît aucun scope : il met en forme celui que le serveur sert. C'est
 * ce qui fait qu'un scope retiré du catalogue disparaît de l'écran sans qu'on y touche —
 * et ce que ces tests protègent.
 */
function Harness({ initial = [] as string[] }) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <>
      <ScopePicker value={value} onChange={setValue} />
      <output>{value.join(' ')}</output>
    </>
  );
}

const boxes = () => screen.getAllByRole('checkbox');
const selection = () => screen.getByRole('status').textContent;

afterEach(() => {
  cleanup();
  state.isPending = false;
  state.isError = false;
});

describe('ScopePicker', () => {
  it('n’affiche que les scopes servis par le serveur', () => {
    catalog.current = { scopes: ['shots:read', 'shots:write', 'events:read'], legacy: [] };
    render(<Harness />);
    expect(screen.getByText('shots')).toBeTruthy();
    expect(screen.getByText('events')).toBeTruthy();
    // events n'a pas d'écriture au catalogue : deux cases pour shots, une pour events.
    expect(boxes()).toHaveLength(3);
  });

  it('accorde la lecture avec l’écriture', () => {
    catalog.current = { scopes: ['shots:read', 'shots:write'], legacy: [] };
    render(<Harness />);
    fireEvent.click(boxes()[1]);
    expect(selection()?.split(' ').sort()).toEqual(['shots:read', 'shots:write']);
    expect(boxes()[0]?.getAttribute('aria-checked')).toBe('true');
  });

  it('coche tout et verrouille la grille sous `admin`', () => {
    catalog.current = { scopes: ['shots:read', 'admin'], legacy: [] };
    render(<Harness />);
    const admin = boxes()[1];
    fireEvent.click(admin);
    expect(selection()).toBe('admin');
    const domain = boxes()[0];
    expect(domain.getAttribute('aria-checked')).toBe('true');
    expect(domain.hasAttribute('disabled')).toBe(true);
  });

  it('signale un catalogue indisponible plutôt que d’afficher une grille vide', () => {
    catalog.current = { scopes: [], legacy: [] };
    state.isError = true;
    render(<Harness />);
    // Le libellé traduit, et non la clé : le catalogue anglais est chargé dans les tests.
    expect(screen.getByText('The permission catalogue could not be loaded.')).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('attend le catalogue avant de proposer quoi que ce soit', () => {
    catalog.current = { scopes: [], legacy: [] };
    state.isPending = true;
    render(<Harness />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
