// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, afterEach } from 'vitest';
import { useTheme } from './useTheme';

const hasDark = () => document.documentElement.classList.contains('dark');

describe('useTheme — system/light/dark theme (42.A1)', () => {
  afterEach(() => useTheme.getState().setMode('dark'));

  it('forces light mode: no dark class', () => {
    useTheme.getState().setMode('light');
    expect(useTheme.getState().mode).toBe('light');
    expect(useTheme.getState().theme).toBe('light');
    expect(hasDark()).toBe(false);
    expect(localStorage.getItem('review:theme')).toBe('light');
  });

  it('forces dark mode: dark class set', () => {
    useTheme.getState().setMode('light');
    useTheme.getState().setMode('dark');
    expect(useTheme.getState().theme).toBe('dark');
    expect(hasDark()).toBe(true);
  });

  it('system mode: effective theme derived from the OS', () => {
    useTheme.getState().setMode('system');
    expect(useTheme.getState().mode).toBe('system');
    expect(['dark', 'light']).toContain(useTheme.getState().theme);
  });

  it('toggle pins the inverse effective theme', () => {
    useTheme.getState().setMode('dark');
    useTheme.getState().toggle();
    expect(useTheme.getState().mode).toBe('light');
    expect(useTheme.getState().theme).toBe('light');
    useTheme.getState().toggle();
    expect(useTheme.getState().mode).toBe('dark');
  });
});
