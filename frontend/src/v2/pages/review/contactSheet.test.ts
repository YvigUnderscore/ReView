// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from 'vitest';
import { contactSheetLayout } from './contactSheet';
import type { TimelineSpriteMeta } from './timelineSprite';

const meta: TimelineSpriteMeta = { intervalSec: 3, count: 5, cols: 3, rows: 2, tileW: 100, tileH: 56 };

describe('contactSheetLayout — planche contact (34.H)', () => {
  it('dimensionne bandeau + grille + labels (2 rangées pour 5 vignettes sur 3 colonnes)', () => {
    const l = contactSheetLayout(meta);
    expect(l.width).toBe(8 + 3 * 108); // gap + cols·(tileW+gap)
    expect(l.height).toBe(44 + 8 + 2 * (56 + 18 + 8)); // header + gap + rows·(tileH+labelH+gap)
  });

  it('place les vignettes en grille ligne par ligne', () => {
    const l = contactSheetLayout(meta);
    expect(l.cell(0)).toEqual({ x: 8, y: 44 + 8 });
    expect(l.cell(2)).toEqual({ x: 8 + 2 * 108, y: 44 + 8 });
    expect(l.cell(3)).toEqual({ x: 8, y: 44 + 8 + (56 + 18 + 8) });
  });
});
