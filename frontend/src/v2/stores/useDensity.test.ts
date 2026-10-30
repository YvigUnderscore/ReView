// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, it, expect, afterEach } from 'vitest';
import { useDensity } from './useDensity';

const attr = () => document.documentElement.getAttribute('data-density');

describe('useDensity — display density (42.A1)', () => {
  afterEach(() => useDensity.getState().setDensity('comfortable'));

  it('applique data-density sur <html>', () => {
    // The attribute is set as soon as the module is imported (initial value: comfortable by default).
    expect(attr()).toBe('comfortable');
  });

  it('switches to compact: attribute + persistence + state', () => {
    useDensity.getState().setDensity('compact');
    expect(useDensity.getState().density).toBe('compact');
    expect(attr()).toBe('compact');
    expect(localStorage.getItem('review:density')).toBe('compact');
  });

  it('goes back to comfortable', () => {
    useDensity.getState().setDensity('compact');
    useDensity.getState().setDensity('comfortable');
    expect(useDensity.getState().density).toBe('comfortable');
    expect(attr()).toBe('comfortable');
  });
});
