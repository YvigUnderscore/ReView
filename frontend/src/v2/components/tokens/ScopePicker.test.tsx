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
 * The picker knows no scopes: it formats the ones the server serves. That is why a scope
 * removed from the catalogue disappears from the screen without anyone touching it, and
 * what these tests protect.
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
  it('only displays the scopes served by the server', () => {
    catalog.current = { scopes: ['shots:read', 'shots:write', 'events:read'], legacy: [] };
    render(<Harness />);
    expect(screen.getByText('shots')).toBeTruthy();
    expect(screen.getByText('events')).toBeTruthy();
    // events has no catalogue write: two checkboxes for shots, one for events.
    expect(boxes()).toHaveLength(3);
  });

  it('grants read along with write', () => {
    catalog.current = { scopes: ['shots:read', 'shots:write'], legacy: [] };
    render(<Harness />);
    fireEvent.click(boxes()[1]);
    expect(selection()?.split(' ').sort()).toEqual(['shots:read', 'shots:write']);
    expect(boxes()[0]?.getAttribute('aria-checked')).toBe('true');
  });

  it('ticks everything and locks the grid under `admin`', () => {
    catalog.current = { scopes: ['shots:read', 'admin'], legacy: [] };
    render(<Harness />);
    const admin = boxes()[1];
    fireEvent.click(admin);
    expect(selection()).toBe('admin');
    const domain = boxes()[0];
    expect(domain.getAttribute('aria-checked')).toBe('true');
    expect(domain.hasAttribute('disabled')).toBe(true);
  });

  it('flags an unavailable catalogue rather than showing an empty grid', () => {
    catalog.current = { scopes: [], legacy: [] };
    state.isError = true;
    render(<Harness />);
    // The translated label, not the key: the English catalogue is loaded in tests.
    expect(screen.getByText('The permission catalogue could not be loaded.')).toBeTruthy();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('waits for the catalogue before offering anything', () => {
    catalog.current = { scopes: [], legacy: [] };
    state.isPending = true;
    render(<Harness />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });
});
