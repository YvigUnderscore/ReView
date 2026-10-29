// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PointerEvent as ReactPointerEvent } from 'react';
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { emptyAnim, upsertKey, type KeyRef } from '../channels/model';
import { setWeighted } from '../channels/tangents';
import { inSel, useCurveGestures, type TangentSide } from './useCurveGestures';
import type { TimeView, ValueView } from './viewTransform';

// View calibrated for round numbers: 1 px = 10 ms on X, 1 px = 1 unit on Y (inverted axis).
const tv: TimeView = { t0: 0, t1: 1000, width: 100 };
const vv: ValueView = { v0: 0, v1: 100, height: 100 };

// Two keys on `px`: (t=0, v=0) drawn at (0, 100), (t=500, v=50) drawn at (50, 50).
const anim = upsertKey(upsertKey(emptyAnim(), 'px', 0, 0), 'px', 500, 50);

/**
 * Minimal pointer event: the hook only reads these fields. The `svgRef` is never attached in tests,
 * so the SVG rectangle is the origin — client coordinates are therefore the local coordinates.
 */
function ptr(
  x: number,
  y: number,
  opts: { shift?: boolean; alt?: boolean; onKey?: boolean; button?: number } = {},
) {
  const el = { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() };
  const e = {
    clientX: x,
    clientY: y,
    pointerId: 7,
    button: opts.button ?? 0,
    shiftKey: opts.shift ?? false,
    altKey: opts.alt ?? false,
    currentTarget: el,
    // A gesture on a key/handle has a `target` distinct from the background's `currentTarget`.
    target: opts.onKey ? {} : el,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  };
  return { e: e as unknown as ReactPointerEvent, el };
}

/**
 * 10 fps: a frame is exactly 100 ms, i.e. 10 px in this calibrated view (1 px = 10 ms). The snap
 * of moved keys therefore lands on readable numbers.
 */
const FPS = 10;

function setup(over: { selection?: readonly KeyRef[]; editable?: boolean; anim?: typeof anim } = {}) {
  const cb = {
    onScrub: vi.fn(),
    onSelect: vi.fn(),
    onBeginStroke: vi.fn(),
    onMoveKeys: vi.fn(),
    onSetTangent: vi.fn(),
    onPanView: vi.fn(),
  };
  const { result } = renderHook(() =>
    useCurveGestures({
      anim: over.anim ?? anim,
      timeView: tv,
      valueView: vv,
      selection: over.selection ?? [],
      editable: over.editable ?? true,
      fps: FPS,
      bandChannels: ['px'],
      ...cb,
    }),
  );
  return { result, cb };
}

describe('inSel', () => {
  it('recognizes a key in the selection, channel and index combined', () => {
    const sel: KeyRef[] = [{ channel: 'px', index: 1 }];
    expect(inSel(sel, 'px', 1)).toBe(true);
    expect(inSel(sel, 'px', 0)).toBe(false);
    expect(inSel(sel, 'py', 1)).toBe(false);
  });
});

describe('useCurveGestures — rubber-band', () => {
  it('selects the keys contained in the rectangle', () => {
    const { result, cb } = setup();
    act(() => result.current.surface.onPointerDown(ptr(40, 40).e));
    act(() => result.current.surface.onPointerMove(ptr(60, 60).e));
    expect(result.current.band).toEqual({ x0: 40, y0: 40, x1: 60, y1: 60 });
    act(() => result.current.surface.onPointerUp(ptr(60, 60).e));
    // Only the key drawn at (50, 50) is inside the rectangle.
    expect(cb.onSelect).toHaveBeenCalledWith([{ channel: 'px', index: 1 }]);
    expect(cb.onScrub).not.toHaveBeenCalled();
    expect(result.current.band).toBeNull();
  });

  it('with Shift, adds to the selection without duplicates', () => {
    const { result, cb } = setup({ selection: [{ channel: 'px', index: 0 }] });
    act(() => result.current.surface.onPointerDown(ptr(40, 40).e));
    act(() => result.current.surface.onPointerMove(ptr(60, 60).e));
    act(() => result.current.surface.onPointerUp(ptr(60, 60, { shift: true }).e));
    expect(cb.onSelect).toHaveBeenCalledWith([
      { channel: 'px', index: 0 },
      { channel: 'px', index: 1 },
    ]);
  });

  it('a click without movement scrubs instead of selecting', () => {
    const { result, cb } = setup();
    act(() => result.current.surface.onPointerDown(ptr(30, 30).e));
    act(() => result.current.surface.onPointerUp(ptr(31, 30).e));
    expect(cb.onScrub).toHaveBeenCalledWith(300);
    expect(cb.onSelect).not.toHaveBeenCalled();
  });

  it('ignores a pointerdown that does not come from the graph background', () => {
    const { result, cb } = setup();
    act(() => result.current.surface.onPointerDown(ptr(40, 40, { onKey: true }).e));
    act(() => result.current.surface.onPointerMove(ptr(60, 60).e));
    act(() => result.current.surface.onPointerUp(ptr(60, 60).e));
    expect(result.current.band).toBeNull();
    expect(cb.onSelect).not.toHaveBeenCalled();
    expect(cb.onScrub).not.toHaveBeenCalled();
  });
});

describe('useCurveGestures — key move', () => {
  it('selects the key, captures the pointer, then replays the delta from the baseline', () => {
    const { result, cb } = setup();
    const down = ptr(50, 50);
    act(() => result.current.startKeyGesture(down.e, 'px', 1));
    expect(cb.onSelect).toHaveBeenCalledWith([{ channel: 'px', index: 1 }]);
    expect(cb.onBeginStroke).toHaveBeenCalledTimes(1);
    expect(down.el.setPointerCapture).toHaveBeenCalledWith(7);

    // +10 px on X = +100 ms; −10 px on Y = +10 in value (inverted axis).
    act(() => result.current.surface.onPointerMove(ptr(60, 40).e));
    expect(cb.onMoveKeys).toHaveBeenCalledWith(anim, [{ channel: 'px', index: 1, t: 600, v: 60 }]);
    // Second frame: still computed from the same baseline, never accumulated.
    act(() => result.current.surface.onPointerMove(ptr(70, 40).e));
    expect(cb.onMoveKeys).toHaveBeenLastCalledWith(anim, [{ channel: 'px', index: 1, t: 700, v: 60 }]);
  });

  it('moves the whole selection in a single gesture', () => {
    const selection: KeyRef[] = [
      { channel: 'px', index: 0 },
      { channel: 'px', index: 1 },
    ];
    const { result, cb } = setup({ selection });
    act(() => result.current.startKeyGesture(ptr(50, 50).e, 'px', 1));
    // Key already selected without Shift: the selection is kept as is.
    expect(cb.onSelect).toHaveBeenCalledWith(selection);
    act(() => result.current.surface.onPointerMove(ptr(60, 50).e));
    expect(cb.onMoveKeys).toHaveBeenCalledWith(anim, [
      { channel: 'px', index: 0, t: 100, v: 0 },
      { channel: 'px', index: 1, t: 600, v: 50 },
    ]);
  });

  it('Shift on an already selected key removes it and arms no gesture', () => {
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

  it('read-only: the key can be selected but not moved', () => {
    const { result, cb } = setup({ editable: false });
    act(() => result.current.startKeyGesture(ptr(50, 50).e, 'px', 1));
    expect(cb.onSelect).toHaveBeenCalledWith([{ channel: 'px', index: 1 }]);
    expect(cb.onBeginStroke).not.toHaveBeenCalled();
    act(() => result.current.surface.onPointerMove(ptr(60, 40).e));
    expect(cb.onMoveKeys).not.toHaveBeenCalled();
  });
});

describe('useCurveGestures — tangents', () => {
  it.each<TangentSide>(['out', 'in'])('le côté %s remonte sa pente, sans poids', (side) => {
    const { result, cb } = setup();
    act(() => result.current.startTangentGesture(ptr(50, 50).e, side, 'px', 1));
    expect(cb.onBeginStroke).toHaveBeenCalledTimes(1);
    // Pointer at (60, 40): Δt = +100 ms, Δv = +10 → slope 0.1 unit/ms.
    act(() => result.current.surface.onPointerMove(ptr(60, 40).e));
    expect(cb.onSetTangent).toHaveBeenCalledWith('px', 1, side, 0.1, undefined);
  });

  it('on a weighted key, the pointer distance also sets the weight', () => {
    const weighted = setWeighted(anim, [{ channel: 'px', index: 1 }], true);
    const { result, cb } = setup({ anim: weighted });
    act(() => result.current.startTangentGesture(ptr(50, 50).e, 'in', 'px', 1));
    // Handle pulled 100 ms from the key, on a neighbouring 500 ms segment → weight 3 × 100 / 500.
    act(() => result.current.surface.onPointerMove(ptr(60, 40).e));
    expect(cb.onSetTangent).toHaveBeenCalledWith('px', 1, 'in', 0.1, 0.6);
  });

  it('directly above the key, the slope is meaningless: nothing is written', () => {
    const { result, cb } = setup();
    act(() => result.current.startTangentGesture(ptr(50, 50).e, 'out', 'px', 1));
    act(() => result.current.surface.onPointerMove(ptr(50, 20).e));
    expect(cb.onSetTangent).not.toHaveBeenCalled();
  });

  it('on a vanished key, the gesture stays inert', () => {
    const { result, cb } = setup();
    act(() => result.current.startTangentGesture(ptr(50, 50).e, 'out', 'px', 42));
    act(() => result.current.surface.onPointerMove(ptr(60, 40).e));
    expect(cb.onSetTangent).not.toHaveBeenCalled();
  });
});

describe('useCurveGestures — frame snap and pan', () => {
  it('a moved key lands ON a frame, Alt releases the placement', () => {
    const { result, cb } = setup();
    act(() => result.current.startKeyGesture(ptr(50, 50).e, 'px', 1));
    // +1.5 px = +15 ms: 515 ms falls between two frames (100 ms) → 500 ms.
    act(() => result.current.surface.onPointerMove(ptr(51.5, 50).e));
    expect(cb.onMoveKeys).toHaveBeenLastCalledWith(anim, [{ channel: 'px', index: 1, t: 500, v: 50 }]);
    act(() => result.current.surface.onPointerMove(ptr(51.5, 50, { alt: true }).e));
    expect(cb.onMoveKeys).toHaveBeenLastCalledWith(anim, [{ channel: 'px', index: 1, t: 515, v: 50 }]);
  });

  it('the middle button moves the view instead of selecting', () => {
    const { result, cb } = setup();
    const down = ptr(50, 50, { button: 1 });
    act(() => result.current.surface.onPointerDown(down.e));
    expect(down.el.setPointerCapture).toHaveBeenCalledWith(7);
    // +10 px on X = window shifted by −100 ms; −10 px on Y = −10 in value.
    act(() => result.current.surface.onPointerMove(ptr(60, 40).e));
    expect(cb.onPanView).toHaveBeenCalledWith(-100, -10);
    expect(result.current.band).toBeNull();
    expect(cb.onSelect).not.toHaveBeenCalled();
  });

  it('the middle button on a key arms no move', () => {
    const { result, cb } = setup();
    act(() => result.current.startKeyGesture(ptr(50, 50, { button: 1 }).e, 'px', 1));
    expect(cb.onSelect).not.toHaveBeenCalled();
    expect(cb.onBeginStroke).not.toHaveBeenCalled();
  });
});

describe('useCurveGestures — transform box', () => {
  const selection: KeyRef[] = [
    { channel: 'px', index: 0 },
    { channel: 'px', index: 1 },
  ];

  it('the box follows the extent of the selection', () => {
    const { result } = setup({ selection });
    expect(result.current.selectionBounds).toEqual({ tMin: 0, tMax: 500, vMin: 0, vMax: 50 });
    expect(setup().result.current.selectionBounds).toBeNull();
  });

  it('dragging the right edge scales the keys, the left edge serving as pivot', () => {
    const { result, cb } = setup({ selection });
    const bounds = { tMin: 0, tMax: 500, vMin: 0, vMax: 50 };
    act(() => result.current.startScaleGesture(ptr(50, 50).e, 'right', bounds));
    expect(cb.onBeginStroke).toHaveBeenCalledTimes(1);
    // Pointer from 500 ms to 600 ms, pivot at 0: factor 1.2 on time, values intact.
    act(() => result.current.surface.onPointerMove(ptr(60, 50).e));
    expect(cb.onMoveKeys).toHaveBeenLastCalledWith(anim, [
      { channel: 'px', index: 0, t: 0, v: 0 },
      { channel: 'px', index: 1, t: 600, v: 50 },
    ]);
  });

  it('read-only: the box scales nothing', () => {
    const { result, cb } = setup({ selection, editable: false });
    const bounds = { tMin: 0, tMax: 500, vMin: 0, vMax: 50 };
    act(() => result.current.startScaleGesture(ptr(50, 50).e, 'right', bounds));
    act(() => result.current.surface.onPointerMove(ptr(60, 50).e));
    expect(cb.onBeginStroke).not.toHaveBeenCalled();
    expect(cb.onMoveKeys).not.toHaveBeenCalled();
  });
});
