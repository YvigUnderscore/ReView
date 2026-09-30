// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { emptyAnim, upsertKey, type ChannelId } from '../channels/model';
import { useCurveView } from './useCurveView';

// Deux clés sur `px` : 0 → 10 en une seconde.
const anim = upsertKey(upsertKey(emptyAnim(), 'px', 0, 0), 'px', 1000, 10);
const visible: ReadonlySet<ChannelId> = new Set<ChannelId>(['px']);

const setup = () =>
  renderHook(() => useCurveView({ anim, visible, playDuration: 1000, width: 100, height: 100 })).result;

describe('useCurveView — fenêtres automatiques', () => {
  it('le temps couvre la durée avec de l’air, plancher de 3 s', () => {
    const r = setup();
    expect(r.current.timeView).toEqual({ t0: 0, t1: 3000, width: 100 });
  });

  it('les valeurs s’ajustent aux clés visibles', () => {
    const r = setup();
    expect(r.current.valueView).toEqual({ v0: -1, v1: 11, height: 100 });
  });
});

describe('useCurveView — zoom, pan et recadrages', () => {
  it('le zoom temporel pose un override que la durée ne reprend plus', () => {
    const r = setup();
    act(() => r.current.zoomAt(0, 0.5));
    expect(r.current.timeView.t1).toBe(1500);
    act(() => r.current.panBy(100));
    expect(r.current.timeView.t0).toBe(100);
    expect(r.current.timeView.t1).toBe(1600);
  });

  it('le zoom vertical et le pan vertical figent l’axe des valeurs', () => {
    const r = setup();
    act(() => r.current.zoomValueAt(5, 0.5));
    expect(r.current.valueView.v0).toBe(2);
    expect(r.current.valueView.v1).toBe(8);
    act(() => r.current.panBy(0, 1));
    expect(r.current.valueView).toEqual({ v0: 3, v1: 9, height: 100 });
  });

  it('« ajuster » rend les deux axes à leur calcul automatique', () => {
    const r = setup();
    act(() => r.current.zoomAt(0, 0.5));
    act(() => r.current.zoomValueAt(5, 0.5));
    act(() => r.current.fitAll());
    expect(r.current.timeView).toEqual({ t0: 0, t1: 3000, width: 100 });
    expect(r.current.valueView).toEqual({ v0: -1, v1: 11, height: 100 });
  });

  it('le cadrage d’une sélection borne les deux axes sur ses clés', () => {
    const r = setup();
    act(() => r.current.fitKeys([{ channel: 'px', index: 1 }]));
    // Une clé seule : une seconde de part et d'autre, et de l'air en valeur.
    expect(r.current.timeView).toEqual({ t0: 0, t1: 2000, width: 100 });
    expect(r.current.valueView.v0).toBeLessThan(10);
    expect(r.current.valueView.v1).toBeGreaterThan(10);
  });

  it('une sélection vide ou introuvable ne bouge pas la vue', () => {
    const r = setup();
    act(() => r.current.fitKeys([]));
    act(() => r.current.fitKeys([{ channel: 'py', index: 3 }]));
    expect(r.current.timeView).toEqual({ t0: 0, t1: 3000, width: 100 });
  });

  it('le cadrage d’une seule courbe ne touche que l’axe des valeurs', () => {
    const r = setup();
    act(() => r.current.fitValues([0, 100]));
    expect(r.current.valueView).toEqual({ v0: -10, v1: 110, height: 100 });
    expect(r.current.timeView.t1).toBe(3000);
    act(() => r.current.fitValues([]));
    expect(r.current.valueView.v1).toBe(110);
  });
});
