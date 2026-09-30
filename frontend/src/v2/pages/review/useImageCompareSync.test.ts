// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it, vi } from 'vitest';
import { createViewSync, viewsEqual } from './useImageCompareSync';

const view = (scale: number, cx = 0.5, cy = 0.5) => ({ scale, cx, cy });

describe('viewsEqual — égalité de vues à epsilon près (34.D)', () => {
  it('égalité stricte et tolérance epsilon', () => {
    expect(viewsEqual(view(2), view(2))).toBe(true);
    expect(viewsEqual(view(2), view(2 + 1e-5))).toBe(true);
    expect(viewsEqual(view(2), view(2.1))).toBe(false);
    expect(viewsEqual(view(2, 0.5), view(2, 0.6))).toBe(false);
    expect(viewsEqual(null, view(2))).toBe(false);
  });
});

describe('createViewSync — relais A↔B sans boucle (34.D)', () => {
  it('propage la vue du maître vers le pane B', () => {
    const sync = createViewSync();
    const applyB = vi.fn();
    expect(sync.fromMaster(view(2), applyB)).toBe(true);
    expect(applyB).toHaveBeenCalledWith(view(2));
  });

  it('coupe l’écho : la vue ré-émise par B après application est ignorée', () => {
    const sync = createViewSync();
    const applyB = vi.fn();
    const applyA = vi.fn();
    sync.fromSlave(view(1), applyA, applyB); // fit initial de B (consommé)
    sync.fromMaster(view(2), applyB); // A → B
    expect(sync.fromSlave(view(2 + 1e-5), applyA, applyB)).toBe(false);
    expect(applyA).not.toHaveBeenCalled();
  });

  it('le fit initial de B adopte la vue du maître au lieu de l’écraser', () => {
    const sync = createViewSync();
    const applyA = vi.fn();
    const applyB = vi.fn();
    sync.fromMaster(view(3, 0.2, 0.8), null); // le maître est déjà zoomé, B pas monté
    sync.fromSlave(view(1), applyA, applyB); // fit initial de B
    expect(applyA).not.toHaveBeenCalled();
    expect(applyB).toHaveBeenCalledWith(view(3, 0.2, 0.8));
  });

  it('reste bidirectionnel : une vraie manipulation de B repart vers A', () => {
    const sync = createViewSync();
    const applyA = vi.fn();
    sync.fromSlave(view(1), applyA, null); // fit initial (consommé)
    expect(sync.fromSlave(view(3), applyA, null)).toBe(true);
    expect(applyA).toHaveBeenCalledWith(view(3));
  });
});
