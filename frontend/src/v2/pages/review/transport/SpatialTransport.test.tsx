// SPDX-FileCopyrightText: 2026 Yvig Bidon
// SPDX-License-Identifier: AGPL-3.0-or-later

import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SpatialTransport from './SpatialTransport';
import type { CameraAnimState } from '../camera/useCameraAnim';

/** État d'animation minimal : le transport ne lit que ces champs. */
const animState = (over: Partial<CameraAnimState> = {}) =>
  ({
    keyTimes: [0, 1000, 2000],
    playDuration: 2000,
    duration: 2000,
    timeMs: 0,
    playing: false,
    loop: true,
    autoKey: false,
    hasAnimation: true,
    canUndo: false,
    canRedo: false,
    scrub: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    setLoop: vi.fn(),
    setDuration: vi.fn(),
    setAutoKey: vi.fn(),
    insertKeyAtView: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
    ...over,
  }) as unknown as CameraAnimState;

/** Ancre la piste à 200 px : happy-dom ne mesure rien et ne capture pas le pointeur. */
const anchor = (el: Element) => {
  el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 24 }) as DOMRect;
  el.setPointerCapture = () => {};
  el.releasePointerCapture = () => {};
};

const mount = (anim: CameraAnimState, fps = 10) =>
  render(<SpatialTransport anim={anim} editable fps={fps} drawerOpen={false} onDrawer={vi.fn()} />).container;

describe('SpatialTransport — tête de lecture bornée à sa piste', () => {
  it('au milieu de la durée, la tête est à la moitié de la piste', () => {
    const container = mount(animState({ timeMs: 1000 }));
    expect((container.querySelector('.rv-track__head') as HTMLElement).style.left).toBe('50%');
    expect((container.querySelector('.rv-track__fill') as HTMLElement).style.width).toBe('50%');
  });

  it('loin dans la timeline, la tête s’arrête au bord au lieu de déborder', () => {
    // Un scrub à 60 s sur une animation de 2 s posait `left: 3000%` : la piste débordait du
    // transport, qui défile en overflow-x, et une scrollbar horizontale apparaissait.
    const container = mount(animState({ timeMs: 60_000 }));
    expect((container.querySelector('.rv-track__head') as HTMLElement).style.left).toBe('100%');
    expect((container.querySelector('.rv-track__fill') as HTMLElement).style.width).toBe('100%');
  });

  it('les clés au-delà de la durée étirent la piste au lieu d’en sortir', () => {
    // La piste s'étend au plus tard des deux : durée de lecture réglée, ou dernière clé.
    const container = mount(animState({ keyTimes: [0, 1000, 9000], playDuration: 2000 }));
    const lefts = [...container.querySelectorAll('.rv-key')].map((k) =>
      Number.parseFloat((k as HTMLElement).style.left),
    );
    expect(lefts[0]).toBe(0);
    expect(lefts[2]).toBe(100);
    for (const left of lefts) expect(left).toBeLessThanOrEqual(100);
  });
});

describe('SpatialTransport — scrub sur la piste', () => {
  it('un appui sur la piste déplace la lecture, snappée à la frame', () => {
    const anim = animState();
    const container = mount(anim);
    const track = container.querySelector('.rv-track') as HTMLElement;
    anchor(track);
    fireEvent.pointerDown(track, { button: 0, clientX: 50, pointerId: 1 });
    expect(anim.scrub).toHaveBeenCalledWith(500);
  });

  it('le glissement suit le pointeur, et s’arrête au relâchement', () => {
    const anim = animState();
    const container = mount(anim);
    const track = container.querySelector('.rv-track') as HTMLElement;
    anchor(track);
    fireEvent.pointerDown(track, { button: 0, clientX: 50, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 150, pointerId: 1 });
    expect(anim.scrub).toHaveBeenLastCalledWith(1500);
    fireEvent.pointerUp(track, { clientX: 150, pointerId: 1 });
    fireEvent.pointerMove(track, { clientX: 20, pointerId: 1 });
    expect(anim.scrub).toHaveBeenCalledTimes(2);
  });

  it('cliquer un losange va exactement à la clé, sans passer par la piste', () => {
    const anim = animState();
    const container = mount(anim);
    const track = container.querySelector('.rv-track') as HTMLElement;
    anchor(track);
    fireEvent.click(container.querySelectorAll('.rv-key')[1]);
    expect(anim.scrub).toHaveBeenCalledWith(1000);
  });
});
