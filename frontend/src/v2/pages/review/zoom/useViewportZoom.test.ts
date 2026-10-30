// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useViewportZoom } from './useViewportZoom';

/** 400×200 container centred at (200, 100) — the reference of all the hook's computations. */
const makeContainer = () => {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200 }) as DOMRect;
  document.body.append(el);
  return el;
};

/** Minimal pointer event: the hook only reads its target, button and position. */
const pointer = (over: 'VIDEO' | 'DIV', init: { button?: number; x: number; y: number }) =>
  ({
    button: init.button ?? 0,
    pointerId: 1,
    clientX: init.x,
    clientY: init.y,
    target: { tagName: over },
    currentTarget: { setPointerCapture: () => {} },
    preventDefault: () => {},
  }) as unknown as React.PointerEvent;

afterEach(() => document.body.replaceChildren());

const setup = (oneToOneScale?: () => number | null) => {
  const el = makeContainer();
  const containerRef = { current: el };
  const hook = renderHook(() => useViewportZoom({ containerRef, oneToOneScale }));
  return { el, ...hook };
};

describe('useViewportZoom', () => {
  it('starts fitted, without transform', () => {
    const { result } = setup();
    expect(result.current.fit).toBe(true);
    expect(result.current.style).toEqual({});
  });

  it('the wheel zooms under the cursor', () => {
    const { el, result } = setup();
    // happy-dom does not carry `clientX` in a WheelEvent init: set it by hand.
    const wheel = new WheelEvent('wheel', { deltaY: -100, bubbles: true });
    Object.defineProperty(wheel, 'clientX', { value: 300 });
    Object.defineProperty(wheel, 'clientY', { value: 100 });
    act(() => {
      el.dispatchEvent(wheel);
    });
    expect(result.current.state.scale).toBeCloseTo(1.15, 5);
    // Cursor 100 px right of the centre: the view shifts to keep it there.
    expect(result.current.state.x).toBeCloseTo(100 - 100 * 1.15, 5);
    expect(result.current.fit).toBe(false);
  });

  /**
   * This test used to expect `1` for 100% and `0` for fit. Both keys were REMOVED in Phase 50:
   * bare digits belong to the chrome's mode toggle, and `1` did both at once — first mode *and*
   * 100%. The role moves to `H` and `F`, the letters the rail announces (`action.resetMedia`,
   * `action.fitMedia`).
   */
  it('the keyboard zooms in steps, and digits no longer belong to it', () => {
    const { result } = setup(() => 4);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
    });
    expect(result.current.state.scale).toBeCloseTo(1.25, 5);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '-' }));
    });
    expect(result.current.state.scale).toBeCloseTo(1, 5);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '1' }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }));
    });
    expect(result.current.state.scale).toBeCloseTo(1, 5);
  });

  it('H shows 100%, F returns to fit', () => {
    const { result } = setup(() => 4);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));
    });
    expect(result.current.state.scale).toBe(4);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f' }));
    });
    expect(result.current.fit).toBe(true);
  });

  it('ignores the keyboard in an input field', () => {
    const { result } = setup();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    });
    expect(result.current.fit).toBe(true);
  });

  it('the middle button pans the view, even when fitted', () => {
    const { result } = setup();
    act(() => result.current.handlers.onPointerDown(pointer('DIV', { button: 1, x: 10, y: 10 })));
    act(() => result.current.handlers.onPointerMove(pointer('DIV', { button: 1, x: 40, y: 30 })));
    expect(result.current.state).toMatchObject({ x: 30, y: 20, scale: 1 });
  });

  it('the left button only pans on the image and once zoomed', () => {
    const { result } = setup();
    act(() => result.current.handlers.onPointerDown(pointer('VIDEO', { x: 10, y: 10 })));
    act(() => result.current.handlers.onPointerMove(pointer('VIDEO', { x: 60, y: 10 })));
    expect(result.current.fit).toBe(true);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '+' }));
    });
    act(() => result.current.handlers.onPointerDown(pointer('VIDEO', { x: 10, y: 10 })));
    act(() => result.current.handlers.onPointerMove(pointer('VIDEO', { x: 60, y: 10 })));
    expect(result.current.state.x).toBe(50);
  });

  it('the click that ends a pan is consumed, a simple click is not', () => {
    const { result } = setup();
    act(() => result.current.handlers.onPointerDown(pointer('DIV', { button: 1, x: 10, y: 10 })));
    act(() => result.current.handlers.onPointerMove(pointer('DIV', { button: 1, x: 40, y: 10 })));
    act(() => result.current.handlers.onPointerUp(pointer('DIV', { button: 1, x: 40, y: 10 })));
    expect(result.current.consumeClick()).toBe(true);
    // Consumed only once: the next click is indeed a playback command.
    expect(result.current.consumeClick()).toBe(false);
    act(() => result.current.handlers.onPointerDown(pointer('DIV', { button: 1, x: 10, y: 10 })));
    act(() => result.current.handlers.onPointerUp(pointer('DIV', { button: 1, x: 11, y: 10 })));
    expect(result.current.consumeClick()).toBe(false);
  });
});
