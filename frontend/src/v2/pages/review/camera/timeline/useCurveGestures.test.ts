// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PointerEvent as ReactPointerEvent } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { emptyAnim, upsertKey, type KeyRef } from '../channels/model';
import { inSel, useCurveGestures, type TangentSide } from './useCurveGestures';
import type { TimeView, ValueView } from './viewTransform';

// Vue calibrée pour des comptes ronds : 1 px = 10 ms en X, 1 px = 1 unité en Y (axe inversé).
const tv: TimeView = { t0: 0, t1: 1000, width: 100 };
const vv: ValueView = { v0: 0, v1: 100, height: 100 };

// Deux clés sur `px` : (t=0, v=0) dessinée en (0, 100), (t=500, v=50) dessinée en (50, 50).
const anim = upsertKey(upsertKey(emptyAnim(), 'px', 0, 0), 'px', 500, 50);

/**
 * Événement pointeur minimal : le hook ne lit que ces champs. Le `svgRef` n'étant jamais attaché en
 * test, le rectangle du SVG vaut l'origine — les coordonnées client sont donc les coordonnées locales.
 */
function ptr(x: number, y: number, opts: { shift?: boolean; onKey?: boolean } = {}) {
  const el = { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() };
  const e = {
    clientX: x,
    clientY: y,
    pointerId: 7,
    shiftKey: opts.shift ?? false,
    currentTarget: el,
    // Un geste sur une clé/poignée a un `target` distinct du `currentTarget` du fond.
    target: opts.onKey ? {} : el,
    stopPropagation: vi.fn(),
  };
  return { e: e as unknown as ReactPointerEvent, el };
}

function setup(over: { selection?: readonly KeyRef[]; editable?: boolean } = {}) {
  const cb = {
    onScrub: vi.fn(),
    onSelect: vi.fn(),
    onBeginStroke: vi.fn(),
    onMoveKeys: vi.fn(),
    onSetTangent: vi.fn(),
  };
  const { result } = renderHook(() =>
    useCurveGestures({
      anim,
      timeView: tv,
      valueView: vv,
      selection: over.selection ?? [],
      editable: over.editable ?? true,
      bandChannels: ['px'],
      ...cb,
    }),
  );
  return { result, cb };
}

describe('inSel', () => {
  it('reconnaît une clé de la sélection, canal et index confondus', () => {
    const sel: KeyRef[] = [{ channel: 'px', index: 1 }];
    expect(inSel(sel, 'px', 1)).toBe(true);
    expect(inSel(sel, 'px', 0)).toBe(false);
    expect(inSel(sel, 'py', 1)).toBe(false);
  });
});

describe('useCurveGestures — rubber-band', () => {
  it('sélectionne les clés contenues dans le rectangle', () => {
    const { result, cb } = setup();
    act(() => result.current.surface.onPointerDown(ptr(40, 40).e));
    act(() => result.current.surface.onPointerMove(ptr(60, 60).e));
    expect(result.current.band).toEqual({ x0: 40, y0: 40, x1: 60, y1: 60 });
    act(() => result.current.surface.onPointerUp(ptr(60, 60).e));
    // Seule la clé dessinée en (50, 50) est dans le rectangle.
    expect(cb.onSelect).toHaveBeenCalledWith([{ channel: 'px', index: 1 }]);
    expect(cb.onScrub).not.toHaveBeenCalled();
    expect(result.current.band).toBeNull();
  });

  it('avec Maj, ajoute à la sélection sans doublon', () => {
    const { result, cb } = setup({ selection: [{ channel: 'px', index: 0 }] });
    act(() => result.current.surface.onPointerDown(ptr(40, 40).e));
    act(() => result.current.surface.onPointerMove(ptr(60, 60).e));
    act(() => result.current.surface.onPointerUp(ptr(60, 60, { shift: true }).e));
    expect(cb.onSelect).toHaveBeenCalledWith([
      { channel: 'px', index: 0 },
      { channel: 'px', index: 1 },
    ]);
  });

  it('un clic sans déplacement scrube au lieu de sélectionner', () => {
    const { result, cb } = setup();
    act(() => result.current.surface.onPointerDown(ptr(30, 30).e));
    act(() => result.current.surface.onPointerUp(ptr(31, 30).e));
    expect(cb.onScrub).toHaveBeenCalledWith(300);
    expect(cb.onSelect).not.toHaveBeenCalled();
  });

  it('ignore un pointerdown qui ne vient pas du fond du graphe', () => {
    const { result, cb } = setup();
    act(() => result.current.surface.onPointerDown(ptr(40, 40, { onKey: true }).e));
    act(() => result.current.surface.onPointerMove(ptr(60, 60).e));
    act(() => result.current.surface.onPointerUp(ptr(60, 60).e));
    expect(result.current.band).toBeNull();
    expect(cb.onSelect).not.toHaveBeenCalled();
    expect(cb.onScrub).not.toHaveBeenCalled();
  });
});

describe('useCurveGestures — déplacement de clés', () => {
  it('sélectionne la clé, capture le pointeur puis rejoue le delta depuis la baseline', () => {
    const { result, cb } = setup();
    const down = ptr(50, 50);
    act(() => result.current.startKeyGesture(down.e, 'px', 1));
    expect(cb.onSelect).toHaveBeenCalledWith([{ channel: 'px', index: 1 }]);
    expect(cb.onBeginStroke).toHaveBeenCalledTimes(1);
    expect(down.el.setPointerCapture).toHaveBeenCalledWith(7);

    // +10 px en X = +100 ms ; −10 px en Y = +10 en valeur (axe inversé).
    act(() => result.current.surface.onPointerMove(ptr(60, 40).e));
    expect(cb.onMoveKeys).toHaveBeenCalledWith(anim, [{ channel: 'px', index: 1, t: 600, v: 60 }]);
    // Deuxième frame : toujours calculée depuis la même baseline, jamais cumulée.
    act(() => result.current.surface.onPointerMove(ptr(70, 40).e));
    expect(cb.onMoveKeys).toHaveBeenLastCalledWith(anim, [{ channel: 'px', index: 1, t: 700, v: 60 }]);
  });

  it('déplace toute la sélection en un seul geste', () => {
    const selection: KeyRef[] = [
      { channel: 'px', index: 0 },
      { channel: 'px', index: 1 },
    ];
    const { result, cb } = setup({ selection });
    act(() => result.current.startKeyGesture(ptr(50, 50).e, 'px', 1));
    // Clé déjà sélectionnée sans Maj : la sélection est conservée telle quelle.
    expect(cb.onSelect).toHaveBeenCalledWith(selection);
    act(() => result.current.surface.onPointerMove(ptr(60, 50).e));
    expect(cb.onMoveKeys).toHaveBeenCalledWith(anim, [
      { channel: 'px', index: 0, t: 100, v: 0 },
      { channel: 'px', index: 1, t: 600, v: 50 },
    ]);
  });

  it('Maj sur une clé déjà sélectionnée la retire et n’arme aucun geste', () => {
    const { result, cb } = setup({
      selection: [
        { channel: 'px', index: 0 },
        { channel: 'px', index: 1 },
      ],
    });
    act(() => result.current.startKeyGesture(ptr(50, 50, { shift: true }).e, 'px', 1));
    expect(cb.onSelect).toHaveBeenCalledWith([{ channel: 'px', index: 0 }]);
    expect(cb.onBeginStroke).not.toHaveBeenCalled();
    act(() => result.current.surface.onPointerMove(ptr(60, 40).e));
    expect(cb.onMoveKeys).not.toHaveBeenCalled();
  });

  it('en lecture seule, la clé se sélectionne mais ne se déplace pas', () => {
    const { result, cb } = setup({ editable: false });
    act(() => result.current.startKeyGesture(ptr(50, 50).e, 'px', 1));
    expect(cb.onSelect).toHaveBeenCalledWith([{ channel: 'px', index: 1 }]);
    expect(cb.onBeginStroke).not.toHaveBeenCalled();
    act(() => result.current.surface.onPointerMove(ptr(60, 40).e));
    expect(cb.onMoveKeys).not.toHaveBeenCalled();
  });
});

describe('useCurveGestures — tangentes', () => {
  it.each<[TangentSide, 'tin' | 'tout']>([
    ['out', 'tout'],
    ['in', 'tin'],
  ])('le côté %s écrit la pente dans %s', (side, patchKey) => {
    const { result, cb } = setup();
    act(() => result.current.startTangentGesture(ptr(50, 50).e, side, 'px', 1));
    expect(cb.onBeginStroke).toHaveBeenCalledTimes(1);
    // Pointeur en (60, 40) : Δt = +100 ms, Δv = +10 → pente 0,1 unité/ms.
    act(() => result.current.surface.onPointerMove(ptr(60, 40).e));
    expect(cb.onSetTangent).toHaveBeenCalledWith('px', 1, { [patchKey]: 0.1 });
  });

  it('à l’aplomb de la clé, la pente n’a pas de sens : rien n’est écrit', () => {
    const { result, cb } = setup();
    act(() => result.current.startTangentGesture(ptr(50, 50).e, 'out', 'px', 1));
    act(() => result.current.surface.onPointerMove(ptr(50, 20).e));
    expect(cb.onSetTangent).not.toHaveBeenCalled();
  });

  it('sur une clé disparue, le geste reste inerte', () => {
    const { result, cb } = setup();
    act(() => result.current.startTangentGesture(ptr(50, 50).e, 'out', 'px', 42));
    act(() => result.current.surface.onPointerMove(ptr(60, 40).e));
    expect(cb.onSetTangent).not.toHaveBeenCalled();
  });
});
