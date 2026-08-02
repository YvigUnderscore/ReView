// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, afterEach } from 'vitest';
import { useTheme } from './useTheme';

const hasDark = () => document.documentElement.classList.contains('dark');

describe('useTheme — thème système/clair/sombre (42.A1)', () => {
  afterEach(() => useTheme.getState().setMode('dark'));

  it('force le mode clair : pas de classe dark', () => {
    useTheme.getState().setMode('light');
    expect(useTheme.getState().mode).toBe('light');
    expect(useTheme.getState().theme).toBe('light');
    expect(hasDark()).toBe(false);
    expect(localStorage.getItem('review:theme')).toBe('light');
  });

  it('force le mode sombre : classe dark posée', () => {
    useTheme.getState().setMode('light');
    useTheme.getState().setMode('dark');
    expect(useTheme.getState().theme).toBe('dark');
    expect(hasDark()).toBe(true);
  });

  it("mode système : thème effectif dérivé de l'OS", () => {
    useTheme.getState().setMode('system');
    expect(useTheme.getState().mode).toBe('system');
    expect(['dark', 'light']).toContain(useTheme.getState().theme);
  });

  it('toggle fige le thème effectif inverse', () => {
    useTheme.getState().setMode('dark');
    useTheme.getState().toggle();
    expect(useTheme.getState().mode).toBe('light');
    expect(useTheme.getState().theme).toBe('light');
    useTheme.getState().toggle();
    expect(useTheme.getState().mode).toBe('dark');
  });
});
