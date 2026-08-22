// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useViewportZoom } from './useViewportZoom';

/** Conteneur de 400×200 centré en (200, 100) — repère de tous les calculs du hook. */
const makeContainer = () => {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 200 }) as DOMRect;
  document.body.append(el);
  return el;
};

/** Événement de pointeur minimal : le hook n'en lit que la cible, le bouton et la position. */
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
  it('démarre ajusté, sans transformation', () => {
    const { result } = setup();
    expect(result.current.fit).toBe(true);
    expect(result.current.style).toEqual({});
  });

  it('la molette zoome sous le curseur', () => {
    const { el, result } = setup();
    // happy-dom ne porte pas `clientX` dans l'init d'un WheelEvent : on le pose à la main.
    const wheel = new WheelEvent('wheel', { deltaY: -100, bubbles: true });
    Object.defineProperty(wheel, 'clientX', { value: 300 });
    Object.defineProperty(wheel, 'clientY', { value: 100 });
    act(() => {
      el.dispatchEvent(wheel);
    });
    expect(result.current.state.scale).toBeCloseTo(1.15, 5);
    // Curseur à 100 px à droite du centre : la vue se décale pour l'y maintenir.
    expect(result.current.state.x).toBeCloseTo(100 - 100 * 1.15, 5);
    expect(result.current.fit).toBe(false);
  });

  it('le clavier zoome, ajuste et affiche à 100 %', () => {
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
    });
    expect(result.current.state.scale).toBe(4);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '0' }));
    });
    expect(result.current.fit).toBe(true);
  });

  it('ignore le clavier dans un champ de saisie', () => {
    const { result } = setup();
    const input = document.createElement('input');
    document.body.append(input);
    input.focus();
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    });
    expect(result.current.fit).toBe(true);
  });

  it('le bouton du milieu déplace la vue, même ajustée', () => {
    const { result } = setup();
    act(() => result.current.handlers.onPointerDown(pointer('DIV', { button: 1, x: 10, y: 10 })));
    act(() => result.current.handlers.onPointerMove(pointer('DIV', { button: 1, x: 40, y: 30 })));
    expect(result.current.state).toMatchObject({ x: 30, y: 20, scale: 1 });
  });

  it('le bouton gauche ne déplace que sur l’image et une fois zoomé', () => {
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

  it('le clic qui termine un déplacement est consommé, un clic simple ne l’est pas', () => {
    const { result } = setup();
    act(() => result.current.handlers.onPointerDown(pointer('DIV', { button: 1, x: 10, y: 10 })));
    act(() => result.current.handlers.onPointerMove(pointer('DIV', { button: 1, x: 40, y: 10 })));
    act(() => result.current.handlers.onPointerUp(pointer('DIV', { button: 1, x: 40, y: 10 })));
    expect(result.current.consumeClick()).toBe(true);
    // Consommé une seule fois : le clic suivant est bien une commande de lecture.
    expect(result.current.consumeClick()).toBe(false);
    act(() => result.current.handlers.onPointerDown(pointer('DIV', { button: 1, x: 10, y: 10 })));
    act(() => result.current.handlers.onPointerUp(pointer('DIV', { button: 1, x: 11, y: 10 })));
    expect(result.current.consumeClick()).toBe(false);
  });
});
