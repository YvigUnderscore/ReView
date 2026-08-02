// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { useGuides } from './useGuides';

describe('useGuides — guides de composition (34.G)', () => {
  it('tout éteint par défaut ; toggle bascule et persiste', () => {
    expect(useGuides.getState().guides).toEqual({
      thirds: false,
      center: false,
      actionSafe: false,
      titleSafe: false,
    });
    useGuides.getState().toggle('thirds');
    useGuides.getState().toggle('actionSafe');
    expect(useGuides.getState().guides.thirds).toBe(true);
    expect(useGuides.getState().guides.actionSafe).toBe(true);
    expect(JSON.parse(localStorage.getItem('review:guides')!)).toMatchObject({
      thirds: true,
      actionSafe: true,
      center: false,
    });
    useGuides.getState().toggle('thirds');
    expect(useGuides.getState().guides.thirds).toBe(false);
  });
});
